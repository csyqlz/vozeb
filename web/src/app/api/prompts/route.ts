import type { NextRequest } from "next/server";

import { listPrompts } from "@/lib/prompts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const result = await listPrompts({
        scope: "library",
        keyword: params.get("keyword") || "",
        tags: params.getAll("tag").filter(Boolean),
        category: params.get("category") || "",
        random: params.get("random") === "1",
        page: Math.max(1, Number(params.get("page")) || 1),
        pageSize: Math.max(1, Math.min(100, Number(params.get("pageSize")) || 20)),
    });
    return Response.json(result, {
        headers: {
            "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        },
    });
}
