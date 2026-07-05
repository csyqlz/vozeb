import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { createTextTask, updateTextTask, type TextTask, type TextTaskConfig } from "@/lib/server/text-task-store";
import type { AiTextMessage } from "@/services/api/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

const TASK_HEARTBEAT_MS = 30 * 1000;
const MODEL_REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

type CreateTextTaskBody = {
    config?: TextTaskConfig;
    messages?: AiTextMessage[];
};

type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] };
type ResponseApiPayload = {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ChatCompletionPayload = {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
};
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as CreateTextTaskBody;
    const config = sanitizeConfig(body.config);
    const messages = sanitizeMessages(body.messages);
    if (!config || !messages.length) return NextResponse.json({ error: "任务参数不完整" }, { status: 400 });

    const task = createTextTask({ userId: currentUser.id, config, messages });
    const cookie = request.headers.get("cookie") || "";
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    void runTextTask(task, origin, cookie);

    return NextResponse.json({ task: publicTask(task) });
}

async function runTextTask(task: TextTask, origin: string, cookie: string) {
    updateTextTask(task.id, { status: "running" });
    const heartbeat = setInterval(() => {
        updateTextTask(task.id, { status: "running" });
    }, TASK_HEARTBEAT_MS);
    try {
        const result = task.config.apiFormat === "gemini" ? await runGeminiTextTask(task, origin, cookie) : await runOpenAiTextTask(task, origin, cookie);
        updateTextTask(task.id, {
            status: "success",
            result: { content: result.content || "没有返回内容" },
            pointsRemaining: result.pointsRemaining,
            messages: [],
            config: clearSecret(task.config),
        });
    } catch (error) {
        const message = toSafeGenerationErrorMessage(error, "文本生成失败");
        updateTextTask(task.id, { status: "error", error: message, messages: [], config: clearSecret(task.config) });
    } finally {
        clearInterval(heartbeat);
    }
}

async function runOpenAiTextTask(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    const response = await taskFetch(config, taskUrl(config, "/responses", origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, input: toResponseInput(withSystemMessage(config, task.messages)) }),
        cache: "no-store",
    });
    if (!response.ok) {
        const errorMessage = await readFetchError(response, "文本生成失败");
        if (shouldFallbackToChatCompletions(response.status, errorMessage)) return runOpenAiChatCompletionTask(task, origin, cookie);
        throw new Error(errorMessage);
    }
    const payload = (await response.json()) as ResponseApiPayload;
    validateResponsePayload(payload);
    return { content: parseOpenAiContent(payload), pointsRemaining: readPointsRemaining(response.headers) };
}

async function runOpenAiChatCompletionTask(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    const response = await taskFetch(config, taskUrl(config, "/chat/completions", origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, messages: toChatMessages(withSystemMessage(config, task.messages)) }),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(await readFetchError(response, "文本生成失败"));
    const payload = (await response.json()) as ChatCompletionPayload;
    validateChatCompletionPayload(payload);
    return { content: parseChatCompletionContent(payload), pointsRemaining: readPointsRemaining(response.headers) };
}

async function runGeminiTextTask(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const response = await taskFetch(config, geminiApiUrl(config, "generateContent", origin), {
        method: "POST",
        headers: geminiHeaders(config, cookie),
        body: JSON.stringify(toGeminiBody(config, task.messages)),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(await readFetchError(response, "文本生成失败"));
    const payload = (await response.json()) as GeminiPayload;
    validateGeminiPayload(payload);
    return { content: parseGeminiContent(payload), pointsRemaining: readPointsRemaining(response.headers) };
}

function publicTask(task: TextTask) {
    return {
        id: task.id,
        status: task.status,
        model: task.config.model,
        result: task.result,
        error: task.error,
    };
}

function sanitizeConfig(config?: TextTaskConfig): TextTaskConfig | null {
    if (!config?.baseUrl?.trim() || !config?.model?.trim()) return null;
    if (config.apiSource !== "system" && !config.apiKey?.trim()) return null;
    return {
        apiSource: config.apiSource === "system" ? "system" : "custom",
        baseUrl: config.baseUrl.trim(),
        apiKey: config.apiKey || "",
        apiFormat: config.apiFormat === "gemini" ? "gemini" : "openai",
        model: config.model.trim(),
        systemPrompt: config.systemPrompt || "",
    };
}

function sanitizeMessages(messages?: AiTextMessage[]) {
    if (!Array.isArray(messages)) return [];
    return messages
        .map((message) => ({
            role: message.role === "system" || message.role === "assistant" ? message.role : ("user" as const),
            content: sanitizeContent(message.content),
        }))
        .filter((message) => (Array.isArray(message.content) ? message.content.length > 0 : Boolean(message.content.trim())))
        .slice(0, 20);
}

function sanitizeContent(content: AiTextMessage["content"]): AiTextMessage["content"] {
    if (!Array.isArray(content)) return String(content || "").slice(0, 20000);
    return content
        .map((item) => {
            if (item.type === "text") return { type: "text" as const, text: item.text.slice(0, 20000) };
            return { type: "image_url" as const, image_url: { url: item.image_url.url } };
        })
        .filter((item) => (item.type === "text" ? Boolean(item.text.trim()) : Boolean(item.image_url.url)));
}

function clearSecret(config: TextTaskConfig): TextTaskConfig {
    return { ...config, apiKey: "" };
}

function withSystemMessage(config: TextTaskConfig, messages: AiTextMessage[]) {
    const systemPrompt = (config.systemPrompt || "").trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: AiTextMessage[]): ResponseInputItem[] {
    return messages.map((message) => ({ role: message.role, content: toResponseContent(message.content) }));
}

function toResponseContent(content: AiTextMessage["content"]): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toChatMessages(messages: AiTextMessage[]) {
    return messages.map((message) => ({ role: message.role, content: message.content }));
}

function toGeminiBody(config: TextTaskConfig, messages: AiTextMessage[]) {
    const systemText = [(config.systemPrompt || "").trim(), ...messages.flatMap((message) => (message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    return {
        contents: messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) })),
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    };
}

function toGeminiParts(content: AiTextMessage["content"]): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: AiTextMessage["content"]) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function parseOpenAiContent(payload: ResponseApiPayload) {
    return (
        payload.output_text ||
        payload.output
            ?.flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("") ||
        ""
    );
}

function parseChatCompletionContent(payload: ChatCompletionPayload) {
    return payload.choices?.map((choice) => readChatContent(choice.message?.content)).join("") || "";
}

function readChatContent(content?: string | Array<{ type?: string; text?: string }>) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((item) => item.text || "").join("");
}

function parseGeminiContent(payload: GeminiPayload) {
    return (
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => part.text || "")
            .join("") || ""
    );
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateChatCompletionPayload(payload: ChatCompletionPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        const payload = JSON.parse(text) as { error?: { message?: string }; msg?: string; response?: { error?: { message?: string } } };
        return payload.msg || payload.error?.message || payload.response?.error?.message || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}，状态码 ${status}` : fallback;
}

function shouldFallbackToChatCompletions(status: number, message: string) {
    if (status === 404 || status === 405) return true;
    if (status !== 400) return false;
    return /responses|endpoint|route|path|not found|unsupported|unknown url|cannot post|invalid url|no such/i.test(message);
}

function taskUrl(config: TextTaskConfig, path: string, origin: string) {
    const apiBase = normalizeApiBaseUrl(config.baseUrl, config.apiFormat, origin);
    return `${apiBase}${path}`;
}

function geminiApiUrl(config: TextTaskConfig, action: "generateContent", origin: string) {
    const baseUrl = normalizeApiBaseUrl(config.baseUrl, "gemini", origin);
    return `${baseUrl}/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:${action}`;
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", origin: string) {
    const absoluteBase = baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
    const normalized = absoluteBase.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function taskHeaders(config: TextTaskConfig, cookie: string) {
    const headers = new Headers();
    if (config.baseUrl.startsWith("/") && cookie) headers.set("cookie", cookie);
    if (config.apiFormat === "gemini") headers.set("x-goog-api-key", config.apiKey);
    else headers.set("authorization", `Bearer ${config.apiKey}`);
    return headers;
}

function taskFetch(config: TextTaskConfig, url: string, init: RequestInit) {
    const nextInit = {
        ...init,
        signal: init.signal || AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    };
    return isInternalApiBaseUrl(config.baseUrl) ? fetchInternalApi(url, nextInit) : fetch(url, nextInit);
}

function geminiHeaders(config: TextTaskConfig, cookie: string) {
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    return headers;
}

function readPointsRemaining(headers: Headers) {
    const value = Number(headers.get("x-vozeb-points-remaining"));
    return Number.isFinite(value) ? value : undefined;
}
