import { NextResponse } from "next/server";

import { getAuthSettings, isAuthInputError, setAuthSettings, type AuthSettings } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    return NextResponse.json({ settings: await getAuthSettings() });
}

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<Partial<AuthSettings>>(request);
        const patch: Partial<AuthSettings> = {};
        if (body.site) patch.site = body.site;
        if (typeof body.registrationEnabled === "boolean") patch.registrationEnabled = body.registrationEnabled;
        if (typeof body.emailRegistrationEnabled === "boolean") patch.emailRegistrationEnabled = body.emailRegistrationEnabled;
        if (body.mail) patch.mail = body.mail;
        if (typeof body.allowUserApiConfig === "boolean") patch.allowUserApiConfig = body.allowUserApiConfig;
        if (body.defaultQuota) patch.defaultQuota = body.defaultQuota;
        if (body.checkInReward) patch.checkInReward = body.checkInReward;
        if (Array.isArray(body.systemChannels)) patch.systemChannels = body.systemChannels;
        if (body.defaultModels) patch.defaultModels = body.defaultModels;
        if (!Object.keys(patch).length) return NextResponse.json({ error: "没有可更新的设置" }, { status: 400 });

        const settings = await setAuthSettings(patch);
        return NextResponse.json({ settings });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Admin settings update failed", error);
        return NextResponse.json({ error: "更新设置失败" }, { status: 500 });
    }
}
