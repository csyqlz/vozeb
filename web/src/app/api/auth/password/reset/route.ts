import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { isAuthInputError, resetPasswordByEmail } from "@/lib/auth/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        const body = await readJsonBody<{ email?: unknown; code?: unknown; newPassword?: unknown }>(request);
        await resetPasswordByEmail({
            email: typeof body.email === "string" ? body.email : "",
            code: typeof body.code === "string" ? body.code : "",
            newPassword: typeof body.newPassword === "string" ? body.newPassword : "",
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Password reset failed", error);
        return NextResponse.json({ error: "重置密码失败" }, { status: 500 });
    }
}
