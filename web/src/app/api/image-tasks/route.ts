import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveGeneratedMediaUrl } from "@/lib/media-url";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { countActiveImageTasksForUser, createImageTask, updateImageTask, type ImageTask, type ImageTaskConfig, type ImageTaskReference } from "@/lib/server/image-task-store";
import { isGenerationSource, recordGenerationLog } from "@/lib/server/generation-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type CreateImageTaskBody = {
    kind?: "generation" | "edit";
    config?: ImageTaskConfig;
    prompt?: string;
    references?: ImageTaskReference[];
    mask?: ImageTaskReference;
    source?: string;
    title?: string;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    id?: string;
    task_id?: string;
    status?: string;
    result?: unknown;
    results?: unknown;
    content?: unknown;
    output?: unknown;
    code?: number;
    msg?: string;
};
type ImageTaskResult = { dataUrl: string; remoteUrl?: string };

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
const TASK_HEARTBEAT_MS = 30 * 1000;
const MODEL_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const IMAGE_TASK_POLL_INTERVAL_MS = 2500;
const IMAGE_TASK_POLL_ATTEMPTS = 120;
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const INLINE_IMAGE_TIMEOUT_MS = 30 * 1000;
const IMAGE_RESPONSE_FORMATS = ["b64_json", "url"] as const;
const IMAGE_URL_KEYS = [
    "url",
    "uri",
    "src",
    "image",
    "image_url",
    "imageUrl",
    "media_url",
    "mediaUrl",
    "source_url",
    "sourceUrl",
    "content_url",
    "contentUrl",
    "output_url",
    "outputUrl",
    "download_url",
    "downloadUrl",
    "file_url",
    "fileUrl",
    "asset_url",
    "assetUrl",
    "result_url",
    "resultUrl",
];
const IMAGE_BASE64_KEYS = ["b64_json", "b64", "base64", "image_base64", "imageBase64", "base64_json"];
const IMAGE_CONTAINER_KEYS = ["data", "result", "results", "response", "payload", "content", "output", "outputs", "images", "image", "asset", "assets", "file", "files", "artifact", "artifacts", "items", "task", "job"];
const IMAGE_TASK_ID_KEYS = ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId", "generation_id", "generationId"];
const IMAGE_STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
const IMAGE_POLL_URL_KEYS = ["poll_url", "pollUrl", "polling_url", "pollingUrl", "status_url", "statusUrl", "task_url", "taskUrl"];

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    const settings = currentUser ? await getAuthSettings() : null;
    if (currentUser && settings && countActiveImageTasksForUser(currentUser.id) >= settings.generationConcurrency.image) {
        return NextResponse.json({ error: "当前用户生图任务已达到并发上限，请稍后再试" }, { status: 429 });
    }
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as CreateImageTaskBody;
    const config = sanitizeConfig(body.config);
    const prompt = (body.prompt || "").trim();
    const kind = body.kind === "edit" ? "edit" : "generation";
    if (!config || !prompt) return NextResponse.json({ error: "任务参数不完整" }, { status: 400 });

    const task = createImageTask({
        userId: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        kind,
        source: isGenerationSource(body.source) ? body.source : "image-workbench",
        title: typeof body.title === "string" ? body.title : "",
        config,
        prompt,
        references: Array.isArray(body.references) ? body.references.filter((item) => Boolean(item?.dataUrl || item?.url)) : [],
        mask: body.mask?.dataUrl || body.mask?.url ? body.mask : undefined,
    });
    const cookie = request.headers.get("cookie") || "";
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    void runImageTask(task, origin, cookie);

    return NextResponse.json({ task: publicTask(task) });
}

async function runImageTask(task: ImageTask, origin: string, cookie: string) {
    updateImageTask(task.id, { status: "running" });
    const heartbeat = setInterval(() => {
        updateImageTask(task.id, { status: "running" });
    }, TASK_HEARTBEAT_MS);
    try {
        const result = task.config.apiFormat === "gemini" ? await runGeminiImageTask(task, origin, cookie) : await runOpenAiImageTask(task, origin, cookie);
        const resultRemoteUrl = (result as { remoteUrl?: unknown }).remoteUrl;
        const safeResult = await inlineRemoteImageResult(result.dataUrl, origin, cookie, typeof resultRemoteUrl === "string" ? resultRemoteUrl : undefined);
        const log = await writeImageGenerationLog(task, "success", safeResult, Date.now() - task.createdAt).catch((error) => {
            console.error("Image generation log write failed", error);
            return null;
        });
        const asset = log?.assets[0];
        const settings = await getAuthSettings().catch(() => null);
        const imageServerFallback = settings?.generationAssetStorage?.imageServerFallback !== false;
        updateImageTask(task.id, {
            status: "success",
            result: { dataUrl: safeResult.dataUrl, remoteUrl: asset?.remoteUrl || safeResult.remoteUrl, serverUrl: imageServerFallback ? asset?.serverUrl : undefined },
            pointsRemaining: result.pointsRemaining,
        });
    } catch (error) {
        const message = toSafeGenerationErrorMessage(error, "图片生成失败");
        updateImageTask(task.id, { status: "error", error: message });
        await writeImageGenerationLog(task, "failed", "", Date.now() - task.createdAt, message).catch((logError) => {
            console.error("Image generation failure log write failed", logError);
        });
    } finally {
        clearInterval(heartbeat);
    }
}

async function writeImageGenerationLog(task: ImageTask, status: "success" | "failed", result: { dataUrl?: string; remoteUrl?: string } | string, durationMs: number, error?: string) {
    const resultUrl = typeof result === "string" ? result : result.remoteUrl || result.dataUrl || "";
    return recordGenerationLog({
        id: `image-task:${task.id}`,
        taskId: task.id,
        userId: task.userId,
        username: task.username,
        displayName: task.displayName,
        kind: "image",
        source: task.source || "image-workbench",
        status,
        title: task.title || task.prompt.slice(0, 36) || "图片生成",
        prompt: task.prompt,
        model: task.config.model,
        summary: status === "success" ? (task.kind === "edit" ? "图生图调用完成" : "文生图调用完成") : "图片生成失败",
        durationMs,
        count: 1,
        successCount: status === "success" ? 1 : 0,
        failCount: status === "failed" ? 1 : 0,
        assets: resultUrl ? [{ type: "image", url: resultUrl, remoteUrl: typeof result === "string" ? undefined : result.remoteUrl }] : [],
        error,
        createdAt: task.createdAt,
        completedAt: Date.now(),
    });
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
        let formData: FormData;
        try {
            formData = await buildImageEditFormData(task, quality, requestSize, origin, cookie, "url");
        } catch {
            return runOpenAiJsonImageEditTask(task, url, origin, quality, requestSize, cookie, "url");
        }
        response = await taskFetch(config, url, { method: "POST", headers, body: formData, cache: "no-store" });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            if (shouldFallbackToJsonImageEdit(response.status, message)) return runOpenAiJsonImageEditTask(task, url, origin, quality, requestSize, cookie, "url");
            if (shouldTryNextImageResponseFormat("url", response.status, message)) return runOpenAiImageTaskWithBase64Response(task, origin, cookie);
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
    } else {
        headers.set("content-type", "application/json");
        response = await taskFetch(config, url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: config.model,
                prompt: withSystemPrompt(config, task.prompt),
                n: 1,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                response_format: "url",
                output_format: IMAGE_OUTPUT_FORMAT,
            }),
            cache: "no-store",
        });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            if (shouldTryNextImageResponseFormat("url", response.status, message)) return runOpenAiImageTaskWithBase64Response(task, origin, cookie);
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
    }

    if (!response.ok) throw new Error(await readFetchError(response, "图片生成失败"));
    const payload = (await response.json()) as ImageApiResponse;
    const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
    return { ...(await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url)), pointsRemaining: readPointsRemaining(response.headers) };
}

async function runOpenAiJsonImageEditTask(task: ImageTask, url: string, origin: string, quality: string | undefined, requestSize: string | undefined, cookie: string, responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number] = "b64_json") {
    const config = task.config;
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    let lastMessage = "";
    for (const body of buildJsonImageEditBodies(task, quality, requestSize, responseFormat, origin)) {
        const response = await taskFetch(config, url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            lastMessage = message;
            if (shouldRetryJsonImageEditPayload(response.status, message)) continue;
            if (shouldTryNextImageResponseFormat(responseFormat, response.status, message)) {
                if (responseFormat === "url") return runOpenAiJsonImageEditTask(task, url, origin, quality, requestSize, cookie, "b64_json");
                return runOpenAiResponsesImageTask(task, origin, cookie);
            }
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
        const payload = (await response.json()) as ImageApiResponse;
        const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
        return { ...(await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url)), pointsRemaining: readPointsRemaining(response.headers) };
    }
    if (shouldTryNextImageResponseFormat(responseFormat, 400, lastMessage)) {
        if (responseFormat === "url") return runOpenAiJsonImageEditTask(task, url, origin, quality, requestSize, cookie, "b64_json");
        return runOpenAiResponsesImageTask(task, origin, cookie);
    }
    throw new Error(lastMessage || "图片生成失败");
}

async function runOpenAiImageTaskWithBase64Response(task: ImageTask, origin: string, cookie: string) {
    const config = task.config;
    const quality = normalizeQuality(config.quality || "");
    const requestSize = resolveRequestSize(quality, config.size || "auto");
    const path = task.kind === "edit" ? "/images/edits" : "/images/generations";
    const url = taskUrl(config, path, origin);
    const headers = taskHeaders(config, cookie);

    if (task.kind === "edit") {
        let formData: FormData;
        try {
            formData = await buildImageEditFormData(task, quality, requestSize, origin, cookie, "b64_json");
        } catch {
            return runOpenAiJsonImageEditTask(task, url, origin, quality, requestSize, cookie, "b64_json");
        }
        const response = await taskFetch(config, url, { method: "POST", headers, body: formData, cache: "no-store" });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            if (shouldFallbackToJsonImageEdit(response.status, message)) return runOpenAiJsonImageEditTask(task, url, origin, quality, requestSize, cookie, "b64_json");
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
        const payload = (await response.json()) as ImageApiResponse;
        const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
        return { ...(await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url)), pointsRemaining: readPointsRemaining(response.headers) };
    }

    headers.set("content-type", "application/json");
    const response = await taskFetch(config, url, {
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
    if (!response.ok) {
        const message = await readFetchError(response, "图片生成失败");
        if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
        throw new Error(message);
    }
    const payload = (await response.json()) as ImageApiResponse;
    const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
    return { ...(await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url)), pointsRemaining: readPointsRemaining(response.headers) };
}

async function runOpenAiResponsesImageTask(task: ImageTask, origin: string, cookie: string) {
    const config = task.config;
    const url = taskUrl(config, "/responses", origin);
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    let lastError = "";

    for (const body of buildResponsesImageBodies(task, origin)) {
        const response = await taskFetch(config, url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
        if (!response.ok) {
            lastError = await readFetchError(response, "图片生成失败");
            if (response.status === 400 || response.status === 422) continue;
            throw new Error(lastError);
        }
        const payload = (await response.json()) as ImageApiResponse;
        const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
        return { ...(await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url)), pointsRemaining: readPointsRemaining(response.headers) };
    }

    throw new Error(lastError || "图片生成失败");
}

function buildResponsesImageBodies(task: ImageTask, origin: string) {
    const prompt = withSystemPrompt(task.config, task.prompt);
    const imageContent = task.references.map((reference) => ({ type: "input_image", image_url: referenceRequestUrl(reference, origin) }));
    const content = [{ type: "input_text", text: prompt }, ...imageContent];
    return [
        {
            model: task.config.model,
            input: [{ role: "user", content }],
            tools: [{ type: "image_generation" }],
        },
        {
            model: task.config.model,
            input: [{ role: "user", content }],
        },
        {
            model: task.config.model,
            input: prompt,
            tools: [{ type: "image_generation" }],
        },
        {
            model: task.config.model,
            input: prompt,
        },
    ];
}

function buildJsonImageEditBodies(task: ImageTask, quality: string | undefined, requestSize: string | undefined, responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number], origin: string) {
    const images = task.references.map((reference) => referenceRequestUrl(reference, origin)).filter(Boolean);
    const mask = task.mask ? referenceRequestUrl(task.mask, origin) : "";
    const base = {
        model: task.config.model,
        prompt: withSystemPrompt(task.config, task.prompt),
        n: 1,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        response_format: responseFormat,
        output_format: IMAGE_OUTPUT_FORMAT,
        ...(mask ? { mask } : {}),
    };
    if (!images.length) return [base];
    const first = images[0];
    return [
        { ...base, ...(images.length === 1 ? { image: first } : {}), images },
        { ...base, image_url: first },
        { ...base, input_image: first },
        { ...base, image: first },
        { ...base, images: images.map((item) => ({ url: item })) },
    ];
}

function referenceRequestUrl(reference: ImageTaskReference, origin = "") {
    const dataUrl = (reference.dataUrl || "").trim();
    if (/^data:image\//i.test(dataUrl)) return dataUrl;
    const remoteUrl = (reference.url || "").trim();
    if (isRemoteMediaUrl(remoteUrl)) return remoteUrl;
    return normalizeReferenceRequestUrl(dataUrl, origin);
}

function normalizeReferenceRequestUrl(value: string, origin: string) {
    const url = value.trim();
    if (!url || isRemoteMediaUrl(url) || /^(data|blob):/i.test(url) || !origin) return url;
    try {
        const absolute = new URL(url, origin);
        const proxiedUrl = absolute.searchParams.get("url") || "";
        if ((absolute.pathname === "/api/media-proxy" || /^\/api\/ai\/system\/[^/]+\/_media$/.test(absolute.pathname)) && isRemoteMediaUrl(proxiedUrl)) return proxiedUrl;
        if (url.startsWith("/")) return absolute.toString();
    } catch {
        return url;
    }
    return url;
}

async function runGeminiImageTask(task: ImageTask, origin: string, cookie: string) {
    if (task.mask) throw new Error("Gemini 暂不支持蒙版编辑");
    const config = task.config;
    const parts: GeminiPart[] = [{ text: withSystemPrompt(config, task.prompt) }];
    task.references.forEach((reference) => parts.push(toGeminiImagePart(referenceRequestUrl(reference, origin), reference.type)));
    const response = await taskFetch(config, `${geminiApiUrl(config, "generateContent", origin)}`, {
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
    if (config.apiSource !== "system" || !config.baseUrl.trim().startsWith("/api/ai/system/")) return null;
    return {
        apiSource: "system",
        baseUrl: config.baseUrl.trim(),
        apiKey: "system",
        apiFormat: config.apiFormat === "gemini" ? "gemini" : "openai",
        model: rawModelName(config.model),
        quality: config.quality || "auto",
        size: config.size || "auto",
        systemPrompt: "",
    };
}

function rawModelName(value: string) {
    const model = value.trim();
    const separator = model.indexOf("::");
    return separator >= 0 ? model.slice(separator + 2).trim() : model;
}

function taskUrl(config: ImageTaskConfig, path: string, origin: string) {
    const apiBase = normalizeApiBaseUrl(config.baseUrl, config.apiFormat, origin);
    return `${apiBase}${path}`;
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", origin: string) {
    const absoluteBase = baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
    const normalized = absoluteBase.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (isInternalSystemProxyBase(normalized)) return normalized;
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function isInternalSystemProxyBase(value: string) {
    try {
        return /^\/api\/ai\/system\/[^/]+$/i.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

function taskHeaders(config: ImageTaskConfig, cookie: string) {
    const headers = new Headers();
    if (config.baseUrl.startsWith("/") && cookie) headers.set("cookie", cookie);
    if (config.apiFormat === "gemini") headers.set("x-goog-api-key", config.apiKey);
    else headers.set("authorization", `Bearer ${config.apiKey}`);
    return headers;
}

function taskFetch(config: ImageTaskConfig, url: string, init: RequestInit) {
    const nextInit = {
        ...init,
        signal: init.signal || AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    };
    return isInternalApiBaseUrl(config.baseUrl) ? fetchInternalApi(url, nextInit) : fetch(url, nextInit);
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

function parseImagePayload(payload: ImageApiResponse, baseUrl?: string) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "图片生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
    const image = payload.data?.map((item) => resolveImageDataUrl(item, baseUrl)).find(Boolean);
    if (!image) throw new Error("接口没有返回图片");
    return image;
}

function resolveImageDataUrl(item: Record<string, unknown>, baseUrl?: string) {
    if (typeof item.url === "string" && item.url) return resolveGeneratedMediaUrl(item.url, baseUrl);
    if (typeof item.b64_json === "string" && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    return "";
}

async function parseImagePayloadOrPoll(config: ImageTaskConfig, payload: ImageApiResponse, mediaBaseUrl: string, cookie: string, pollBaseUrl = mediaBaseUrl): Promise<ImageTaskResult> {
    const image = parseImagePayloadCompat(payload, mediaBaseUrl, config);
    if (image) return image;

    const taskId = readImageTaskId(payload);
    if (!taskId) throw new Error(readImagePayloadError(payload) || "接口没有返回图片");
    return pollOpenAiImageTask(config, taskId, mediaBaseUrl, pollBaseUrl, cookie, readImagePollUrl(config, payload, mediaBaseUrl, pollBaseUrl));
}

async function pollOpenAiImageTask(config: ImageTaskConfig, taskId: string, mediaBaseUrl: string, pollBaseUrl: string, cookie: string, explicitPollUrl = ""): Promise<ImageTaskResult> {
    const pollUrls = imageTaskPollUrls(pollBaseUrl, taskId, explicitPollUrl);
    let lastError = "";
    for (let attempt = 0; attempt < IMAGE_TASK_POLL_ATTEMPTS; attempt += 1) {
        for (const pollUrl of pollUrls) {
            const response = await taskFetch(config, pollUrl, { method: "GET", headers: taskHeaders(config, cookie), cache: "no-store" });
            if (!response.ok) {
                const message = await readFetchError(response, "图片任务查询失败");
                lastError = message;
                if (response.status === 404 || response.status === 405) continue;
                throw new Error(message);
            }
            const payload = (await response.json()) as ImageApiResponse;
            const baseUrl = response.headers.get("x-vozeb-upstream-url") || mediaBaseUrl || pollUrl;
            const image = parseImagePayloadCompat(payload, baseUrl, config);
            if (image) return image;
            const error = readImagePayloadError(payload);
            if (error) throw new Error(error);
            payload.status = readImageTaskStatus(payload) || payload.status;
            if (!isPendingImageStatus(payload.status)) throw new Error("图片任务完成但没有返回图片");
        }
        await delay(IMAGE_TASK_POLL_INTERVAL_MS);
    }
    throw new Error(lastError || "图片生成超时，请稍后重试");
}

function parseImagePayloadCompat(payload: ImageApiResponse, baseUrl: string, config: ImageTaskConfig): ImageTaskResult | null {
    const error = readImagePayloadError(payload);
    if (error) throw new Error(error);
    return findImageResult(payload, baseUrl, config);
}

function findImageResult(value: unknown, baseUrl: string, config: ImageTaskConfig, depth = 0): ImageTaskResult | null {
    if (!value || depth > 6) return null;
    if (typeof value === "string") {
        const url = resolveImageUrlLike(value, baseUrl, config, false);
        if (url) return url;
        const dataUrl = resolveImageBase64Like(value);
        return dataUrl ? { dataUrl } : null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const image = findImageResult(item, baseUrl, config, depth + 1);
            if (image) return image;
        }
        return null;
    }
    if (typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of IMAGE_URL_KEYS) {
        const image = resolveImageUrlLike(stringField(record, key), baseUrl, config, true);
        if (image) return image;
    }
    for (const key of IMAGE_BASE64_KEYS) {
        const dataUrl = resolveImageBase64Like(stringField(record, key));
        if (dataUrl) return { dataUrl };
    }
    for (const key of IMAGE_CONTAINER_KEYS) {
        const image = findImageResult(record[key], baseUrl, config, depth + 1);
        if (image) return image;
    }
    return null;
}

function resolveImageUrlLike(value: string, baseUrl: string, config: ImageTaskConfig, fromNamedField: boolean) {
    const mediaUrl = value.trim();
    if (!mediaUrl) return null;
    if (/^data:image\//i.test(mediaUrl) || /^blob:/i.test(mediaUrl)) return { dataUrl: mediaUrl };
    if (fromNamedField || isLikelyImageUrl(mediaUrl)) {
        const dataUrl = resolveTaskMediaUrl(config, mediaUrl, baseUrl);
        const remoteUrl = resolveGeneratedMediaUrl(mediaUrl, baseUrl);
        return { dataUrl, remoteUrl: isRemoteMediaUrl(remoteUrl) ? remoteUrl : undefined };
    }
    return null;
}

function resolveImageBase64Like(value: string) {
    const base64 = value.trim();
    if (!base64) return "";
    if (/^data:image\//i.test(base64)) return base64;
    if (base64.length < 64 || !/^[a-z0-9+/=_-]+$/i.test(base64.replace(/\s/g, ""))) return "";
    return `data:image/png;base64,${base64.replace(/\s/g, "")}`;
}

function isLikelyImageUrl(value: string) {
    return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(value);
}

function resolveImageDataUrlCompat(item: Record<string, unknown>, baseUrl: string, config: ImageTaskConfig) {
    const url = stringField(item, "url") || stringField(item, "image_url") || stringField(item, "output_url") || stringField(item, "download_url");
    if (url) return resolveTaskMediaUrl(config, url, baseUrl);
    const b64 = stringField(item, "b64_json") || stringField(item, "base64") || stringField(item, "image_base64");
    if (b64) return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
    return "";
}

function collectImageRecords(value: unknown, depth = 0): Record<string, unknown>[] {
    if (!value || depth > 4) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectImageRecords(item, depth + 1));
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const items: Record<string, unknown>[] = [];
    if (hasImageLikeField(record)) items.push(record);
    for (const key of ["data", "result", "results", "content", "output", "images", "image"]) {
        items.push(...collectImageRecords(record[key], depth + 1));
    }
    return items;
}

function hasImageLikeField(record: Record<string, unknown>) {
    return ["url", "image_url", "output_url", "download_url", "b64_json", "base64", "image_base64"].some((key) => typeof record[key] === "string" && Boolean(String(record[key]).trim()));
}

function readImagePayloadError(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) return payload.msg || "图片生成失败";
    if (payload.error?.message) return payload.error.message;
    const status = (payload.status || "").toLowerCase();
    if (["failed", "failure", "error", "cancelled", "canceled", "expired"].includes(status)) return payload.msg || "图片生成失败";
    return "";
}

function readImageTaskId(payload: ImageApiResponse) {
    return findStringByKeys(payload, IMAGE_TASK_ID_KEYS);
}

function readImageTaskStatus(payload: ImageApiResponse) {
    return findStringByKeys(payload, IMAGE_STATUS_KEYS).toLowerCase();
}

function readImagePollUrl(config: ImageTaskConfig, payload: ImageApiResponse, mediaBaseUrl: string, pollBaseUrl: string) {
    const value = findStringByKeys(payload, IMAGE_POLL_URL_KEYS);
    if (!value || config.baseUrl.startsWith("/api/ai/system/")) return "";
    return resolveGeneratedMediaUrl(value, mediaBaseUrl || pollBaseUrl);
}

function findStringByKeys(value: unknown, keys: string[], depth = 0): string {
    if (!value || depth > 5) return "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findStringByKeys(item, keys, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const found = stringField(record, key);
        if (found) return found;
    }
    for (const key of IMAGE_CONTAINER_KEYS) {
        const found = findStringByKeys(record[key], keys, depth + 1);
        if (found) return found;
    }
    return "";
}

function isPendingImageStatus(status?: string) {
    const value = (status || "").toLowerCase();
    return !value || ["pending", "queued", "running", "processing", "in_progress", "created"].includes(value);
}

function imageTaskPollUrls(requestUrl: string, taskId: string, explicitPollUrl = "") {
    const cleanUrl = requestUrl.split("?")[0].replace(/\/+$/, "");
    return Array.from(new Set([explicitPollUrl, `${cleanUrl}/${encodeURIComponent(taskId)}`].filter(Boolean)));
}

function resolveTaskMediaUrl(config: ImageTaskConfig, value: string, baseUrl: string) {
    if (/^(data|blob):/i.test(value)) return value;
    if (!config.baseUrl.startsWith("/api/ai/system/")) return resolveGeneratedMediaUrl(value, baseUrl);
    const proxyBase = config.baseUrl.trim().replace(/\/+$/, "");
    return `${proxyBase}/_media?url=${encodeURIComponent(value)}`;
}

async function inlineRemoteImageResult(value: string, origin: string, cookie: string, remoteFallback?: string) {
    const url = (value || "").trim();
    if (!url || url.startsWith("data:")) return { dataUrl: url, remoteUrl: remoteFallback };
    const mediaSource = resolveProxiedMediaSource(url, origin);
    const remoteUrl = mediaSource.remoteUrl || remoteFallback || (isRemoteMediaUrl(url) && !mediaSource.proxyUrl ? url : undefined);
    const fallbackUrl = remoteUrl || mediaSource.proxyUrl;
    const fetchUrl = url.startsWith("/") ? `${origin}${url}` : url;
    if (!isRemoteMediaUrl(fetchUrl)) return { dataUrl: url, remoteUrl: fallbackUrl };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INLINE_IMAGE_TIMEOUT_MS);
    try {
        const response = await fetch(fetchUrl, {
            headers: cookie && url.startsWith("/") ? { cookie } : undefined,
            cache: "no-store",
            signal: controller.signal,
        });
        if (!response.ok || !response.body) return { dataUrl: url, remoteUrl: fallbackUrl };
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > MAX_INLINE_IMAGE_BYTES) return { dataUrl: url, remoteUrl: fallbackUrl };
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_INLINE_IMAGE_BYTES) return { dataUrl: url, remoteUrl: fallbackUrl };
        const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
        if (!mimeType.startsWith("image/")) return { dataUrl: url, remoteUrl: fallbackUrl };
        return { dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`, remoteUrl: fallbackUrl };
    } catch {
        return { dataUrl: url, remoteUrl: fallbackUrl };
    } finally {
        clearTimeout(timer);
    }
}

function resolveProxiedMediaSource(value: string, origin: string) {
    const trimmed = value.trim();
    const absolute = trimmed.startsWith("/") ? `${origin}${trimmed}` : trimmed;
    try {
        const parsed = new URL(absolute);
        const isSameOrigin = parsed.origin === origin;
        const isProxyPath = parsed.pathname === "/api/media-proxy" || /^\/api\/ai\/system\/[^/]+\/_media$/.test(parsed.pathname);
        if (!isProxyPath) return {};
        const sourceUrl = parsed.searchParams.get("url") || "";
        const proxyUrl = trimmed.startsWith("/") || isSameOrigin ? `${parsed.pathname}${parsed.search}` : trimmed;
        return {
            remoteUrl: isRemoteMediaUrl(sourceUrl) ? sourceUrl : undefined,
            proxyUrl,
        };
    } catch {
        return {};
    }
}

function shouldFallbackToJsonImageEdit(status: number, message: string) {
    if (status === 404 || status === 405 || status === 415) return true;
    if (status !== 400 && status !== 422) return false;
    return /multipart|form-?data|file upload|prompt.*required|required.*prompt|image url|image file|input image|reference image|invalid image|images\[\]|unsupported|not supported/i.test(message);
}

function shouldTryNextImageResponseFormat(responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number], status: number, message: string) {
    if (status !== 400 && status !== 422) return false;
    if (responseFormat === "url") return /response[_ -]?format|url|unsupported|not supported|invalid/i.test(message);
    if (responseFormat === "b64_json") return /response[_ -]?format|b64|base64|unsupported|not supported|invalid/i.test(message);
    return false;
}

function shouldRetryJsonImageEditPayload(status: number, message: string) {
    if (status === 400 || status === 422) return /image|images|image_url|input_image|reference|invalid type|unmarshal|deserialize|field/i.test(message);
    return status >= 500 && /task[_ -]?id is empty|invalid_response|invalid type|unmarshal|deserialize/i.test(message);
}

function shouldFallbackToResponsesImage(status: number, message: string) {
    if (status === 401 || status === 403 || status === 429) return false;
    if (status === 404 || status === 405 || status === 415) return true;
    if (status === 400 || status === 422) return /images\/generations|images\/edits|endpoint|route|not found|not implemented|no such|cannot post|unsupported|not supported/i.test(message);
    return status >= 500 && /images\/generations|images\/edits|endpoint|route|not found|not implemented|no such|cannot post|unsupported|not supported/i.test(message);
}

function stringField(record: Record<string, unknown>, key: string) {
    const value = record[key];
    return typeof value === "string" ? value.trim() : "";
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

async function buildImageEditFormData(task: ImageTask, quality: string | undefined, requestSize: string | undefined, origin: string, cookie: string, responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number]) {
    const formData = new FormData();
    formData.set("model", task.config.model);
    formData.set("prompt", withSystemPrompt(task.config, task.prompt));
    formData.set("n", "1");
    formData.set("response_format", responseFormat);
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) formData.set("quality", quality);
    if (requestSize) formData.set("size", requestSize);
    const referenceFiles = await Promise.all(task.references.map((reference, index) => imageReferenceToFile(reference, reference.name || `reference-${index + 1}.png`, origin, cookie)));
    referenceFiles.forEach((file) => formData.append("image", file));
    if (task.mask) formData.set("mask", await imageReferenceToFile(task.mask, task.mask.name || "mask.png", origin, cookie));
    return formData;
}

async function imageReferenceToFile(reference: ImageTaskReference, name: string, origin: string, cookie: string) {
    const value = referenceRequestUrl(reference);
    if (!value) throw new Error("参考图读取失败");
    if (/^data:image\//i.test(value)) return dataUrlToFile(value, name, reference.type);
    if (/^blob:/i.test(value)) throw new Error("参考图本地缓存已失效，请重新上传参考图");
    const fetchUrl = value.startsWith("/") ? `${origin}${value}` : value;
    if (!isRemoteMediaUrl(fetchUrl)) throw new Error("参考图地址无效，请重新上传参考图");
    const response = await fetch(fetchUrl, {
        headers: cookie && value.startsWith("/") ? { cookie } : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(INLINE_IMAGE_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) throw new Error("参考图读取失败");
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_INLINE_IMAGE_BYTES) throw new Error("参考图过大，请压缩后重试");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("参考图读取失败");
    if (bytes.length > MAX_INLINE_IMAGE_BYTES) throw new Error("参考图过大，请压缩后重试");
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || reference.type || "image/png";
    if (!mimeType.startsWith("image/")) throw new Error("参考图不是有效图片");
    return new File([bytes], name, { type: mimeType });
}

function dataUrlToFile(dataUrl: string, name: string, fallbackType?: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error("参考图不是有效 base64 图片");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) throw new Error("参考图读取失败");
    return new File([bytes], name, { type: fallbackType || match[1] || "image/png" });
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    const statusText = `${fallback}，状态码 ${response.status}`;
    if (!text) return statusText;
    try {
        const payload = JSON.parse(text) as { error?: { message?: string }; message?: string; msg?: string };
        return payload.msg || payload.message || payload.error?.message || statusText;
    } catch {
        return text.slice(0, 300) || statusText;
    }
}

function readPointsRemaining(headers: Headers) {
    const value = headers.get("x-vozeb-points-remaining");
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isRemoteMediaUrl(value: string) {
    return /^https?:\/\//i.test(value);
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
