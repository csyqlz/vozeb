import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveGeneratedMediaUrl } from "@/lib/media-url";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { countActiveImageTasksForUser, createImageTask, updateImageTask, type ImageTask, type ImageTaskConfig, type ImageTaskReference } from "@/lib/server/image-task-store";
import { isGenerationSource, recordGenerationLog } from "@/lib/server/generation-log-store";
import { writeReferenceImageDataUrl } from "@/lib/server/reference-asset-store";

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
type ImageTaskRunResult = ImageTaskResult & { pointsRemaining?: number };

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
type ImageEditReferenceMode = "auto" | "multipart" | "json" | "public-url";

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
        references: Array.isArray(body.references) ? body.references.filter((item) => Boolean(item?.dataUrl || item?.url || item?.remoteUrl || item?.serverUrl)) : [],
        mask: body.mask?.dataUrl || body.mask?.url || body.mask?.remoteUrl || body.mask?.serverUrl ? body.mask : undefined,
    });
    const cookie = request.headers.get("cookie") || "";
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const publicOrigin = requestPublicOrigin(request);
    void runImageTask(task, origin, publicOrigin, cookie);

    return NextResponse.json({ task: publicTask(task) });
}

async function runImageTask(task: ImageTask, origin: string, publicOrigin: string, cookie: string) {
    updateImageTask(task.id, { status: "running" });
    const heartbeat = setInterval(() => {
        updateImageTask(task.id, { status: "running" });
    }, TASK_HEARTBEAT_MS);
    try {
        const result = task.config.apiFormat === "gemini" ? await runGeminiImageTask(task, origin, cookie) : await runOpenAiImageTask(task, origin, publicOrigin, cookie);
        const resultRemoteUrl = (result as { remoteUrl?: unknown }).remoteUrl;
        const safeResult =
            directRemoteImageResult(result.dataUrl, typeof resultRemoteUrl === "string" ? resultRemoteUrl : undefined) || (await inlineRemoteImageResult(result.dataUrl, origin, cookie, typeof resultRemoteUrl === "string" ? resultRemoteUrl : undefined));
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

async function runOpenAiImageTask(task: ImageTask, origin: string, publicOrigin: string, cookie: string): Promise<ImageTaskRunResult> {
    const config = task.config;
    const quality = normalizeQuality(config.quality || "");
    const requestSize = resolveRequestSize(quality, config.size || "auto");
    const path = await openAiImageTaskPath(config, task.kind);
    const url = taskUrl(config, path, origin);
    const headers = taskHeaders(config, cookie);
    const responseFormat = await preferredImageResponseFormat(config);
    const useJsonImageEdit = task.kind === "edit" && (await shouldUseJsonImageEdit(config, task, origin, publicOrigin));
    if (useJsonImageEdit) return runOpenAiJsonImageEditTask(task, url, origin, publicOrigin, quality, requestSize, cookie, responseFormat);
    let response: Response;

    if (task.kind === "edit") {
        let formData: FormData;
        try {
            formData = await buildImageEditFormData(task, quality, requestSize, origin, cookie, "url");
        } catch (error) {
            throw error instanceof Error ? error : new Error("参考图读取失败，请重新上传参考图");
        }
        response = await taskFetch(config, url, { method: "POST", headers, body: formData, cache: "no-store" });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            if (shouldFallbackToJsonImageEdit(response.status, message)) return runOpenAiJsonImageEditTask(task, url, origin, publicOrigin, quality, requestSize, cookie, "url");
            if (shouldTryNextImageResponseFormat("url", response.status, message)) return runOpenAiImageTaskWithBase64Response(task, origin, publicOrigin, cookie);
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
                response_format: responseFormat,
                output_format: IMAGE_OUTPUT_FORMAT,
            }),
            cache: "no-store",
        });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            if (shouldTryNextImageResponseFormat(responseFormat, response.status, message)) return runOpenAiImageTaskWithBase64Response(task, origin, publicOrigin, cookie);
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
    }

    if (!response.ok) throw new Error(await readFetchError(response, "图片生成失败"));
    const payload = (await response.json()) as ImageApiResponse;
    const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
    const result = await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url);
    if (responseFormat === "url" && shouldRetryInternalImageUrlAsBase64(result)) return runOpenAiImageTaskWithBase64Response(task, origin, publicOrigin, cookie);
    return { ...result, pointsRemaining: readPointsRemaining(response.headers) };
}

async function runOpenAiJsonImageEditTask(
    task: ImageTask,
    url: string,
    origin: string,
    publicOrigin: string,
    quality: string | undefined,
    requestSize: string | undefined,
    cookie: string,
    responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number] = "b64_json",
): Promise<ImageTaskRunResult> {
    const config = task.config;
    const headers = taskHeaders(config, cookie);
    headers.set("content-type", "application/json");
    let lastMessage = "";
    const apiBase = await resolveConfiguredApiBaseUrl(task.config.baseUrl).catch(() => task.config.baseUrl);
    const referenceMode = configuredImageEditReferenceMode(config);
    const imageUrlObjectOnlyMode = shouldUseSub2ApiImageEdit(config, apiBase);
    const publicUrlReferenceMode = imageUrlObjectOnlyMode || referenceMode === "public-url" || (referenceMode === "auto" && isQingyanApiBase(apiBase));
    for (const body of await buildJsonImageEditBodies(task, quality, requestSize, responseFormat, origin, publicOrigin, publicUrlReferenceMode, imageUrlObjectOnlyMode)) {
        const response = await taskFetch(config, url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            lastMessage = message;
            if (imageUrlObjectOnlyMode) throw new Error(message);
            if (shouldRetryJsonImageEditPayload(response.status, message)) continue;
            if (shouldTryNextImageResponseFormat(responseFormat, response.status, message)) {
                if (responseFormat === "url") return runOpenAiJsonImageEditTask(task, url, origin, publicOrigin, quality, requestSize, cookie, "b64_json");
                return runOpenAiResponsesImageTask(task, origin, cookie);
            }
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
        const payload = (await response.json()) as ImageApiResponse;
        const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
        const result = await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url);
        if (responseFormat === "url" && shouldRetryInternalImageUrlAsBase64(result)) return runOpenAiJsonImageEditTask(task, url, origin, publicOrigin, quality, requestSize, cookie, "b64_json");
        return { ...result, pointsRemaining: readPointsRemaining(response.headers) };
    }
    if (shouldTryNextImageResponseFormat(responseFormat, 400, lastMessage)) {
        if (responseFormat === "url") return runOpenAiJsonImageEditTask(task, url, origin, publicOrigin, quality, requestSize, cookie, "b64_json");
        return runOpenAiResponsesImageTask(task, origin, cookie);
    }
    throw new Error(lastMessage || "图片生成失败");
}

async function runOpenAiImageTaskWithBase64Response(task: ImageTask, origin: string, publicOrigin: string, cookie: string): Promise<ImageTaskRunResult> {
    const config = task.config;
    const quality = normalizeQuality(config.quality || "");
    const requestSize = resolveRequestSize(quality, config.size || "auto");
    const path = await openAiImageTaskPath(config, task.kind);
    const url = taskUrl(config, path, origin);
    const headers = taskHeaders(config, cookie);

    if (task.kind === "edit") {
        let formData: FormData;
        try {
            formData = await buildImageEditFormData(task, quality, requestSize, origin, cookie, "b64_json");
        } catch (error) {
            throw error instanceof Error ? error : new Error("参考图读取失败，请重新上传参考图");
        }
        const response = await taskFetch(config, url, { method: "POST", headers, body: formData, cache: "no-store" });
        if (!response.ok) {
            const message = await readFetchError(response, "图片生成失败");
            if (shouldFallbackToJsonImageEdit(response.status, message)) return runOpenAiJsonImageEditTask(task, url, origin, publicOrigin, quality, requestSize, cookie, "b64_json");
            if (shouldFallbackToResponsesImage(response.status, message)) return runOpenAiResponsesImageTask(task, origin, cookie);
            throw new Error(message);
        }
        const payload = (await response.json()) as ImageApiResponse;
        const resultBaseUrl = response.headers.get("x-vozeb-upstream-url") || url;
        const result = await parseImagePayloadOrPoll(config, payload, resultBaseUrl, cookie, url);
        return { ...result, pointsRemaining: readPointsRemaining(response.headers) };
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

async function runOpenAiResponsesImageTask(task: ImageTask, origin: string, cookie: string): Promise<ImageTaskRunResult> {
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
    const prompt = withSystemPrompt(task.config, buildImageReferencePromptText(task.prompt, task.references));
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

async function buildJsonImageEditBodies(
    task: ImageTask,
    quality: string | undefined,
    requestSize: string | undefined,
    responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number],
    origin: string,
    publicOrigin: string,
    publicUrlReferenceMode = false,
    imageUrlObjectOnlyMode = false,
) {
    const images = (await Promise.all(task.references.map((reference) => (publicUrlReferenceMode ? publicImageReferenceRequestUrl(reference, origin, publicOrigin) : Promise.resolve(jsonImageReferenceRequestUrl(reference, origin)))))).filter(Boolean);
    const mask = task.mask ? (publicUrlReferenceMode ? await publicImageReferenceRequestUrl(task.mask, origin, publicOrigin) : jsonImageReferenceRequestUrl(task.mask, origin)) : "";
    const prompt = imageUrlObjectOnlyMode ? buildSub2ApiImageEditPrompt(task.prompt, task.references) : buildImageReferencePromptText(task.prompt, task.references);
    const base = {
        model: task.config.model,
        prompt: withSystemPrompt(task.config, prompt),
        n: 1,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        response_format: responseFormat,
        output_format: IMAGE_OUTPUT_FORMAT,
        ...(mask ? { mask } : {}),
    };
    if (!images.length) return [base];
    const first = images[0];
    const imageUrlObjects = images.map((item) => ({ image_url: item }));
    const imageObjects = images.map((item) => ({ url: item }));
    if (imageUrlObjectOnlyMode) {
        return [
            {
                model: task.config.model,
                prompt: withSystemPrompt(task.config, prompt),
                n: 1,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                ...(mask ? { mask } : {}),
                image_urls: images,
            },
        ];
    }
    return [
        { ...base, images: imageUrlObjects, ref_assets: imageUrlObjects, image_urls: imageUrlObjects },
        { ...base, ...(images.length === 1 ? { image: first } : {}), images, ref_assets: images, image_urls: images },
        { ...base, image_url: first },
        { ...base, input_image: first },
        { ...base, image: first },
        { ...base, images: imageObjects, ref_assets: imageObjects, image_urls: imageObjects },
    ];
}

function buildSub2ApiImageEditPrompt(prompt: string, references: readonly unknown[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const fieldHint = references.length === 1 ? "image_urls[0]" : "image_urls";
    return [
        `Use the actual reference image supplied in the JSON field ${fieldHint} as visual input, not as a text-only hint.`,
        "The first reference image, image_urls[0], is the primary identity and character reference. Keep the same person or character, face proportions, hairstyle, body shape, clothing, and main pose as much as possible.",
        "Only apply the user's requested edit to the existing referenced subject. Do not replace the referenced person or character with a new unrelated person.",
        "",
        `User request: ${text}`,
    ].join("\n");
}

function referenceRequestUrl(reference: ImageTaskReference, origin = "") {
    return referenceRequestUrlCandidates(reference, origin)[0] || "";
}

function jsonImageReferenceRequestUrl(reference: ImageTaskReference, origin = "") {
    const remoteUrl = referenceRequestUrlCandidates(reference, origin).find((value) => isExternalPublicMediaUrl(value));
    if (remoteUrl) return remoteUrl;
    return referenceRequestUrl(reference, origin);
}

async function publicImageReferenceRequestUrl(reference: ImageTaskReference, origin: string, publicOrigin: string) {
    const candidates = referenceRequestUrlCandidates(reference, origin).filter((value) => isExternalPublicMediaUrl(value));
    if (candidates.length) return candidates[0];

    const dataUrl = (reference.dataUrl || "").trim();
    if (!/^data:image\//i.test(dataUrl)) throw new Error("\u53c2\u8003\u56fe\u9700\u8981\u516c\u7f51\u56fe\u7247 URL\uff0c\u8bf7\u91cd\u65b0\u4e0a\u4f20\u53c2\u8003\u56fe");
    if (!isExternalPublicOrigin(publicOrigin))
        throw new Error("\u53c2\u8003\u56fe\u9700\u8981\u516c\u7f51\u56fe\u7247 URL\uff1b\u672c\u5730\u5f00\u53d1 localhost \u4e0d\u80fd\u76f4\u63a5\u63d0\u4ea4\u7ed9\u4e0a\u6e38\uff0c\u8bf7\u90e8\u7f72\u540e\u914d\u7f6e NEXT_PUBLIC_SITE_URL");
    const asset = await writeReferenceImageDataUrl(dataUrl);
    return `${publicOrigin.replace(/\/+$/, "")}/api/reference-assets/${asset.token}`;
}

function referenceRequestUrlCandidates(reference: ImageTaskReference, origin = "") {
    return uniqueStrings([reference.remoteUrl, reference.url, reference.serverUrl, reference.dataUrl].map((value) => normalizeReferenceRequestUrl(value || "", origin)).filter(Boolean));
}

function rawReferenceRequestUrlCandidates(reference: ImageTaskReference) {
    return uniqueStrings([reference.remoteUrl, reference.url, reference.serverUrl, reference.dataUrl].map((value) => (value || "").trim()).filter(Boolean));
}

function imageEditReferences(task: ImageTask) {
    return [...task.references, ...(task.mask ? [task.mask] : [])];
}

function canUsePublicImageReferences(task: ImageTask, origin: string, publicOrigin: string) {
    const references = imageEditReferences(task);
    if (!references.length) return false;
    return references.every((reference) => referenceRequestUrlCandidates(reference, origin).some((value) => isExternalPublicMediaUrl(value)) || (isExternalPublicOrigin(publicOrigin) && /^data:image\//i.test((reference.dataUrl || "").trim())));
}

function uniqueStrings(values: string[]) {
    return Array.from(new Set(values));
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

function requestPublicOrigin(request: Request) {
    const configured = normalizePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL || "");
    if (configured) return configured;
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host") || requestUrl.host;
    const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
    return normalizePublicOrigin(`${proto}://${host}`);
}

function normalizePublicOrigin(value: string) {
    try {
        const url = new URL(value.trim().replace(/\/+$/, ""));
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.origin;
    } catch {
        return "";
    }
}

function isExternalPublicOrigin(value: string) {
    if (!value) return false;
    try {
        return isExternalPublicHost(new URL(value).hostname);
    } catch {
        return false;
    }
}

function isExternalPublicMediaUrl(value: string) {
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) return false;
    try {
        return isExternalPublicHost(new URL(url).hostname);
    } catch {
        return false;
    }
}

function isExternalPublicHost(hostname: string) {
    const host = hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
        const [a, b] = parts;
        return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0);
    }
    return host.includes(".");
}

async function runGeminiImageTask(task: ImageTask, origin: string, cookie: string): Promise<ImageTaskRunResult> {
    if (task.mask) throw new Error("Gemini 暂不支持蒙版编辑");
    const config = task.config;
    const parts: GeminiPart[] = [{ text: withSystemPrompt(config, buildImageReferencePromptText(task.prompt, task.references)) }];
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
        advancedConfig: sanitizeAdvancedConfig(config.advancedConfig),
    };
}

function sanitizeAdvancedConfig(config?: ImageTaskConfig["advancedConfig"]) {
    if (!config || typeof config !== "object") return undefined;
    return {
        protocol: config.protocol || "auto",
        textModel: textOrEmpty(config.textModel),
        imageModel: textOrEmpty(config.imageModel),
        videoModel: textOrEmpty(config.videoModel),
        createPath: textOrEmpty(config.createPath),
        queryPath: textOrEmpty(config.queryPath),
        requestTemplate: textOrEmpty(config.requestTemplate),
        resultField: textOrEmpty(config.resultField),
        statusField: textOrEmpty(config.statusField),
        durationRange: textOrEmpty(config.durationRange),
        referenceRule: textOrEmpty(config.referenceRule),
        supportsReferenceImage: Boolean(config.supportsReferenceImage),
        supportsReferenceVideo: Boolean(config.supportsReferenceVideo),
        supportsReferenceAudio: Boolean(config.supportsReferenceAudio),
    };
}

function textOrEmpty(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function rawModelName(value: string) {
    const model = value.trim();
    const separator = model.indexOf("::");
    return separator >= 0 ? model.slice(separator + 2).trim() : model;
}

async function preferredImageResponseFormat(config: ImageTaskConfig): Promise<(typeof IMAGE_RESPONSE_FORMATS)[number]> {
    const apiBase = await resolveConfiguredApiBaseUrl(config.baseUrl).catch(() => config.baseUrl);
    return isQingyanApiBase(apiBase) ? "b64_json" : "url";
}

async function openAiImageTaskPath(config: ImageTaskConfig, kind: ImageTask["kind"]) {
    if (kind !== "edit") return "/images/generations";
    const apiBase = await resolveConfiguredApiBaseUrl(config.baseUrl).catch(() => config.baseUrl);
    return shouldUseSub2ApiImageEdit(config, apiBase) ? "/images/generations" : "/images/edits";
}

async function shouldUseJsonImageEdit(config: ImageTaskConfig, task?: ImageTask, origin = "", publicOrigin = "") {
    const apiBase = await resolveConfiguredApiBaseUrl(config.baseUrl).catch(() => config.baseUrl);
    const referenceMode = configuredImageEditReferenceMode(config);
    if (shouldUseSub2ApiImageEdit(config, apiBase)) return true;
    if (referenceMode === "json" || referenceMode === "public-url") return true;
    if (referenceMode === "multipart") return false;
    return isJsonImageEditApiBase(apiBase);
}

function configuredImageEditReferenceMode(config: ImageTaskConfig): ImageEditReferenceMode {
    const rule = (config.advancedConfig?.referenceRule || "").trim().toLowerCase();
    if (!rule) return "auto";
    if (/\bmultipart\b|form-?data|file upload|\u6587\u4ef6\u4e0a\u4f20|\u4e0a\u4f20\u6587\u4ef6/i.test(rule)) return "multipart";
    if (/\u516c\u7f51|public|next_public_site_url|localhost|must.*\burl\b|\burl\b.*only|\u5fc5\u987b.*\burl\b|\u4ec5.*\burl\b|\u53ea.*\burl\b/i.test(rule)) return "public-url";
    if (/\bjson\b|base64.*json|json.*base64|data:image|inline|ref_assets|input_image|image\/images/i.test(rule)) return "json";
    return "auto";
}

async function resolveConfiguredApiBaseUrl(baseUrl: string) {
    const systemChannelId = readSystemChannelId(baseUrl);
    if (!systemChannelId) return baseUrl;
    const settings = await getAuthSettings();
    return settings.systemChannels.find((channel) => channel.id === systemChannelId)?.baseUrl || baseUrl;
}

function readSystemChannelId(baseUrl: string) {
    try {
        const parsed = new URL(baseUrl, "http://localhost");
        const match = parsed.pathname.match(/^\/api\/ai\/system\/([^/]+)/);
        return match?.[1] ? decodeURIComponent(match[1]) : "";
    } catch {
        return "";
    }
}

function isQingyanApiBase(baseUrl: string) {
    return matchesApiHost(baseUrl, "api2.qingyanzhiying.top");
}

function isJsonImageEditApiBase(baseUrl: string) {
    return isQingyanApiBase(baseUrl) || isCode2AlitaApiBase(baseUrl);
}

function shouldUseSub2ApiImageEdit(config: ImageTaskConfig, apiBase: string) {
    if (config.advancedConfig?.protocol === "sub2api") return true;
    if (isCode2AlitaApiBase(apiBase)) return true;
    const advanced = config.advancedConfig;
    const requestTemplate = (advanced?.requestTemplate || "").toLowerCase();
    const referenceRule = (advanced?.referenceRule || "").toLowerCase();
    if (/\bsub2api\b/i.test(`${requestTemplate}\n${referenceRule}`)) return true;
    return /\bimage_urls\b|images\[\]\.image_url|"images"\s*:\s*\[\s*\{\s*"image_url"|images\s*:\s*\[\s*\{\s*image_url/i.test(requestTemplate);
}

function isCode2AlitaApiBase(baseUrl: string) {
    return matchesApiHost(baseUrl, "code2alita.com");
}

function matchesApiHost(baseUrl: string, hostname: string) {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        const target = hostname.toLowerCase();
        return host === target || host.endsWith(`.${target}`);
    } catch {
        return false;
    }
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
    if (!isInternalApiBaseUrl(config.baseUrl)) return fetch(url, nextInit);
    if (typeof FormData !== "undefined" && nextInit.body instanceof FormData) return fetch(url, nextInit);
    return fetchInternalApi(url, nextInit);
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
    const pollUrls = imageTaskPollUrls(config, pollBaseUrl, taskId, explicitPollUrl);
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
            payload.status = readConfiguredImageTaskStatus(config, payload) || readImageTaskStatus(payload) || payload.status;
            if (isFailedImageStatus(payload.status)) throw new Error("图片生成失败");
            if (!isPendingImageStatus(payload.status)) throw new Error("图片任务完成但没有返回图片");
        }
        await delay(IMAGE_TASK_POLL_INTERVAL_MS);
    }
    throw new Error(lastError || "图片生成超时，请稍后重试");
}

function parseImagePayloadCompat(payload: ImageApiResponse, baseUrl: string, config: ImageTaskConfig): ImageTaskResult | null {
    const error = readImagePayloadError(payload);
    if (error) throw new Error(error);
    return readConfiguredImageResult(config, payload, baseUrl) || findImageResult(payload, baseUrl, config);
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
    for (const key of IMAGE_BASE64_KEYS) {
        const dataUrl = resolveImageBase64Like(stringField(record, key));
        if (dataUrl) return { dataUrl };
    }
    for (const key of IMAGE_URL_KEYS) {
        const image = resolveImageUrlLike(stringField(record, key), baseUrl, config, true);
        if (image) return image;
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

function readConfiguredImageResult(config: ImageTaskConfig, record: unknown, baseUrl: string) {
    for (const path of configuredFieldPaths(config.advancedConfig?.resultField)) {
        const value = valueAtConfiguredPath(record, path);
        const image = configuredImageResultValue(value, baseUrl, config);
        if (image) return image;
    }
    return null;
}

function readConfiguredImageTaskStatus(config: ImageTaskConfig, record: unknown) {
    return readConfiguredStringValue(record, config.advancedConfig?.statusField, "status").toLowerCase();
}

function configuredImageResultValue(value: unknown, baseUrl: string, config: ImageTaskConfig): ImageTaskResult | null {
    if (typeof value === "string" || typeof value === "number") {
        const text = String(value).trim();
        const dataUrl = resolveImageBase64Like(text);
        return resolveImageUrlLike(text, baseUrl, config, true) || (dataUrl ? { dataUrl } : null);
    }
    return findImageResult(value, baseUrl, config);
}

function readConfiguredStringValue(record: unknown, fieldConfig: string | undefined, mode: "media" | "status") {
    for (const path of configuredFieldPaths(fieldConfig)) {
        const value = valueAtConfiguredPath(record, path);
        const text = configuredValueText(value, mode);
        if (text) return text;
    }
    return "";
}

function configuredFieldPaths(value: string | undefined) {
    return (value || "")
        .split(/\r?\n|,|，|;|；|\s+\|\s+|\s+\/\s+/)
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith("/") && !item.includes(":task_id") && !item.includes("{task_id}"));
}

function valueAtConfiguredPath(value: unknown, path: string): unknown {
    const parts = path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .map((item) => item.trim())
        .filter(Boolean);
    let current = value;
    for (const part of parts) {
        if (Array.isArray(current)) {
            const index = Number(part);
            current = Number.isInteger(index) ? current[index] : undefined;
            continue;
        }
        if (!isRecord(current)) return undefined;
        current = current[part] ?? current[Object.keys(current).find((key) => key.toLowerCase() === part.toLowerCase()) || ""];
    }
    return current;
}

function configuredValueText(value: unknown, mode: "media" | "status"): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (mode === "media") return "";
    if (isRecord(value)) return findStringByKeys(value, IMAGE_STATUS_KEYS);
    return "";
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
    return !value || ["pending", "queued", "running", "processing", "in_progress", "created", "submitted", "waiting", "generating"].includes(value);
}

function isFailedImageStatus(status?: string) {
    return ["failed", "failure", "error", "cancelled", "canceled", "expired", "rejected"].includes((status || "").toLowerCase());
}

function imageTaskPollUrls(config: ImageTaskConfig, requestUrl: string, taskId: string, explicitPollUrl = "") {
    const cleanUrl = requestUrl.split("?")[0].replace(/\/+$/, "");
    const encodedTaskId = encodeURIComponent(taskId);
    const configuredPollUrls: string[] = [];
    const configuredPath = normalizeAdvancedImagePath(config.advancedConfig?.queryPath);
    if (/^https?:\/\//i.test(configuredPath)) configuredPollUrls.push(applyTaskIdToImagePath(configuredPath, taskId));
    else if (configuredPath) configuredPollUrls.push(`${imageApiBaseFromRequestUrl(cleanUrl, config)}${applyTaskIdToImagePath(configuredPath, taskId)}`);
    const pollUrls = [explicitPollUrl, ...configuredPollUrls, `${cleanUrl}/${encodedTaskId}`];
    const generationsUrl = cleanUrl.replace(/\/images\/(?:generations|edits)$/i, "/images/generations");
    if (generationsUrl !== cleanUrl) pollUrls.push(`${generationsUrl}/${encodedTaskId}`);
    return Array.from(new Set(pollUrls.filter(Boolean)));
}

function imageApiBaseFromRequestUrl(requestUrl: string, config: ImageTaskConfig) {
    const configuredCreatePath = normalizeAdvancedImagePath(config.advancedConfig?.createPath);
    if (configuredCreatePath && requestUrl.toLowerCase().endsWith(configuredCreatePath.toLowerCase())) return requestUrl.slice(0, -configuredCreatePath.length).replace(/\/+$/, "");
    return requestUrl.replace(/\/images\/(?:generations|edits)$/i, "").replace(/\/+$/, "");
}

function normalizeAdvancedImagePath(value?: string) {
    const path = (value || "").trim();
    if (!path || /^https?:\/\//i.test(path)) return path;
    return path.startsWith("/") ? path : `/${path}`;
}

function applyTaskIdToImagePath(path: string, taskId: string) {
    const encodedTaskId = encodeURIComponent(taskId);
    const templated = path.replace(/\{(?:task_id|taskId|id)\}/g, encodedTaskId).replace(/:(?:task_id|taskId|id)\b/g, encodedTaskId);
    if (templated !== path) return templated;
    return `${path.replace(/\/+$/, "")}/${encodedTaskId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resolveTaskMediaUrl(config: ImageTaskConfig, value: string, baseUrl: string) {
    if (/^(data|blob):/i.test(value)) return value;
    const remoteUrl = resolveGeneratedMediaUrl(value, baseUrl);
    if (!config.baseUrl.startsWith("/api/ai/system/")) return remoteUrl;
    const proxyBase = config.baseUrl.trim().replace(/\/+$/, "");
    return `${proxyBase}/_media?url=${encodeURIComponent(remoteUrl)}`;
}

function shouldRetryInternalImageUrlAsBase64(result: ImageTaskResult) {
    return isInternalGeneratedImageUrl(result.remoteUrl || "") || isInternalGeneratedImageUrl(result.dataUrl || "");
}

function isInternalGeneratedImageUrl(value: string) {
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return !host.includes(".") || host.endsWith(".internal") || host.endsWith(".local");
    } catch {
        return false;
    }
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

function directRemoteImageResult(value: string, remoteUrl?: string) {
    const fallback = (remoteUrl || "").trim();
    if (!isRemoteMediaUrl(fallback) || isInternalGeneratedImageUrl(fallback)) return null;
    return { dataUrl: fallback, remoteUrl: fallback };
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
    return /multipart|form-?data|file upload|prompt.*required|required.*prompt|image url|image file|input image|reference image|invalid image|images\[\]|unsupported|not supported|failed to parse request body|parse request body|invalid request body|request body.*(?:parse|invalid)|body.*(?:parse|invalid)|cannot parse/i.test(
        message,
    );
}

function shouldTryNextImageResponseFormat(responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number], status: number, message: string) {
    if (status !== 400 && status !== 422) return false;
    if (responseFormat === "url") return /response[_ -]?format|url|unsupported|not supported|invalid/i.test(message);
    if (responseFormat === "b64_json") return /response[_ -]?format|b64|base64|unsupported|not supported|invalid/i.test(message);
    return false;
}

function shouldRetryJsonImageEditPayload(status: number, message: string) {
    if (status === 400 || status === 422)
        return /image|images|image_url|input_image|reference|invalid type|unmarshal|deserialize|field|failed to parse request body|parse request body|invalid request body|request body.*(?:parse|invalid)|body.*(?:parse|invalid)|cannot parse/i.test(
            message,
        );
    return false;
}

function shouldFallbackToResponsesImage(status: number, message: string) {
    if (status === 401 || status === 403 || status === 429) return false;
    if (status === 404 || status === 405 || status === 415) return true;
    if (status === 400 || status === 422) return /images\/generations|images\/edits|endpoint|route|not found|not implemented|no such|cannot post|unsupported|not supported/i.test(message);
    return false;
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
    formData.set("prompt", withSystemPrompt(task.config, buildImageReferencePromptText(task.prompt, task.references)));
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
    let lastError: unknown;
    for (const value of rawReferenceRequestUrlCandidates(reference)) {
        try {
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
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("参考图读取失败");
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
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
        const upstreamUrl = response.headers.get("x-vozeb-upstream-url") || "";
        const contentType = response.headers.get("content-type") || "";
        const details = [upstreamUrl ? `地址 ${upstreamUrl}` : "", contentType ? `类型 ${contentType}` : ""].filter(Boolean).join("，");
        return `${fallback}，上游返回了网页错误（HTTP ${response.status}${details ? `，${details}` : ""}），请检查接口路径、鉴权、参考图提交方式或网关状态`;
    }
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
