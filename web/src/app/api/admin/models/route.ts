import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type ModelsPayload = {
    baseUrl?: unknown;
    apiKey?: unknown;
};

type ModelsResponse = {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
    msg?: string;
};

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const body = await readJsonBody<ModelsPayload>(request);
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!baseUrl || !apiKey) return NextResponse.json({ error: "请先填写 Base URL 和 API Key" }, { status: 400 });

    try {
        const response = await fetch(buildModelsUrl(baseUrl), {
            headers: { authorization: `Bearer ${apiKey}` },
            cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as ModelsResponse;
        if (!response.ok) return NextResponse.json({ error: payload.msg || payload.error?.message || `拉取模型失败：${response.status}` }, { status: 502 });
        const models = (payload.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
        return NextResponse.json({ models });
    } catch (error) {
        console.error("Admin model fetch failed", error);
        return NextResponse.json({ error: "拉取模型失败，请检查接口地址和网络" }, { status: 502 });
    }
}

function buildModelsUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    return `${normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`}/models`;
}
