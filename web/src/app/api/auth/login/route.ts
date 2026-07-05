import { NextResponse } from "next/server";

import { authenticateUser, createSession, isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { serializeCurrentUser, setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        const body = await readJsonBody<{ username?: string; password?: string }>(request);
        const user = await authenticateUser({ username: body.username || "", password: body.password || "" });
        const sessionValue = await createSession(user.id);
        const response = NextResponse.json({ user: serializeCurrentUser(user) });
        setSessionCookie(response, sessionValue, request);
        return response;
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Login failed", error);
        return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
    }
}
