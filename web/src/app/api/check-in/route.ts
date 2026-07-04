import { NextResponse } from "next/server";

import { checkInUser, isAuthInputError } from "@/lib/auth/store";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    try {
        const result = await checkInUser(currentUser.id);
        return NextResponse.json({
            user: serializeCurrentUser(result.user),
            rewardPoints: result.rewardPoints,
            date: result.date,
        });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Check-in failed", error);
        return NextResponse.json({ error: "签到失败" }, { status: 500 });
    }
}
