"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Keyboard, LogOut, Settings2, ShieldCheck, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MenuProps } from "antd";
import { App, Dropdown, Popover, Spin, Tag } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { CreditSymbol } from "@/constant/credits";
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
    rewardPoints?: number;
    error?: string;
};

type PointRecord = {
    id: string;
    type: "check-in" | "consume" | "admin-adjust";
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const [checkingIn, setCheckingIn] = useState(false);
    const [pointsOpen, setPointsOpen] = useState(false);
    const [pointsLoading, setPointsLoading] = useState(false);
    const [pointRecords, setPointRecords] = useState<PointRecord[]>([]);
    const [accountOpen, setAccountOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const clearSession = useUserStore((state) => state.clearSession);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const showAdminMetaActions = user?.role === "admin";
    const defaultControlClass =
        "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white/85 text-sm font-medium text-stone-700 shadow-sm shadow-stone-950/5 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950/35 dark:text-stone-200 dark:shadow-black/15 dark:hover:border-stone-700 dark:hover:bg-stone-900 dark:hover:text-white";
    const canvasControlClass =
        "inline-flex h-9 shrink-0 items-center justify-center rounded-xl border px-2.5 text-sm font-medium shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35 [&_svg]:size-4";
    const canvasIconClass = cn(canvasControlClass, "w-9 px-0");
    const canvasControlStyle: CSSProperties | undefined =
        variant === "canvas"
            ? {
                  background: canvasTheme.toolbar.panel,
                  borderColor: canvasTheme.toolbar.border,
                  boxShadow: theme === "dark" ? "0 10px 30px rgba(0,0,0,.28)" : "0 10px 24px rgba(28,25,23,.08)",
                  color: canvasTheme.toolbar.item,
              }
            : undefined;
    const naturalIconClass = variant === "canvas" ? canvasIconClass : cn(defaultControlClass, "w-8 px-0 [&_svg]:size-4");
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? canvasControlStyle : undefined;
    const versionStyle = iconStyle;
    const versionClassName = variant === "canvas" ? cn(canvasControlClass, "px-2.5 text-xs font-semibold") : cn(defaultControlClass, "hidden px-2.5 text-xs font-semibold lg:inline-flex");
    const gitHubClassName = variant === "canvas" ? cn(canvasIconClass, "text-base") : cn(defaultControlClass, "hidden w-8 px-0 text-base lg:inline-flex");
    const gitHubStyle = iconStyle;
    const showCheckIn = variant !== "canvas";
    const checkInLabel = checkingIn ? "签到中" : user?.checkedInToday ? "已签到" : "签到";
    const compactCheckInLabel = checkInLabel;
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
        if (user) {
            router.prefetch("/canvas");
            router.prefetch("/profile");
        }
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

    const handleAccountMenuClick: MenuProps["onClick"] = (info) => {
        setAccountOpen(false);
        void handleMenuClick(info);
    };

    useEffect(() => {
        if (variant !== "canvas" || (!pointsOpen && !accountOpen)) return;
        const closeCanvasPopups = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (rootRef.current?.contains(target)) return;
            if (
                target instanceof Element &&
                target.closest(".user-points-popover, .ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu, .ant-dropdown-menu-submenu-popup")
            ) {
                return;
            }
            setPointsOpen(false);
            setAccountOpen(false);
        };
        document.addEventListener("pointerdown", closeCanvasPopups, true);
        return () => document.removeEventListener("pointerdown", closeCanvasPopups, true);
    }, [variant, pointsOpen, accountOpen]);

    const handleCheckIn = async () => {
        if (!user || user.checkedInToday || checkingIn) return;
        setCheckingIn(true);
        try {
            const response = await fetch("/api/check-in", { method: "POST" });
            const payload = (await response.json()) as CheckInPayload;
            if (!response.ok || !payload.user) throw new Error(payload.error || "签到失败");
            setUser(payload.user);
            message.success(`签到成功，获得 ${formatQuotaReward(payload.rewardPoints)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "签到失败");
        } finally {
            setCheckingIn(false);
        }
    };

    const loadPointRecords = async () => {
        if (!user || pointsLoading) return;
        setPointsLoading(true);
        try {
            const response = await fetch("/api/points?limit=30", { cache: "no-store" });
            const payload = (await response.json()) as { records?: PointRecord[]; error?: string };
            if (!response.ok) throw new Error(payload.error || "积分记录加载失败");
            setPointRecords(payload.records || []);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分记录加载失败");
        } finally {
            setPointsLoading(false);
        }
    };

    const handlePointsOpenChange = (open: boolean) => {
        setPointsOpen(open);
        if (!open) return;
        setAccountOpen(false);
        void loadPointRecords();
    };

    const handleAccountOpenChange = (open: boolean) => {
        setAccountOpen(open);
        if (open) setPointsOpen(false);
    };

    return (
        <div ref={rootRef} className={cn("user-status-actions inline-flex shrink-0 items-center gap-1.5 sm:gap-2", variant === "canvas" ? "canvas-user-status-actions" : "app-user-status-actions")}>
            {user ? (
                <Popover
                    rootClassName="user-points-popover"
                    open={pointsOpen}
                    onOpenChange={handlePointsOpenChange}
                    trigger="click"
                    placement="bottomRight"
                    content={<PointRecordPanel loading={pointsLoading} records={pointRecords} />}
                >
                    <button
                        type="button"
                        className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "gap-1 px-2 text-xs font-semibold sm:gap-1.5 sm:px-2.5", variant === "canvas" ? "canvas-points-action" : "app-points-action")}
                        style={iconStyle}
                        title="积分余额"
                    >
                        <CreditSymbol className="text-sm" />
                        {user.pointsBalance.toLocaleString()}
                    </button>
                </Popover>
            ) : null}
            {user && showCheckIn ? (
                <button
                    type="button"
                    className={cn(
                        defaultControlClass,
                        "app-checkin-action px-2.5 text-sm font-semibold text-sky-700 disabled:cursor-default disabled:opacity-100 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800 dark:text-sky-200 dark:hover:border-sky-400/25 dark:hover:bg-sky-400/10 dark:hover:text-sky-100 sm:px-3",
                        user.checkedInToday && "text-stone-600 hover:border-stone-200 hover:bg-white/85 hover:text-stone-600 dark:text-stone-300 dark:hover:border-stone-800 dark:hover:bg-stone-950/35 dark:hover:text-stone-300",
                    )}
                    disabled={user.checkedInToday || checkingIn}
                    onClick={handleCheckIn}
                    aria-label={user.checkedInToday ? "今日已签到" : "每日签到"}
                    title={user.checkedInToday ? "今日已签到" : "每日签到"}
                >
                    <span className="sm:hidden">{compactCheckInLabel}</span>
                    <span className="hidden sm:inline">{checkInLabel}</span>
                </button>
            ) : null}
            {showConfig ? (
                <button type="button" className={cn(naturalIconClass, variant === "canvas" && "canvas-config-action")} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={cn(naturalIconClass, variant === "canvas" && "canvas-theme-action")}
                style={iconStyle}
                aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            />
            {showAdminMetaActions ? (
                <span className={cn("canvas-admin-meta-actions inline-flex items-center", variant === "canvas" ? "gap-1" : "gap-2")}>
                    <VersionReleaseModal className={versionClassName} style={versionStyle} />
                    <GitHubLink className={gitHubClassName} style={gitHubStyle} />
                </span>
            ) : null}
            {user ? (
                <>
                    <Dropdown
                        {...(variant === "canvas" ? { open: accountOpen, onOpenChange: handleAccountOpenChange } : {})}
                        menu={{ items: accountItems, onClick: handleAccountMenuClick }}
                        trigger={["click"]}
                        placement="bottomRight"
                    >
                        <button
                            type="button"
                            className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "max-w-[36px] gap-2 px-2.5 sm:max-w-40", variant === "canvas" ? "canvas-account-action" : "app-account-action")}
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
                <Link href="/login" className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "gap-2 px-2.5", variant === "canvas" && "canvas-account-action")} style={iconStyle}>
                    <UserCircle className="size-4" />
                    <span className="hidden sm:inline">登录</span>
                </Link>
            )}
            {onOpenShortcuts ? (
                <button type="button" className={cn(naturalIconClass, variant === "canvas" && "canvas-shortcuts-action")} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

function formatQuotaReward(rewardPoints?: number) {
    return `${Math.max(0, Math.floor(Number(rewardPoints) || 0)).toLocaleString()} 积分`;
}

function PointRecordPanel({ loading, records }: { loading: boolean; records: PointRecord[] }) {
    return (
        <div className="user-points-panel w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
            <div className="mb-3 text-sm font-semibold text-stone-950 dark:text-stone-100">积分记录</div>
            {loading ? (
                <div className="flex h-24 items-center justify-center">
                    <Spin size="small" />
                </div>
            ) : records.length ? (
                <div className="max-h-[min(20rem,60dvh)] space-y-2 overflow-y-auto pr-1">
                    {records.map((record) => {
                        const positive = record.amount > 0;
                        return (
                            <div key={record.id} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="min-w-0 truncate text-sm font-medium text-stone-800 dark:text-stone-100">{record.description}</span>
                                    <Tag color={positive ? "green" : "red"} className="m-0 shrink-0">
                                        {positive ? "+" : ""}
                                        {record.amount}
                                    </Tag>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-stone-500">
                                    <span>{new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                    <span>余额 {record.balanceAfter.toLocaleString()}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="rounded-md border border-dashed border-stone-200 px-3 py-8 text-center text-sm text-stone-500 dark:border-stone-800">暂无积分记录</div>
            )}
        </div>
    );
}
