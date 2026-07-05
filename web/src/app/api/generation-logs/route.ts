import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { recordGenerationLog, type GenerationLogInput } from "@/lib/server/generation-log-store";
import type { GenerationLogAsset } from "@/lib/server/generation-log-store";

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
    const settings = await getAuthSettings();
    return NextResponse.json({
        log: {
            ...log,
            assets: log.assets.map((asset) => exposeAssetForUser(asset, settings.generationAssetStorage)),
        },
    });
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
