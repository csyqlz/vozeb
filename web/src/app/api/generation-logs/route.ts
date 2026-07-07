import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { deleteGenerationLogs, listGenerationLogs, listUserGenerationLogsForDelete, recordGenerationLog, type GenerationLogAsset, type GenerationLogInput } from "@/lib/server/generation-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 100);
    const kind = url.searchParams.get("kind") || undefined;
    const source = url.searchParams.get("source") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const keyword = url.searchParams.get("keyword") || undefined;
    const [result, settings] = await Promise.all([listGenerationLogs({ page, pageSize, kind, source, status, keyword, userId: currentUser.id }), getAuthSettings()]);

    return NextResponse.json({
        ...result,
        items: result.items.map((log) => ({
            ...log,
            assets: log.assets.map((asset) => exposeAssetForUser(asset, settings.generationAssetStorage)),
        })),
    });
}

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
    const settings = await getAuthSettings();
    return NextResponse.json({
        log: {
            ...log,
            assets: log.assets.map((asset) => exposeAssetForUser(asset, settings.generationAssetStorage)),
        },
    });
}

export async function DELETE(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonBody<{ ids?: string[] }>(request);
    const requestedIds = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map((id) => id.trim()).filter(Boolean))) : [];
    if (!requestedIds.length) return NextResponse.json({ deleted: 0 });

    const deletableIds = (await listUserGenerationLogsForDelete(currentUser.id, requestedIds)).map((log) => log.id);
    if (!deletableIds.length) return NextResponse.json({ deleted: 0 });

    return NextResponse.json(await deleteGenerationLogs(deletableIds));
}

function exposeAssetForUser(asset: GenerationLogAsset, settings: Awaited<ReturnType<typeof getAuthSettings>>["generationAssetStorage"]) {
    const serverEnabled = asset.type === "video" ? settings.videoServerFallback : settings.imageServerFallback;
    const remoteUrl = asset.remoteUrl || (asset.url && !isServerAssetUrl(asset.url) ? asset.url : "");
    const serverUrl = serverEnabled ? asset.serverUrl || (isServerAssetUrl(asset.url) ? asset.url : "") : undefined;
    return {
        ...asset,
        url: remoteUrl || serverUrl || "",
        remoteUrl: remoteUrl || undefined,
        serverUrl: serverUrl || undefined,
    };
}

function isServerAssetUrl(url?: string) {
    return Boolean(url?.startsWith("/api/generation-log-assets/"));
}
