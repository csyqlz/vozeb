"use client";

import { useUserStore, type LocalUser } from "@/stores/use-user-store";

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
