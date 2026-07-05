import { NextResponse } from "next/server";

import { createSession, createUser, isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { serializeCurrentUser, setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        const body = await readJsonBody<{ username?: string; email?: string; emailCode?: string; displayName?: string; password?: string }>(request);
        const user = await createUser({
            username: body.username || "",
            email: body.email,
            emailCode: body.emailCode,
            displayName: body.displayName,
            password: body.password || "",
        });
        const sessionValue = await createSession(user.id);
        const response = NextResponse.json({ user: serializeCurrentUser(user) });
        setSessionCookie(response, sessionValue, request);
        return response;
    } catch (error) {
        return authErrorResponse(error);
    }
}

function authErrorResponse(error: unknown) {
    if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Register failed", error);
    return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 });
}
