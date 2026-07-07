import { NextResponse } from "next/server";

import { isAuthInputError, redeemCdkCode } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    try {
        const body = await readJsonBody<{ code?: string }>(request);
        const result = await redeemCdkCode(currentUser.id, body.code || "");
        return NextResponse.json({ ...result, user: serializeCurrentUser(result.user) });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Redeem CDK failed", error);
        return NextResponse.json({ error: "兑换失败" }, { status: 500 });
    }
}
