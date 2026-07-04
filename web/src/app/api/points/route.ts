import { NextResponse } from "next/server";

import { listPointRecords } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const limit = Number(new URL(request.url).searchParams.get("limit") || 50);
    const records = await listPointRecords(currentUser.id, limit);
    return NextResponse.json({ records });
}
