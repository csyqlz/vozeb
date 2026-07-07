"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Gift, Keyboard, LogOut, ShieldCheck, UserCircle, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MenuProps } from "antd";
import { App, Button, Drawer, Dropdown, Input, Pagination, Popover, Spin, Tag } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
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

const loadVersionReleaseModal = () => import("@/components/layout/version-release-modal").then((module) => module.VersionReleaseModal);
const VersionReleaseModal = dynamic(loadVersionReleaseModal, { ssr: false, loading: () => null });
const POINT_RECORD_PAGE_SIZE = 10;

export function UserStatusActions({ variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const [checkingIn, setCheckingIn] = useState(false);
    const [pointsOpen, setPointsOpen] = useState(false);
    const [pointsLoading, setPointsLoading] = useState(false);
    const [pointRecords, setPointRecords] = useState<PointRecord[]>([]);
    const [pointRecordsPage, setPointRecordsPage] = useState(1);
    const [pointRecordsTotal, setPointRecordsTotal] = useState(0);
    const [accountOpen, setAccountOpen] = useState(false);
    const [isCompactViewport, setIsCompactViewport] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const clearSession = useUserStore((state) => state.clearSession);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
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

    useEffect(() => {
        if (!showAdminMetaActions) return;
        return preloadOnIdle(() => {
            void loadVersionReleaseModal();
        });
    }, [showAdminMetaActions]);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 520px)");
        const syncViewport = () => setIsCompactViewport(mediaQuery.matches);
        syncViewport();
        mediaQuery.addEventListener("change", syncViewport);
        return () => mediaQuery.removeEventListener("change", syncViewport);
    }, []);

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
            if (target instanceof Element && target.closest(".user-points-popover, .ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu, .ant-dropdown-menu-submenu-popup")) {
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

    const loadPointRecords = async (page = pointRecordsPage) => {
        if (!user || pointsLoading) return;
        setPointsLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(POINT_RECORD_PAGE_SIZE),
            });
            const response = await fetch(`/api/points?${params.toString()}`, { cache: "no-store" });
            const payload = (await response.json()) as { records?: PointRecord[]; total?: number; page?: number; pageSize?: number; error?: string };
            if (!response.ok) throw new Error(payload.error || "积分记录加载失败");
            setPointRecords(payload.records || []);
            setPointRecordsTotal(payload.total || 0);
            setPointRecordsPage(payload.page || page);
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
        void loadPointRecords(1);
    };

    const handleAccountOpenChange = (open: boolean) => {
        setAccountOpen(open);
        if (open) setPointsOpen(false);
    };

    const pointsButton = user ? (
        <button
            type="button"
            className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "gap-1 px-2 text-xs font-semibold sm:gap-1.5 sm:px-2.5", variant === "canvas" ? "canvas-points-action" : "app-points-action shrink-0")}
            style={iconStyle}
            title="积分余额"
            onClick={isCompactViewport ? () => handlePointsOpenChange(true) : undefined}
        >
            <CreditSymbol className="text-sm" />
            {formatCreditAmount(user.pointsBalance)}
        </button>
    ) : null;

    return (
        <div ref={rootRef} className={cn("user-status-actions inline-flex max-w-full items-center gap-1.5 sm:gap-2", variant === "canvas" ? "canvas-user-status-actions shrink-0" : "app-user-status-actions min-w-0")}>
            {user && !isCompactViewport ? (
                <Popover
                    rootClassName="user-points-popover"
                    open={pointsOpen}
                    onOpenChange={handlePointsOpenChange}
                    trigger="click"
                    placement="bottomRight"
                    content={
                        <PointRecordPanel
                            loading={pointsLoading}
                            records={pointRecords}
                            page={pointRecordsPage}
                            pageSize={POINT_RECORD_PAGE_SIZE}
                            total={pointRecordsTotal}
                            onPageChange={(page) => void loadPointRecords(page)}
                            onRedeemed={() => void loadPointRecords(1)}
                        />
                    }
                >
                    {pointsButton}
                </Popover>
            ) : user ? (
                pointsButton
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
                    <span>{isCompactViewport ? compactCheckInLabel : checkInLabel}</span>
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
                    <Dropdown {...(variant === "canvas" ? { open: accountOpen, onOpenChange: handleAccountOpenChange } : {})} menu={{ items: accountItems, onClick: handleAccountMenuClick }} trigger={["click"]} placement="bottomRight">
                        <button
                            type="button"
                            className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "min-w-0 max-w-[36px] gap-2 px-2.5 sm:max-w-32 xl:max-w-40", variant === "canvas" ? "canvas-account-action" : "app-account-action")}
                            style={iconStyle}
                            aria-label="账户菜单"
                            title={user.displayName || user.username}
                        >
                            <UserCircle className="size-4 shrink-0" />
                            <span className="hidden min-w-0 truncate sm:inline">{user.displayName || user.username}</span>
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
            <Drawer
                placement="bottom"
                rootClassName="user-points-drawer"
                size="min(72dvh, 620px)"
                open={isCompactViewport && pointsOpen}
                onClose={() => setPointsOpen(false)}
                styles={{ header: { display: "none" }, body: { padding: 0, overflow: "hidden" } }}
            >
                <PointRecordPanel
                    loading={pointsLoading}
                    records={pointRecords}
                    page={pointRecordsPage}
                    pageSize={POINT_RECORD_PAGE_SIZE}
                    total={pointRecordsTotal}
                    onPageChange={(page) => void loadPointRecords(page)}
                    onRedeemed={() => void loadPointRecords(1)}
                    onClose={() => setPointsOpen(false)}
                    fullWidth
                />
            </Drawer>
        </div>
    );
}

function formatQuotaReward(rewardPoints?: number) {
    return `${formatCreditAmount(Math.max(0, Number(rewardPoints) || 0))} 积分`;
}

function PointRecordPanel({
    loading,
    records,
    page,
    pageSize,
    total,
    onPageChange,
    onRedeemed,
    onClose,
    fullWidth = false,
}: {
    loading: boolean;
    records: PointRecord[];
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onRedeemed: () => void;
    onClose?: () => void;
    fullWidth?: boolean;
}) {
    const { message } = App.useApp();
    const setUser = useUserStore((state) => state.setUser);
    const user = useUserStore((state) => state.user);
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const redeemCode = async () => {
        const value = code.trim();
        if (!value || redeeming) return;
        setRedeeming(true);
        try {
            const response = await fetch("/api/cdk/redeem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: value }),
            });
            const payload = (await response.json()) as { user?: ReturnType<typeof useUserStore.getState>["user"]; points?: number; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || "兑换失败");
            setUser(payload.user);
            setCode("");
            onRedeemed();
            message.success(`兑换成功，获得 ${formatCreditAmount(payload.points || 0)} 积分`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    return (
        <div className={cn("user-points-panel max-w-full overflow-hidden", fullWidth ? "flex h-full w-full flex-col" : "w-[min(21rem,calc(100vw-2rem))]")}>
            {fullWidth ? <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300 dark:bg-stone-700" /> : null}
            <div className={cn("flex items-start justify-between gap-3", fullWidth ? "border-b border-stone-200 px-4 pb-3 pt-4 dark:border-stone-800" : "mb-3")}>
                <div className="min-w-0">
                    <div className="text-base font-semibold leading-6 text-stone-950 dark:text-stone-100">积分记录</div>
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">共 {total} 条记录，按时间倒序显示</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm font-semibold text-stone-900 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-100">
                        <CreditSymbol className="text-sm text-sky-600 dark:text-sky-300" />
                        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">余额</span>
                        <span>{formatCreditAmount(user?.pointsBalance || 0)}</span>
                    </div>
                    {onClose ? (
                        <Button
                            type="text"
                            size="small"
                            className="inline-flex size-8 items-center justify-center rounded-full text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100"
                            icon={<X className="size-4" />}
                            onClick={onClose}
                            aria-label="关闭积分记录"
                        />
                    ) : null}
                </div>
            </div>
            <div className={cn("rounded-xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/45", fullWidth ? "mx-4 mt-4" : "mb-3")}>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-900 dark:text-stone-100">
                        <Gift className="size-4 text-sky-600 dark:text-sky-300" />
                        CDK 兑换
                    </div>
                    <span className="text-xs text-stone-500 dark:text-stone-400">兑换后自动刷新</span>
                </div>
                <Input.Search
                    value={code}
                    placeholder="输入兑换密钥"
                    enterButton={
                        <Button type="primary" loading={redeeming}>
                            兑换
                        </Button>
                    }
                    onChange={(event) => setCode(event.target.value)}
                    onSearch={() => void redeemCode()}
                />
            </div>
            <div className={cn("min-h-0", fullWidth ? "flex flex-1 flex-col px-4 pb-4 pt-3" : "")}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400">
                    <span>明细</span>
                    {total > pageSize ? (
                        <span>
                            {page}/{Math.max(1, Math.ceil(total / pageSize))} 页
                        </span>
                    ) : null}
                </div>
                {loading ? (
                    <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Spin size="small" />
                    </div>
                ) : records.length ? (
                    <>
                        <div className={cn("space-y-2 overflow-y-auto pr-0.5", fullWidth ? "min-h-0 flex-1" : "max-h-[min(22rem,58dvh)]")}>
                            {records.map((record) => {
                                const positive = record.amount > 0;
                                const description = splitPointRecordDescription(record.description);
                                return (
                                    <div key={record.id} className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-950/70">
                                        <div className="flex min-w-0 items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="break-words text-sm font-semibold leading-5 text-stone-800 dark:text-stone-100">{description.model}</div>
                                                {description.action ? <div className="mt-0.5 break-words text-xs leading-4 text-stone-500 dark:text-stone-400">{description.action}</div> : null}
                                            </div>
                                            <Tag color={positive ? "green" : "red"} className="m-0 shrink-0">
                                                {positive ? "+" : ""}
                                                {formatCreditAmount(record.amount)}
                                            </Tag>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                            <span>{new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                            <span>余额 {formatCreditAmount(record.balanceAfter)}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {total > pageSize ? (
                            <div className={cn("flex justify-center border-stone-200 dark:border-stone-800", fullWidth ? "mt-3 border-t pt-3" : "mt-3")}>
                                <Pagination simple={fullWidth} size="small" current={page} pageSize={pageSize} total={total} showSizeChanger={false} onChange={onPageChange} />
                            </div>
                        ) : null}
                    </>
                ) : (
                    <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-stone-200 px-3 py-8 text-center text-sm text-stone-500 dark:border-stone-800">暂无积分记录</div>
                )}
            </div>
        </div>
    );
}

function splitPointRecordDescription(description: string) {
    const text = description.trim();
    const actions = ["生成图片调用失败退回", "生成视频调用失败退回", "生成音频调用失败退回", "生成文本调用失败退回", "生成图片调用扣除", "生成视频调用扣除", "生成音频调用扣除", "生成文本调用扣除", "接口调用失败退回", "接口调用扣除"];
    const action = actions.find((item) => text.endsWith(item));
    if (!action) return { model: text, action: "" };
    const model = text.slice(0, -action.length).trim();
    return { model: model || "模型", action };
}

function preloadOnIdle(task: () => void) {
    const idleWindow = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback?.(task, { timeout: 2500 });
    if (idleId !== undefined) return () => idleWindow.cancelIdleCallback?.(idleId);
    const timer = window.setTimeout(task, 1200);
    return () => window.clearTimeout(timer);
}
