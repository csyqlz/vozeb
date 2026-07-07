import { NextResponse } from "next/server";

import { deleteCdkCode, isAuthInputError, updateCdkCode, type PublicCdkCode } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

async function assertAdmin() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
    return null;
}

export async function PATCH(request: Request, context: RouteContext) {
    const guard = await assertAdmin();
    if (guard) return guard;

    try {
        const { id } = await context.params;
        const body = await readJsonBody<Partial<PublicCdkCode>>(request);
        const code = await updateCdkCode(id, body);
        return NextResponse.json({ code });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Update CDK failed", error);
        return NextResponse.json({ error: "更新 CDK 失败" }, { status: 500 });
    }
}

export async function DELETE(_request: Request, context: RouteContext) {
    const guard = await assertAdmin();
    if (guard) return guard;

    try {
        const { id } = await context.params;
        return NextResponse.json(await deleteCdkCode(id));
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Delete CDK failed", error);
        return NextResponse.json({ error: "删除 CDK 失败" }, { status: 500 });
    }
}
