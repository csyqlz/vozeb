"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Gift, Keyboard, LogOut, Settings2, ShieldCheck, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MenuProps } from "antd";
import { App, Dropdown } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

type CheckInPayload = {
    user?: ReturnType<typeof useUserStore.getState>["user"];
    reward?: {
        imageDaily: number;
        videoDaily: number;
        textDaily: number;
        audioDaily: number;
    };
    error?: string;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const [checkingIn, setCheckingIn] = useState(false);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const clearSession = useUserStore((state) => state.clearSession);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const showAdminMetaActions = user?.role === "admin";
    const naturalIconClass =
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 sm:size-7 sm:hover:bg-transparent dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:dark:hover:bg-transparent [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;
    const accountItems: MenuProps["items"] = [
        {
            key: "profile",
            icon: <UserCircle className="size-4" />,
            label: (
                <Link href="/profile" prefetch onMouseEnter={() => router.prefetch("/profile")} onFocus={() => router.prefetch("/profile")}>
                    个人资料
                </Link>
            ),
        },
        ...(user?.role === "admin"
            ? [
                  {
                      key: "admin",
                      icon: <ShieldCheck className="size-4" />,
                      label: (
                          <Link href="/admin" prefetch onMouseEnter={() => router.prefetch("/admin")} onFocus={() => router.prefetch("/admin")}>
                              管理员后台
                          </Link>
                      ),
                  },
              ]
            : []),
        {
            key: "logout",
            icon: <LogOut className="size-4" />,
            label: "退出登录",
            danger: true,
        },
    ];

    useEffect(() => {
        if (user?.role === "admin") router.prefetch("/admin");
        if (user) router.prefetch("/canvas");
    }, [router, user]);

    const handleMenuClick: MenuProps["onClick"] = async ({ key }) => {
        if (key !== "logout") return;
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            clearSession();
            router.replace("/login");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出登录失败");
        }
    };

    const handleCheckIn = async () => {
        if (!user || user.checkedInToday || checkingIn) return;
        setCheckingIn(true);
        try {
            const response = await fetch("/api/check-in", { method: "POST" });
            const payload = (await response.json()) as CheckInPayload;
            if (!response.ok || !payload.user) throw new Error(payload.error || "签到失败");
            setUser(payload.user);
            message.success(`签到成功，获得 ${formatQuotaReward(payload.reward)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "签到失败");
        } finally {
            setCheckingIn(false);
        }
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {user ? (
                <button
                    type="button"
                    className={cn(naturalIconClass, user.checkedInToday && "cursor-default opacity-50 hover:text-stone-600 dark:hover:text-stone-300")}
                    style={iconStyle}
                    disabled={user.checkedInToday || checkingIn}
                    onClick={handleCheckIn}
                    aria-label={user.checkedInToday ? "今日已签到" : "每日签到"}
                    title={user.checkedInToday ? "今日已签到" : "每日签到"}
                >
                    <Gift className="size-4" />
                </button>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {showAdminMetaActions ? (
                <>
                    <VersionReleaseModal style={versionStyle} />
                    <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
                </>
            ) : null}
            {user ? (
                <>
                    <Dropdown menu={{ items: accountItems, onClick: handleMenuClick }} trigger={["click"]} placement="bottomRight">
                        <button
                            type="button"
                            className="ml-1 inline-flex h-8 max-w-[36px] items-center gap-2 rounded-md border border-stone-200 px-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:text-stone-950 sm:max-w-40 dark:border-stone-800 dark:text-stone-200 dark:hover:border-stone-700 dark:hover:text-white"
                            style={iconStyle}
                            aria-label="账户菜单"
                            title="账户菜单"
                        >
                            <UserCircle className="size-4 shrink-0" />
                            <span className="hidden truncate sm:inline">{user.displayName || user.username}</span>
                        </button>
                    </Dropdown>
                </>
            ) : (
                <Link
                    href="/login"
                    className="ml-1 inline-flex h-8 items-center gap-2 rounded-md border border-stone-200 px-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:text-stone-950 dark:border-stone-800 dark:text-stone-200 dark:hover:border-stone-700 dark:hover:text-white"
                    style={iconStyle}
                >
                    <UserCircle className="size-4" />
                    <span className="hidden sm:inline">登录</span>
                </Link>
            )}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

function formatQuotaReward(reward: CheckInPayload["reward"]) {
    if (!reward) return "签到奖励";
    const parts = [reward.imageDaily ? `图片 +${reward.imageDaily}` : "", reward.videoDaily ? `视频 +${reward.videoDaily}` : "", reward.textDaily ? `文本 +${reward.textDaily}` : "", reward.audioDaily ? `音频 +${reward.audioDaily}` : ""].filter(Boolean);
    return parts.length ? parts.join("、") : "今日奖励";
}
