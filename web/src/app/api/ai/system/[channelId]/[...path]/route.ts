import { NextResponse } from "next/server";

import { consumeUserPoints, getAuthSettings, isQuotaExceededError, type ApiCallFormat } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ channelId: string; path: string[] }>;
};

export async function GET(request: Request, context: RouteContext) {
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

    const target = targetUrl(channel.baseUrl, channel.apiFormat, path, new URL(request.url).search);
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");
    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    if (channel.apiFormat === "gemini") headers.set("x-goog-api-key", channel.apiKey);
    else headers.set("authorization", `Bearer ${channel.apiKey}`);

    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const pointsRequest = classifyPointsRequest(request.method, channel.apiFormat, path, contentType, body);
    let pointsResult: Awaited<ReturnType<typeof consumeUserPoints>> | null = null;
    if (pointsRequest) {
        try {
            pointsResult = await consumeUserPoints(currentUser.id, pointsRequest.model, pointsRequest.amount);
        } catch (error) {
            if (isQuotaExceededError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
    }

    const upstream = await fetch(target, {
        method: request.method,
        headers,
        body,
        cache: "no-store",
    });

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream.headers, pointsResult),
    });
}

function classifyPointsRequest(method: string, apiFormat: ApiCallFormat, path: string[], contentType: string | null, body?: ArrayBuffer): { model: string; amount: number } | null {
    if (method.toUpperCase() !== "POST") return null;
    const cleanPath = path[0] === "v1" || path[0] === "v1beta" ? path.slice(1) : path;
    const routePath = `/${cleanPath.join("/")}`.toLowerCase();
    const model = readRequestModel(contentType, body) || readPathModel(cleanPath);
    if (!model) return null;

    if (routePath === "/images/generations" || routePath === "/images/edits") {
        return { model, amount: readRequestCount(contentType, body) };
    }
    if (routePath === "/audio/speech") return { model, amount: 1 };
    if (routePath === "/videos" || routePath === "/contents/generations/tasks") return { model, amount: 1 };
    if (routePath === "/responses" || routePath === "/chat/completions") return { model, amount: 1 };
    if (apiFormat === "gemini" && routePath.includes(":streamgeneratecontent")) return { model, amount: 1 };
    if (apiFormat === "gemini" && routePath.includes(":generatecontent")) return { model, amount: 1 };

    return null;
}

function readRequestModel(contentType: string | null, body?: ArrayBuffer) {
    const payload = readRequestBody(contentType, body);
    return typeof payload.model === "string" ? payload.model.trim() : "";
}

function readPathModel(path: string[]) {
    const modelIndex = path.findIndex((item) => item === "models");
    if (modelIndex < 0) return "";
    return decodeURIComponent(path[modelIndex + 1] || "").split(":")[0].replace(/^models\//, "").trim();
}

function readRequestCount(contentType: string | null, body?: ArrayBuffer) {
    const payload = readRequestBody(contentType, body);
    const count = Math.floor(Number(payload.n) || 1);
    return Math.max(1, Math.min(1000, count));
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
    for (const key of ["model", "n"]) {
        const match = text.match(new RegExp(`name="${key}"\\r?\\n\\r?\\n([^\\r\\n]+)`));
        if (match?.[1]) fields[key] = match[1].trim();
    }
    return fields;
}

function targetUrl(baseUrl: string, apiFormat: "openai" | "gemini", path: string[], search: string) {
    const apiBase = normalizeApiBaseUrl(baseUrl, apiFormat);
    const cleanPath = path[0] === "v1" || path[0] === "v1beta" ? path.slice(1) : path;
    return `${apiBase}/${cleanPath.map(encodeURIComponent).join("/")}${search}`;
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini") {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function responseHeaders(headers: Headers, pointsResult?: Awaited<ReturnType<typeof consumeUserPoints>> | null) {
    const nextHeaders = new Headers();
    const passthrough = ["content-type", "cache-control", "content-disposition"];
    passthrough.forEach((key) => {
        const value = headers.get(key);
        if (value) nextHeaders.set(key, value);
    });
    if (pointsResult) {
        nextHeaders.set("x-vozeb-points-cost", String(pointsResult.cost));
        nextHeaders.set("x-vozeb-points-remaining", String(pointsResult.remaining));
    }
    return nextHeaders;
}
