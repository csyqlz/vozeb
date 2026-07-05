import { NextResponse } from "next/server";

import { clearCurrentSession, clearSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
    await clearCurrentSession();
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response, request);
    return response;
}
