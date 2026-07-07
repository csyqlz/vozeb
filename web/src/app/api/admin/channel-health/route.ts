import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type HealthKind = "text" | "image" | "video";

type HealthPayload = {
    baseUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
    kind?: unknown;
};

type HealthResult = {
    ok: boolean;
    kind: HealthKind;
    model: string;
    status: number;
    pointsCost?: number;
    pointsRemaining?: number;
    taskId?: string;
    remoteUrl?: string;
    error?: string;
};

const HEALTH_COOLDOWN_MS = 20_000;
const VIDEO_HEALTH_REFERENCE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const globalCooldownStore = globalThis as typeof globalThis & { __vozebChannelHealthCooldowns?: Map<string, number> };
const healthCooldowns = (globalCooldownStore.__vozebChannelHealthCooldowns ??= new Map<string, number>());

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const body = await readJsonBody<HealthPayload>(request);
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const kind = body.kind === "image" || body.kind === "video" || body.kind === "text" ? body.kind : "";
    if (!baseUrl || !apiKey || !model || !kind) return NextResponse.json({ error: "请填写 Base URL、API Key，并选择要测试的模型" }, { status: 400 });

    const cooldownKey = `${currentUser.id}:${baseUrl.toLowerCase()}:${kind}`;
    const waitMs = (healthCooldowns.get(cooldownKey) || 0) - Date.now();
    if (waitMs > 0) return NextResponse.json({ error: `接口测试过于频繁，请 ${Math.ceil(waitMs / 1000)} 秒后再试` }, { status: 429 });
    healthCooldowns.set(cooldownKey, Date.now() + HEALTH_COOLDOWN_MS);

    try {
        const result = kind === "text" ? await testText(baseUrl, apiKey, model) : kind === "image" ? await testImage(baseUrl, apiKey, model) : await testVideo(baseUrl, apiKey, model);
        return NextResponse.json({ result });
    } catch (error) {
        const message = error instanceof Error ? error.message : "接口测试失败";
        return NextResponse.json({ result: { ok: false, kind, model, status: 0, error: message } satisfies HealthResult }, { status: 200 });
    }
}

async function testText(baseUrl: string, apiKey: string, model: string): Promise<HealthResult> {
    const response = await fetch(apiUrl(baseUrl, "/chat/completions"), {
        method: "POST",
        headers: jsonHeaders(apiKey),
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply exactly OK." }], max_tokens: 8 }),
        cache: "no-store",
    });
    const payload = await readPayload(response);
    if (!response.ok) return failed("text", model, response.status, payload);
    return { ok: true, kind: "text", model, status: response.status, ...pointsInfo(response.headers) };
}

async function testImage(baseUrl: string, apiKey: string, model: string): Promise<HealthResult> {
    for (const responseFormat of ["url", "b64_json"] as const) {
        const response = await fetch(apiUrl(baseUrl, "/images/generations"), {
            method: "POST",
            headers: jsonHeaders(apiKey),
            body: JSON.stringify({
                model,
                prompt: "A single blue circle icon on a white background.",
                n: 1,
                size: "1024x1024",
                quality: "low",
                response_format: responseFormat,
            }),
            cache: "no-store",
        });
        const payload = await readPayload(response);
        if (response.ok) {
            return {
                ok: true,
                kind: "image",
                model,
                status: response.status,
                remoteUrl: findStringByKeys(payload, [
                    "url",
                    "image_url",
                    "imageUrl",
                    "media_url",
                    "mediaUrl",
                    "source_url",
                    "sourceUrl",
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
                ]),
                ...pointsInfo(response.headers),
            };
        }
        const message = errorMessage(payload, `图片测试失败，状态码 ${response.status}`);
        if (responseFormat === "url" && /response[_ -]?format|url|unsupported|not supported|invalid|not implemented/i.test(message)) continue;
        return failed("image", model, response.status, payload);
    }
    return { ok: false, kind: "image", model, status: 0, error: "图片测试失败" };
}

async function testVideo(baseUrl: string, apiKey: string, model: string): Promise<HealthResult> {
    const basePayload = {
        model,
        prompt: "A calm 5 second shot of a blue circle logo on a white background.",
        n: 1,
        size: "1280x720",
        width: 1280,
        height: 720,
        response_format: "url",
        ratio: "16:9",
        aspect_ratio: "16:9",
        resolution: "480p",
        quality: "480p",
        async: true,
        generate_audio: false,
        watermark: false,
    };
    return testVideoPayloads(baseUrl, apiKey, model, buildVideoHealthPayloads(basePayload), false);
}

async function testVideoPayloads(baseUrl: string, apiKey: string, model: string, payloads: Array<Record<string, unknown>>, allowReferenceRetry: boolean): Promise<HealthResult> {
    for (const path of ["/videos", "/video/generations", "/videos/generations"]) {
        for (const payload of payloads) {
            const response = await fetch(apiUrl(baseUrl, path), {
                method: "POST",
                headers: jsonHeaders(apiKey),
                body: JSON.stringify(payload),
                cache: "no-store",
            });
            const data = await readPayload(response);
            if (response.ok) {
                return {
                    ok: true,
                    kind: "video",
                    model,
                    status: response.status,
                    ...pointsInfo(response.headers),
                    taskId: findStringByKeys(data, ["task_id", "taskId", "id", "job_id", "jobId"]),
                    remoteUrl: findStringByKeys(data, [
                        "video_url",
                        "videoUrl",
                        "media_url",
                        "mediaUrl",
                        "play_url",
                        "playUrl",
                        "stream_url",
                        "streamUrl",
                        "source_url",
                        "sourceUrl",
                        "content_url",
                        "contentUrl",
                        "url",
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
                    ]),
                };
            }
            const message = errorMessage(data, `视频测试失败，状态码 ${response.status}`);
            if (/not found|not implemented|route|endpoint|unsupported|no such|cannot post|invalid url|404/i.test(message)) break;
            if (shouldRetryVideoHealthPayload(response.status, message)) continue;
            if (!allowReferenceRetry && shouldRetryVideoHealthWithReference(message)) {
                return testVideoPayloads(baseUrl, apiKey, model, buildVideoHealthPayloads(payload, true), true);
            }
            return failed("video", model, response.status, data);
        }
    }
    return { ok: false, kind: "video", model, status: 0, error: "视频测试失败：所有兼容路径都不可用" };
}

function buildVideoHealthPayloads(basePayload: Record<string, unknown>, withReference = false) {
    const { seconds: _seconds, duration: _duration, ...cleanBasePayload } = basePayload;
    const mediaPayloads: Array<Record<string, unknown>> = withReference
        ? [
              { input_image: { url: VIDEO_HEALTH_REFERENCE_IMAGE } },
              { image_url: { url: VIDEO_HEALTH_REFERENCE_IMAGE } },
              { image: VIDEO_HEALTH_REFERENCE_IMAGE },
              { image: VIDEO_HEALTH_REFERENCE_IMAGE, images: [VIDEO_HEALTH_REFERENCE_IMAGE], ref_assets: [VIDEO_HEALTH_REFERENCE_IMAGE] },
              { image: { url: VIDEO_HEALTH_REFERENCE_IMAGE }, images: [{ url: VIDEO_HEALTH_REFERENCE_IMAGE }], ref_assets: [{ url: VIDEO_HEALTH_REFERENCE_IMAGE }] },
          ]
        : [{}];
    return mediaPayloads.flatMap((mediaPayload) => [
        { ...cleanBasePayload, ...mediaPayload, seconds: "5" },
        { ...cleanBasePayload, ...mediaPayload, duration: 5 },
        { ...cleanBasePayload, ...mediaPayload, seconds: "5", duration: 5 },
    ]);
}

function shouldRetryVideoHealthPayload(status: number, message: string) {
    if (status !== 400 && status !== 422) return false;
    return /duration|seconds|duplicate field|unmarshal|invalid type|resolution|quality|size|field|image|images|input_image|ref_assets/i.test(message);
}

function shouldRetryVideoHealthWithReference(message: string) {
    return /text-to-video|image-to-video|input image|reference image|image is required|requires image|not supported for this model/i.test(message);
}

function failed(kind: HealthKind, model: string, status: number, payload: unknown): HealthResult {
    return { ok: false, kind, model, status, error: errorMessage(payload, `接口测试失败，状态码 ${status}`) };
}

function pointsInfo(headers: Headers) {
    const pointsCost = numericHeader(headers, "x-vozeb-points-cost");
    const pointsRemaining = numericHeader(headers, "x-vozeb-points-remaining");
    return {
        ...(pointsCost !== undefined ? { pointsCost } : {}),
        ...(pointsRemaining !== undefined ? { pointsRemaining } : {}),
    };
}

function numericHeader(headers: Headers, key: string) {
    const value = Number(headers.get(key));
    return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

function jsonHeaders(apiKey: string) {
    return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

function apiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const apiBase = normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`;
    return `${apiBase}${path}`;
}

async function readPayload(response: Response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { message: text.slice(0, 500) };
    }
}

function errorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== "object") return fallback;
    const record = payload as Record<string, unknown>;
    const direct = stringValue(record.message) || stringValue(record.msg) || stringValue(record.detail);
    if (direct) return direct;
    const error = record.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") return stringValue((error as Record<string, unknown>).message) || stringValue((error as Record<string, unknown>).msg) || fallback;
    return fallback;
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
        const found = stringValue(record[key]);
        if (found) return found;
    }
    for (const item of Object.values(record)) {
        const found = findStringByKeys(item, keys, depth + 1);
        if (found) return found;
    }
    return "";
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
