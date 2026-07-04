"use client";

import { useUserStore, type LocalUser } from "@/stores/use-user-store";

type HeaderLike = Headers | Record<string, unknown> | { get: (key: string) => unknown } | undefined;

export function syncUserPointsFromHeaders(headers: HeaderLike, apiSource?: "system" | "custom") {
    if (apiSource !== "system") return;
    const value = readHeader(headers, "x-vozeb-points-remaining");
    if (value === undefined || value === null || value === "") return;
    const pointsBalance = Number(value);
    if (!Number.isFinite(pointsBalance)) return;
    const currentUser = useUserStore.getState().user;
    if (currentUser) useUserStore.getState().setUser({ ...currentUser, pointsBalance });
}

export async function refreshUserPointsIfSystem(apiSource?: "system" | "custom") {
    if (apiSource !== "system") return;
    try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = (await response.json()) as { user?: LocalUser | null };
        if (payload.user) useUserStore.getState().setUser(payload.user);
    } catch {
        // Balance refresh is best-effort; the generation result should not fail because of it.
    }
}

function readHeader(headers: HeaderLike, key: string) {
    if (!headers) return undefined;
    if (headers instanceof Headers) return headers.get(key) || undefined;
    if ("get" in headers && typeof headers.get === "function") return headers.get(key) || headers.get(key.toLowerCase()) || undefined;
    const record = headers as Record<string, unknown>;
    return record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()];
}
