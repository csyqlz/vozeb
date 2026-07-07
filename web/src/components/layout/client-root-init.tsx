"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";

import { SiteAnnouncementPopup } from "@/components/layout/site-announcement-popup";
import { appStorageKey } from "@/lib/storage-keys";
import { applyPublicSystemSettings, useConfigStore, type PublicSystemSettings } from "@/stores/use-config-store";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";

const AUTO_WEBDAV_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const setConfig = useConfigStore((state) => state.setConfig);
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        let cancelled = false;
        let cancelAutoSync: (() => void) | undefined;
        void fetch("/api/auth/session", { cache: "no-store" })
            .then((response) => response.json() as Promise<{ user?: LocalUser | null; settings?: PublicSystemSettings }>)
            .then((payload) => {
                if (cancelled) return;
                setUser(payload.user || null);
                setConfig(applyPublicSystemSettings(useConfigStore.getState().config, payload.settings));
                if (payload.user && payload.settings?.webdav?.enabled) cancelAutoSync = scheduleSystemWebdavAutoSync(payload.user.id);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            cancelAutoSync?.();
        };
    }, [setConfig, setUser]);

    useEffect(() => {
        const handleMissingConfig = () => {
            message.warning("请联系管理员在后台配置可用模型渠道");
        };
        window.addEventListener("vozeb-system-config-missing", handleMissingConfig);
        return () => window.removeEventListener("vozeb-system-config-missing", handleMissingConfig);
    }, [message]);

    return (
        <>
            {children}
            <SiteAnnouncementPopup />
        </>
    );
}

function scheduleSystemWebdavAutoSync(userId: string) {
    const storageKey = `${appStorageKey("webdav_auto_sync_at")}:${userId}`;
    try {
        const lastSyncedAt = Number(window.localStorage.getItem(storageKey) || "0");
        if (Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < AUTO_WEBDAV_SYNC_INTERVAL_MS) return;
        window.localStorage.setItem(storageKey, String(Date.now()));
    } catch {
        return;
    }

    return runOnIdle(() => {
        void import("@/services/app-sync")
            .then(({ syncAppDataToWebdav }) =>
                syncAppDataToWebdav({
                    proxyMode: "nextjs",
                    url: "/api/webdav",
                    username: "",
                    password: "",
                    directory: "",
                    lastSyncedAt: "",
                }),
            )
            .catch(() => undefined);
    });
}

function runOnIdle(task: () => void) {
    const idleWindow = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback?.(task, { timeout: 3000 });
    if (idleId !== undefined) return () => idleWindow.cancelIdleCallback?.(idleId);
    const timer = window.setTimeout(task, 1500);
    return () => window.clearTimeout(timer);
}
