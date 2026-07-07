import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, type WebdavSettings } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path?: string[] }>;
};

const WEBDAV_PROXY_TIMEOUT_MS = 120_000;
const forwardedResponseHeaders = ["content-type", "content-length", "etag", "last-modified"];

export async function GET(request: Request, context: RouteContext) {
    return proxyWebdavRequest(request, context, "GET");
}

export async function HEAD(request: Request, context: RouteContext) {
    return proxyWebdavRequest(request, context, "HEAD");
}

export async function PUT(request: Request, context: RouteContext) {
    return proxyWebdavRequest(request, context, "PUT");
}

export async function DELETE(request: Request, context: RouteContext) {
    return proxyWebdavRequest(request, context, "DELETE");
}

export async function POST(request: Request, context: RouteContext) {
    const method = request.headers.get("x-webdav-method")?.trim().toUpperCase();
    if (method !== "PROPFIND" && method !== "MKCOL") return NextResponse.json({ error: "不支持的 WebDAV 方法" }, { status: 405 });
    return proxyWebdavRequest(request, context, method);
}

async function proxyWebdavRequest(request: Request, context: RouteContext, method: string) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const settings = await getAuthSettings();
    const webdav = settings.webdav;
    if (!webdav.enabled) return NextResponse.json({ error: "管理员未开启 WebDAV 同步" }, { status: 400 });
    if (!webdav.url.trim()) return NextResponse.json({ error: "管理员未配置 WebDAV 地址" }, { status: 400 });

    const { path = [] } = await context.params;
    if (path.some((part) => part === ".." || part.includes("/") || part.includes("\\"))) return NextResponse.json({ error: "WebDAV 路径不合法" }, { status: 400 });

    await ensureUserWebdavRoot(webdav, currentUser.id);
    const target = buildUserWebdavUrl(webdav, currentUser.id, path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBDAV_PROXY_TIMEOUT_MS);
    try {
        const headers = buildForwardHeaders(request, webdav);
        const init: RequestInit & { duplex?: "half" } = { method, headers, signal: controller.signal };
        if (method !== "GET" && method !== "HEAD" && method !== "PROPFIND" && method !== "MKCOL") {
            init.body = request.body;
            init.duplex = "half";
        }

        const response = await fetch(target, init);
        return buildProxyResponse(response, method);
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return NextResponse.json({ error: "WebDAV 请求超时" }, { status: 504 });
        return NextResponse.json({ error: error instanceof Error ? error.message : "WebDAV 代理请求失败" }, { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

function buildForwardHeaders(request: Request, webdav: WebdavSettings) {
    const headers = new Headers();
    const depth = request.headers.get("depth");
    const contentType = request.headers.get("content-type");
    if (depth) headers.set("Depth", depth);
    if (contentType) headers.set("Content-Type", contentType);
    if (webdav.username || webdav.password) headers.set("Authorization", `Basic ${Buffer.from(`${webdav.username}:${webdav.password}`, "utf8").toString("base64")}`);
    return headers;
}

async function ensureUserWebdavRoot(webdav: WebdavSettings, userId: string) {
    const root = normalizePath(webdav.directory);
    const paths = [root, [root, "users"].filter(Boolean).join("/"), [root, "users", userId].filter(Boolean).join("/")].filter(Boolean);
    for (const path of paths) {
        const response = await fetch(buildWebdavUrl(webdav.url, path.split("/")), {
            method: "MKCOL",
            headers: buildServerAuthHeaders(webdav),
        });
        if (response.ok || response.status === 405 || response.status === 423) continue;
        if (response.status === 409) continue;
        throw new Error(`创建 WebDAV 用户目录失败：${response.status}`);
    }
}

function buildServerAuthHeaders(webdav: WebdavSettings) {
    const headers = new Headers();
    if (webdav.username || webdav.password) headers.set("Authorization", `Basic ${Buffer.from(`${webdav.username}:${webdav.password}`, "utf8").toString("base64")}`);
    return headers;
}

function buildProxyResponse(response: Response, method: string) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const key of forwardedResponseHeaders) {
        const value = response.headers.get(key);
        if (value) headers.set(key, value);
    }
    return new NextResponse(method === "HEAD" ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function buildUserWebdavUrl(webdav: WebdavSettings, userId: string, path: string[]) {
    const root = normalizePath(webdav.directory);
    return buildWebdavUrl(webdav.url, [root, "users", userId, ...path.map(normalizePath)].filter(Boolean));
}

function buildWebdavUrl(baseUrl: string, path: string[]) {
    const base = baseUrl.trim().replace(/\/+$/, "");
    const remotePath = path.filter(Boolean).join("/");
    if (!remotePath) return base;
    return `${base}/${remotePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizePath(path: string) {
    return path.trim().replace(/^\/+|\/+$/g, "");
}
