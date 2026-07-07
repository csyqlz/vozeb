import { NextResponse } from "next/server";

import { listAnnouncements } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json({ announcements: await listAnnouncements(false) });
}
