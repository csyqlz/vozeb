import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { deleteGenerationLogs, listGenerationLogs } from "@/lib/server/generation-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const params = request.nextUrl.searchParams;
    const result = await listGenerationLogs({
        page: Number(params.get("page")) || 1,
        pageSize: Number(params.get("pageSize")) || 20,
        keyword: params.get("keyword") || "",
        kind: params.get("kind") || "",
        source: params.get("source") || "",
        status: params.get("status") || "",
        userId: params.get("userId") || "",
        start: params.get("start") || "",
        end: params.get("end") || "",
    });

    return NextResponse.json({ logs: result.items, total: result.total, page: result.page, pageSize: result.pageSize });
}

export async function DELETE(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const body = await readJsonBody<{ ids?: unknown }>(request);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const result = await deleteGenerationLogs(ids);
    return NextResponse.json(result);
}
