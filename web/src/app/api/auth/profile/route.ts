import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth/session";
import { isAuthInputError, updateOwnProfile } from "@/lib/auth/store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    try {
        const body = await readJsonBody<{ displayName?: unknown; email?: unknown; emailCode?: unknown }>(request);
        const user = await updateOwnProfile(currentUser.id, {
            displayName: typeof body.displayName === "string" ? body.displayName : undefined,
            email: typeof body.email === "string" ? body.email : undefined,
            emailCode: typeof body.emailCode === "string" ? body.emailCode : undefined,
        });
        return NextResponse.json({ user: serializeCurrentUser(user) });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Profile update failed", error);
        return NextResponse.json({ error: "更新个人资料失败" }, { status: 500 });
    }
}
