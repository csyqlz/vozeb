import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { createImageTask, updateImageTask, type ImageTask, type ImageTaskConfig, type ImageTaskReference } from "@/lib/server/image-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type CreateImageTaskBody = {
    kind?: "generation" | "edit";
    config?: ImageTaskConfig;
    prompt?: string;
    references?: ImageTaskReference[];
    mask?: ImageTaskReference;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
};

type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as CreateImageTaskBody;
    const config = sanitizeConfig(body.config);
    const prompt = (body.prompt || "").trim();
    const kind = body.kind === "edit" ? "edit" : "generation";
    if (!config || !prompt) return NextResponse.json({ error: "任务参数不完整" }, { status: 400 });

    const task = createImageTask({
        userId: currentUser.id,
        kind,
        config,
        prompt,
        references: Array.isArray(body.references) ? body.references.filter((item) => Boolean(item?.dataUrl)) : [],
        mask: body.mask?.dataUrl ? body.mask : undefined,
    });
    const cookie = request.headers.get("cookie") || "";
    const origin = new URL(request.url).origin;
    void runImageTask(task, origin, cookie);

    return NextResponse.json({ task: publicTask(task) });
}

async function runImageTask(task: ImageTask, origin: string, cookie: string) {
    updateImageTask(task.id, { status: "running" });
    try {
        const result = task.config.apiFormat === "gemini" ? await runGeminiImageTask(task, origin, cookie) : await runOpenAiImageTask(task, origin, cookie);
        updateImageTask(task.id, { status: "success", result: { dataUrl: result.dataUrl }, pointsRemaining: result.pointsRemaining });
    } catch (error) {
        updateImageTask(task.id, { status: "error", error: error instanceof Error ? error.message : "图片生成失败" });
    }
}

async function runOpenAiImageTask(task: ImageTask, origin: string, cookie: string) {
    const config = task.config;
    const quality = normalizeQuality(config.quality || "");
    const requestSize = resolveRequestSize(quality, config.size || "auto");
    const path = task.kind === "edit" ? "/images/edits" : "/images/generations";
    const url = taskUrl(config, path, origin);
    const headers = taskHeaders(config, cookie);
    let response: Response;

    if (task.kind === "edit") {
        const formData = new FormData();
        formData.set("model", config.model);
        formData.set("prompt", withSystemPrompt(config, task.prompt));
        formData.set("n", "1");
        formData.set("response_format", "b64_json");
        formData.set("output_format", IMAGE_OUTPUT_FORMAT);
        if (quality) formData.set("quality", quality);
        if (requestSize) formData.set("size", requestSize);
        task.references.forEach((reference, index) => formData.append("image", dataUrlToFile(reference.dataUrl, reference.name || `reference-${index + 1}.png`, reference.type)));
        if (task.mask) formData.set("mask", dataUrlToFile(task.mask.dataUrl, task.mask.name || "mask.png", task.mask.type));
        response = await fetch(url, { method: "POST", headers, body: formData, cache: "no-store" });
    } else {
        headers.set("content-type", "application/json");
        response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: config.model,
                prompt: withSystemPrompt(config, task.prompt),
                n: 1,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                response_format: "b64_json",
                output_format: IMAGE_OUTPUT_FORMAT,
            }),
            cache: "no-store",
        });
    }

    if (!response.ok) throw new Error(await readFetchError(response, "图片生成失败"));
    const payload = (await response.json()) as ImageApiResponse;
    return { dataUrl: parseImagePayload(payload), pointsRemaining: readPointsRemaining(response.headers) };
}

async function runGeminiImageTask(task: ImageTask, origin: string, cookie: string) {
    if (task.mask) throw new Error("Gemini 暂不支持蒙版编辑");
    const config = task.config;
    const parts: GeminiPart[] = [{ text: withSystemPrompt(config, task.prompt) }];
    task.references.forEach((reference) => parts.push(toGeminiImagePart(reference.dataUrl, reference.type)));
    const response = await fetch(`${geminiApiUrl(config, "generateContent", origin)}`, {
        method: "POST",
        headers: geminiHeaders(config, cookie),
        body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(await readFetchError(response, "图片生成失败"));
    const payload = (await response.json()) as GeminiPayload;
    return { dataUrl: parseGeminiImagePayload(payload), pointsRemaining: readPointsRemaining(response.headers) };
}

function publicTask(task: ImageTask) {
    return {
        id: task.id,
        kind: task.kind,
        status: task.status,
        model: task.config.model,
    };
}

function sanitizeConfig(config?: ImageTaskConfig): ImageTaskConfig | null {
    if (!config?.baseUrl?.trim() || !config?.model?.trim()) return null;
    if (config.apiSource !== "system" && !config.apiKey?.trim()) return null;
    return {
        apiSource: config.apiSource === "system" ? "system" : "custom",
        baseUrl: config.baseUrl.trim(),
        apiKey: config.apiKey || "",
        apiFormat: config.apiFormat === "gemini" ? "gemini" : "openai",
        model: config.model.trim(),
        quality: config.quality || "auto",
        size: config.size || "auto",
        systemPrompt: config.systemPrompt || "",
    };
}

function taskUrl(config: ImageTaskConfig, path: string, origin: string) {
    const apiBase = normalizeApiBaseUrl(config.baseUrl, config.apiFormat, origin);
    return `${apiBase}${path}`;
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", origin: string) {
    const absoluteBase = baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
    const normalized = absoluteBase.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function taskHeaders(config: ImageTaskConfig, cookie: string) {
    const headers = new Headers();
    if (config.baseUrl.startsWith("/") && cookie) headers.set("cookie", cookie);
    if (config.apiFormat === "gemini") headers.set("x-goog-api-key", config.apiKey);
    else headers.set("authorization", `Bearer ${config.apiKey}`);
    return headers;
}

function geminiHeaders(config: ImageTaskConfig, cookie: string) {
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    return headers;
}

function geminiApiUrl(config: ImageTaskConfig, action: "generateContent", origin: string) {
    const baseUrl = normalizeApiBaseUrl(config.baseUrl, "gemini", origin);
    return `${baseUrl}/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:${action}`;
}

function withSystemPrompt(config: ImageTaskConfig, prompt: string) {
    const systemPrompt = (config.systemPrompt || "").trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "图片生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
    const image = payload.data?.map(resolveImageDataUrl).find(Boolean);
    if (!image) throw new Error("接口没有返回图片");
    return image;
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (typeof item.url === "string" && item.url) return item.url;
    return "";
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
    const image = payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts || [])
        .map((part) => {
            const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
            if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
            return part.fileData?.fileUri || "";
        })
        .find(Boolean);
    if (!image) throw new Error("Gemini 接口没有返回图片");
    return image;
}

function toGeminiImagePart(dataUrl: string, fallbackType?: string): GeminiPart {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: dataUrl, mimeType: fallbackType || "image/png" } };
}

function dataUrlToFile(dataUrl: string, name: string, fallbackType?: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) return new File([new Blob([])], name, { type: fallbackType || "image/png" });
    const bytes = Buffer.from(match[2], "base64");
    return new File([bytes], name, { type: fallbackType || match[1] || "image/png" });
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return `${fallback}，${response.status}`;
    try {
        const payload = JSON.parse(text) as { error?: { message?: string }; msg?: string };
        return payload.msg || payload.error?.message || `${fallback}，${response.status}`;
    } catch {
        return text.slice(0, 300) || `${fallback}，${response.status}`;
    }
}

function readPointsRemaining(headers: Headers) {
    const value = headers.get("x-vozeb-points-remaining");
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图片尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;
    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }
    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图片尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("图片比例必须是正数，例如 9:16");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图片宽高比不能超过 3:1，请调整尺寸");
    return { width, height };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图片尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图片尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图片尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图片宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图片总像素需在 655360 到 8294400 之间，请调整尺寸");
}
