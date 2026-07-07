import { NextResponse } from "next/server";

import { createAnnouncement, isAuthInputError, listAnnouncements, type PublicAnnouncement } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    return NextResponse.json({ announcements: await listAnnouncements(true) });
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<Partial<PublicAnnouncement>>(request);
        const announcement = await createAnnouncement(body);
        return NextResponse.json({ announcement });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Create announcement failed", error);
        return NextResponse.json({ error: "创建公告失败" }, { status: 500 });
    }
}
