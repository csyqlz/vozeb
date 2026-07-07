import { NextResponse } from "next/server";

import { getAuthSettings } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBDAV_TEST_TIMEOUT_MS = 30_000;

export async function POST() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const settings = await getAuthSettings();
    const webdav = settings.webdav;
    if (!webdav.enabled) return NextResponse.json({ error: "请先开启 WebDAV" }, { status: 400 });
    if (!webdav.url.trim()) return NextResponse.json({ error: "请先填写 WebDAV 地址" }, { status: 400 });

    try {
        const target = buildWebdavUrl(webdav.url, webdav.directory);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WEBDAV_TEST_TIMEOUT_MS);
        const headers = new Headers({ Depth: "0" });
        if (webdav.username || webdav.password) headers.set("Authorization", `Basic ${Buffer.from(`${webdav.username}:${webdav.password}`, "utf8").toString("base64")}`);
        try {
            const response = await fetch(target, { method: "PROPFIND", headers, signal: controller.signal });
            if (response.ok || response.status === 207) return NextResponse.json({ ok: true });
            const text = await response.text().catch(() => "");
            return NextResponse.json({ error: `WebDAV 连接失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}` }, { status: 502 });
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "WebDAV 连接失败" }, { status: 502 });
    }
}

function buildWebdavUrl(baseUrl: string, directory: string) {
    const base = baseUrl.trim().replace(/\/+$/, "");
    const path = directory.trim().replace(/^\/+|\/+$/g, "");
    if (!path) return base;
    return `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
