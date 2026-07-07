import { NextResponse } from "next/server";

import { consumeUserPoints, getAuthSettings, isQuotaExceededError, refundUserPoints, type ApiCallFormat, type GenerationPointMultipliers, type PointUsageKind } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_CHANNEL_CONNECT_ERROR } from "@/lib/server/generation-errors";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type RouteContext = {
    params: Promise<{ channelId: string; path: string[] }>;
};
type PointsRequest = { model: string; amount: number; usageKind: PointUsageKind };

export async function GET(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

async function proxySystemRequest(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { channelId, path } = await context.params;
    const settings = await getAuthSettings();
    const channel = settings.systemChannels.find((item) => item.id === channelId && item.enabled);
    if (!channel || !channel.baseUrl.trim() || !channel.apiKey.trim()) return NextResponse.json({ error: "默认接口未配置或已停用" }, { status: 404 });

    if (isMediaProxyPath(path)) return proxySystemMediaRequest(request, channel);

    const target = targetUrl(channel.baseUrl, channel.apiFormat, path, new URL(request.url).search);
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");
    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    if (channel.apiFormat === "gemini") headers.set("x-goog-api-key", channel.apiKey);
    else headers.set("authorization", `Bearer ${channel.apiKey}`);

    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const pointsRequest = classifyPointsRequest(request.method, channel.apiFormat, path, contentType, body, settings.generationPointMultipliers);
    let pointsResult: Awaited<ReturnType<typeof consumeUserPoints>> | null = null;
    let refundedPointsRemaining: number | null = null;
    let pointsSettled = false;
    const refundConsumedPoints = async () => {
        if (!pointsResult || pointsSettled) return;
        pointsSettled = true;
        const refundedUser = await refundUserPoints(currentUser.id, pointsResult.model, pointsResult.cost, pointsResult.usageKind);
        refundedPointsRemaining = typeof refundedUser?.pointsBalance === "number" ? refundedUser.pointsBalance : null;
    };
    if (pointsRequest) {
        try {
            pointsResult = await consumeUserPoints(currentUser.id, pointsRequest.model, pointsRequest.amount, pointsRequest.usageKind);
        } catch (error) {
            if (isQuotaExceededError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
    }
    request.signal.addEventListener("abort", () => void refundConsumedPoints(), { once: true });

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: request.method,
            headers,
            body,
            cache: "no-store",
            signal: request.signal,
        });
    } catch (error) {
        await refundConsumedPoints();
        console.error("System API proxy request failed", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: DEFAULT_CHANNEL_CONNECT_ERROR }, { status: 502, headers: responseHeaders(new Headers(), null, refundedPointsRemaining) });
    }

    if (!upstream.ok && pointsResult) {
        await refundConsumedPoints();
        pointsResult = null;
    }
    if (upstream.ok) pointsSettled = true;

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream.headers, pointsResult, refundedPointsRemaining, target),
    });
}

type SystemMediaChannel = { baseUrl: string; apiFormat: ApiCallFormat; apiKey: string };

async function proxySystemMediaRequest(request: Request, channel: SystemMediaChannel) {
    if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.json({ error: "Media proxy only supports GET and HEAD" }, { status: 405 });
    const target = mediaTargetRequest(channel.baseUrl, channel.apiFormat, new URL(request.url).searchParams.get("url") || "");
    if (!target) return NextResponse.json({ error: "Invalid media url" }, { status: 400 });

    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) headers.set("range", range);
    if (target.includeAuth) {
        if (channel.apiFormat === "gemini") headers.set("x-goog-api-key", channel.apiKey);
        else headers.set("authorization", `Bearer ${channel.apiKey}`);
    }

    let upstream: Response;
    try {
        upstream = await fetch(target.url, {
            method: request.method,
            headers,
            cache: "no-store",
            signal: request.signal,
        });
    } catch (error) {
        console.error("System media proxy request failed", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: DEFAULT_CHANNEL_CONNECT_ERROR }, { status: 502 });
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: mediaResponseHeaders(upstream.headers),
    });
}

function isMediaProxyPath(path: string[]) {
    return path[0] === "_media" || ((path[0] === "v1" || path[0] === "v1beta") && path[1] === "_media");
}

function mediaTargetRequest(baseUrl: string, apiFormat: ApiCallFormat, value: string): { url: string; includeAuth: boolean } | null {
    const mediaUrl = value.trim();
    if (!mediaUrl) return null;
    let apiBase: URL;
    try {
        apiBase = new URL(normalizeApiBaseUrl(baseUrl, apiFormat));
    } catch {
        return null;
    }
    try {
        if (mediaUrl.startsWith("/")) return { url: new URL(mediaUrl, apiBase.origin).toString(), includeAuth: true };
        const absolute = new URL(mediaUrl);
        if (!["http:", "https:"].includes(absolute.protocol)) return null;
        if (absolute.origin !== apiBase.origin && isBlockedProxyHost(absolute.hostname)) return null;
        return { url: absolute.toString(), includeAuth: absolute.origin === apiBase.origin };
    } catch {
        return { url: new URL(mediaUrl, directoryBaseUrl(apiBase)).toString(), includeAuth: true };
    }
}

function directoryBaseUrl(url: URL) {
    const next = new URL(url.toString());
    if (!next.pathname.endsWith("/")) next.pathname = next.pathname.replace(/\/[^/]*$/, "/");
    next.search = "";
    next.hash = "";
    return next.toString();
}

function mediaResponseHeaders(headers: Headers) {
    const nextHeaders = new Headers();
    ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"].forEach((key) => {
        const value = headers.get(key);
        if (value) nextHeaders.set(key, value);
    });
    return nextHeaders;
}

function isBlockedProxyHost(hostname: string) {
    const host = hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}

function classifyPointsRequest(method: string, apiFormat: ApiCallFormat, path: string[], contentType: string | null, body?: ArrayBuffer, multipliers?: GenerationPointMultipliers): PointsRequest | null {
    if (method.toUpperCase() !== "POST") return null;
    const cleanPath = path[0] === "v1" || path[0] === "v1beta" ? path.slice(1) : path;
    const routePath = `/${cleanPath.join("/")}`.toLowerCase();
    const payload = readRequestBody(contentType, body);
    const model = readRequestModel(payload) || readPathModel(cleanPath);
    if (!model) return null;

    if (routePath === "/images/generations" || routePath === "/images/edits") {
        return { model, amount: readRequestCount(payload) * imageQualityMultiplier(payload, multipliers), usageKind: "image" };
    }
    if (routePath === "/audio/speech") return { model, amount: 1, usageKind: "audio" };
    if (routePath === "/videos" || routePath === "/video/generations" || routePath === "/videos/generations" || routePath === "/contents/generations/tasks") return { model, amount: videoParameterMultiplier(payload, multipliers), usageKind: "video" };
    if (routePath === "/responses") {
        const isImage = hasResponsesImageGenerationTool(payload);
        return { model, amount: isImage ? imageQualityMultiplier(payload, multipliers) : 1, usageKind: isImage ? "image" : "text" };
    }
    if (routePath === "/chat/completions") return { model, amount: 1, usageKind: "text" };
    if (apiFormat === "gemini" && routePath.includes(":streamgeneratecontent")) return { model, amount: 1, usageKind: "text" };
    if (apiFormat === "gemini" && routePath.includes(":generatecontent")) return { model, amount: 1, usageKind: hasGeminiImageResponseModality(payload) ? "image" : "text" };

    return null;
}

function readRequestModel(payload: Record<string, unknown>) {
    return typeof payload.model === "string" ? payload.model.trim() : "";
}

function readPathModel(path: string[]) {
    const modelIndex = path.findIndex((item) => item === "models");
    if (modelIndex < 0) return "";
    return decodeURIComponent(path[modelIndex + 1] || "")
        .split(":")[0]
        .replace(/^models\//, "")
        .trim();
}

function readRequestCount(payload: Record<string, unknown>) {
    const count = Math.floor(Number(payload.n) || 1);
    return Math.max(1, Math.min(1000, count));
}

function imageQualityMultiplier(payload: Record<string, unknown>, multipliers?: GenerationPointMultipliers) {
    return multiplierValue(multipliers?.imageQuality, normalizeImageQualityKey(payload.quality));
}

function videoParameterMultiplier(payload: Record<string, unknown>, multipliers?: GenerationPointMultipliers) {
    return (
        multiplierValue(multipliers?.videoQuality, normalizeVideoQualityKey(payload.resolution_name || payload.resolution || payload.quality || payload.vquality)) *
        multiplierValue(multipliers?.videoSeconds, normalizeVideoSecondsKey(payload.duration || payload.seconds))
    );
}

function multiplierValue(values: Record<string, number> | undefined, key: string) {
    const value = values?.[key];
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 1;
}

function normalizeImageQualityKey(value: unknown) {
    const key = String(value || "auto")
        .trim()
        .toLowerCase();
    if (key === "hd") return "high";
    if (key === "standard") return "medium";
    return key || "auto";
}

function normalizeVideoQualityKey(value: unknown) {
    const key = String(value || "720")
        .trim()
        .toLowerCase();
    if (key === "low") return "480";
    if (key === "auto" || key === "medium" || key === "high") return "720";
    return key.replace(/p$/, "") || "720";
}

function normalizeVideoSecondsKey(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return "5";
    return String(Math.max(-1, Math.floor(seconds)));
}

function hasGeminiImageResponseModality(payload: Record<string, unknown>) {
    const generationConfig = payload.generationConfig && typeof payload.generationConfig === "object" && !Array.isArray(payload.generationConfig) ? (payload.generationConfig as Record<string, unknown>) : {};
    const modalityValues = [generationConfig.responseModalities, generationConfig.response_modalities, payload.responseModalities, payload.response_modalities];
    return modalityValues.some((value) => Array.isArray(value) && value.some((item) => String(item).toLowerCase() === "image"));
}

function hasResponsesImageGenerationTool(payload: Record<string, unknown>) {
    const tools = payload.tools;
    return Array.isArray(tools) && tools.some((tool) => Boolean(tool && typeof tool === "object" && String((tool as Record<string, unknown>).type || "").toLowerCase() === "image_generation"));
}

function readRequestBody(contentType: string | null, body?: ArrayBuffer): Record<string, unknown> {
    if (!body) return {};
    const text = new TextDecoder().decode(body);
    if (!contentType?.toLowerCase().includes("application/json")) return readMultipartFields(text);
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function readMultipartFields(text: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const key of ["model", "n", "quality", "resolution_name", "resolution", "vquality", "seconds", "duration"]) {
        const match = text.match(new RegExp(`name="${key}"\\r?\\n\\r?\\n([^\\r\\n]+)`));
        if (match?.[1]) fields[key] = match[1].trim();
    }
    return fields;
}

function targetUrl(baseUrl: string, apiFormat: "openai" | "gemini", path: string[], search: string) {
    const apiBase = normalizeApiBaseUrl(baseUrl, apiFormat);
    const cleanPath = path[0] === "v1" || path[0] === "v1beta" ? path.slice(1) : path;
    return `${apiBase}/${cleanPath.map((segment) => encodeTargetPathSegment(segment, apiFormat)).join("/")}${search}`;
}

function encodeTargetPathSegment(segment: string, apiFormat: "openai" | "gemini") {
    const decoded = safeDecodeURIComponent(segment);
    const encoded = encodeURIComponent(decoded);
    return apiFormat === "gemini" ? encoded.replace(/%3A/gi, ":") : encoded;
}

function safeDecodeURIComponent(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini") {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function responseHeaders(headers: Headers, pointsResult?: Awaited<ReturnType<typeof consumeUserPoints>> | null, refundedPointsRemaining?: number | null, upstreamUrl?: string) {
    const nextHeaders = new Headers();
    const passthrough = ["content-type", "cache-control", "content-disposition"];
    passthrough.forEach((key) => {
        const value = headers.get(key);
        if (value) nextHeaders.set(key, value);
    });
    if (upstreamUrl) nextHeaders.set("x-vozeb-upstream-url", upstreamUrl);
    if (pointsResult) {
        nextHeaders.set("x-vozeb-points-cost", String(pointsResult.cost));
        nextHeaders.set("x-vozeb-points-remaining", String(pointsResult.remaining));
    } else if (typeof refundedPointsRemaining === "number") {
        nextHeaders.set("x-vozeb-points-remaining", String(refundedPointsRemaining));
    }
    return nextHeaders;
}
