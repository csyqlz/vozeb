import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { deleteSession, getUserBySession, sessionMaxAgeSeconds, type AuthSettings, type PublicUser } from "./store";

export const SESSION_COOKIE_NAME = "vozeb_session";
export const LEGACY_SESSION_COOKIE_NAME = `${"in"}finite_canvas_session`;

export type CurrentUser = PublicUser;

export async function getSessionCookieValue() {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value || cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value;
}

export async function getCurrentUser() {
    return getUserBySession(await getSessionCookieValue());
}

export async function clearCurrentSession() {
    await deleteSession(await getSessionCookieValue());
}

export function setSessionCookie(response: NextResponse, value: string) {
    response.cookies.set(SESSION_COOKIE_NAME, value, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: sessionMaxAgeSeconds(),
        path: "/",
    });
}

export function clearSessionCookie(response: NextResponse) {
    response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 0,
        path: "/",
    });
    response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 0,
        path: "/",
    });
}

export function serializeCurrentUser(user: CurrentUser) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        pointsBalance: user.pointsBalance,
        checkedInToday: user.checkedInToday,
        lastCheckInDate: user.lastCheckInDate,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
    };
}

export function serializePublicSettings(settings: AuthSettings) {
    return {
        site: settings.site,
        registrationEnabled: settings.registrationEnabled,
        emailRegistrationEnabled: settings.emailRegistrationEnabled,
        allowUserApiConfig: settings.allowUserApiConfig,
        defaultPoints: settings.defaultPoints,
        checkInRewardPoints: settings.checkInRewardPoints,
        modelPointCosts: settings.modelPointCosts,
        defaultModels: settings.defaultModels,
        systemChannels: settings.systemChannels
            .filter((channel) => channel.enabled)
            .map((channel) => ({
                id: channel.id,
                name: channel.name,
                baseUrl: `/api/ai/system/${channel.id}`,
                apiKey: "system",
                apiFormat: channel.apiFormat,
                models: channel.models,
                enabled: channel.enabled,
                hasApiKey: Boolean(channel.apiKey),
            })),
    };
}
