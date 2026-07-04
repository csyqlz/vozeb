import { NextResponse } from "next/server";

import { deleteUserByAdmin, isAuthInputError, updateUserByAdmin, type UserRole, type UserStatus } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const { id } = await context.params;
        const body = await readJsonBody<{ displayName?: unknown; email?: unknown; password?: unknown; role?: unknown; status?: unknown; pointsBalance?: unknown }>(request);
        const patch: { displayName?: string; email?: string; password?: string; role?: UserRole; status?: UserStatus; pointsBalance?: number } = {};

        if (typeof body.displayName === "string") patch.displayName = body.displayName;
        if (typeof body.email === "string") patch.email = body.email;
        if (typeof body.password === "string" && body.password) patch.password = body.password;
        if (body.role === "admin" || body.role === "user") patch.role = body.role;
        if (body.status === "active" || body.status === "disabled") patch.status = body.status;
        if (body.pointsBalance !== undefined) patch.pointsBalance = Number(body.pointsBalance);

        const user = await updateUserByAdmin(currentUser.id, id, patch);
        return NextResponse.json({ user });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Admin user update failed", error);
        return NextResponse.json({ error: "更新用户失败" }, { status: 500 });
    }
}

export async function DELETE(_request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const { id } = await context.params;
        await deleteUserByAdmin(currentUser.id, id);
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Admin user delete failed", error);
        return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
    }
}
