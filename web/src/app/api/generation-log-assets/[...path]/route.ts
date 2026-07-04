import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getServerDataDir } from "@/lib/server/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

export async function GET(_request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const { path } = await context.params;
    const root = resolve(getServerDataDir(), "generation-assets");
    const filePath = resolve(root, ...(path || []));
    if (!isInsideRoot(filePath, root)) return NextResponse.json({ error: "资源不存在" }, { status: 404 });

    try {
        const bytes = await readFile(filePath);
        return new NextResponse(bytes, {
            headers: {
                "Content-Type": contentType(filePath),
                "Cache-Control": "private, max-age=3600",
            },
        });
    } catch {
        return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    }
}

function isInsideRoot(filePath: string, root: string) {
    return filePath === root || filePath.startsWith(`${root}${sep}`);
}

function contentType(filePath: string) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    return lower.includes("\\videos\\") || lower.includes("/videos/") ? "video/mp4" : "image/png";
}
