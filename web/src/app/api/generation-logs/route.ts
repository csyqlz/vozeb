import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { recordGenerationLog, type GenerationLogInput } from "@/lib/server/generation-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonBody<Omit<GenerationLogInput, "userId" | "username" | "displayName">>(request);
    const log = await recordGenerationLog({
        ...body,
        userId: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
    });
    return NextResponse.json({ log });
}
