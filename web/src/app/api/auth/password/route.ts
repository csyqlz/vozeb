import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth/session";
import { isAuthInputError, updateOwnPassword } from "@/lib/auth/store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    try {
        const body = await readJsonBody<{ currentPassword?: unknown; newPassword?: unknown }>(request);
        await updateOwnPassword(currentUser.id, {
            currentPassword: typeof body.currentPassword === "string" ? body.currentPassword : "",
            newPassword: typeof body.newPassword === "string" ? body.newPassword : "",
        });
        const response = NextResponse.json({ ok: true });
        clearSessionCookie(response);
        return response;
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Password update failed", error);
        return NextResponse.json({ error: "修改密码失败" }, { status: 500 });
    }
}
