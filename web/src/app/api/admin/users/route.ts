import { NextResponse } from "next/server";

import { createUserByAdmin, isAuthInputError, listPublicUsers, type UserRole, type UserStatus } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const users = await listPublicUsers();
    return NextResponse.json({ users, currentUser: serializeCurrentUser(currentUser) });
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "璇峰厛鐧诲綍" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "闇€瑕佺鐞嗗憳鏉冮檺" }, { status: 403 });

    try {
        const body = await readJsonBody<{ username?: unknown; displayName?: unknown; email?: unknown; password?: unknown; role?: unknown; status?: unknown; pointsBalance?: unknown }>(request);
        const role = body.role === "admin" ? "admin" : "user";
        const status = body.status === "disabled" ? "disabled" : "active";
        const user = await createUserByAdmin({
            username: typeof body.username === "string" ? body.username : "",
            displayName: typeof body.displayName === "string" ? body.displayName : "",
            email: typeof body.email === "string" ? body.email : "",
            password: typeof body.password === "string" ? body.password : "",
            role: role as UserRole,
            status: status as UserStatus,
            pointsBalance: Number(body.pointsBalance),
        });
        return NextResponse.json({ user: serializeCurrentUser(user) });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Admin user create failed", error);
        return NextResponse.json({ error: "Create user failed" }, { status: 500 });
    }
}
