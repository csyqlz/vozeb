import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { cleanupUnreferencedGenerationAssets, getGenerationAssetStats } from "@/lib/server/generation-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    return NextResponse.json({ stats: await getGenerationAssetStats() });
}

export async function DELETE() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    return NextResponse.json(await cleanupUnreferencedGenerationAssets());
}
