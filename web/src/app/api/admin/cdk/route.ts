import { NextRequest, NextResponse } from "next/server";

import { createCdkCodes, deleteCdkCodes, isAuthInputError, listCdkCodes, type CdkListFilter } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 20);
    const keyword = request.nextUrl.searchParams.get("keyword") || "";
    const filter = (request.nextUrl.searchParams.get("filter") || "all") as CdkListFilter;
    return NextResponse.json(await listCdkCodes({ page, pageSize, keyword, filter }));
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<{ count?: number; points?: number; maxRedemptions?: number; expiresAt?: string; expiresInDays?: number; note?: string }>(request);
        const codes = await createCdkCodes(body);
        return NextResponse.json({ codes });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Create CDK failed", error);
        return NextResponse.json({ error: "生成 CDK 失败" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<{ ids?: string[] }>(request);
        return NextResponse.json(await deleteCdkCodes(Array.isArray(body.ids) ? body.ids : []));
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Delete CDK failed", error);
        return NextResponse.json({ error: "删除 CDK 失败" }, { status: 500 });
    }
}
