"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Segmented, Select, Space, Switch, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import {
    Copy,
    Database,
    Download,
    ExternalLink,
    Eye,
    Film,
    Gift,
    Globe2,
    Image as ImageIcon,
    KeyRound,
    Mail,
    Megaphone,
    PlugZap,
    Plus,
    RefreshCw,
    Save,
    Search,
    Send,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    Upload,
    UserCog,
    UserRound,
    UsersRound,
} from "lucide-react";
import dayjs from "dayjs";
import { nanoid } from "nanoid";

import { DEFAULT_MODEL_POINT_COST_KEY, formatCreditAmount } from "@/constant/credits";
import type { AuthSettings, CreatedCdkCode, PublicAnnouncement, PublicCdkCode, PublicUser, SiteFriendLink, SiteShowcaseItem, SiteSocialKey, SystemModelChannel, UserRole, UserStatus } from "@/lib/auth/store";
import type { GenerationAssetStats, StoredGenerationLog } from "@/lib/server/generation-log-store";
import type { Prompt } from "@/services/api/prompts";

type AdminDashboardProps = {
    initialUsers: PublicUser[];
    initialSettings: AuthSettings;
    initialPromptCount: number;
    currentUser: PublicUser;
};

type PromptFormValue = {
    title: string;
    prompt: string;
    category?: string;
    tags?: string;
    coverUrl?: string;
    preview?: string;
};

type UserEditorValue = {
    username?: string;
    displayName: string;
    email?: string;
    password?: string;
    role: UserRole;
    status: UserStatus;
    pointsBalance: number;
};

type ChannelHealthKind = "text" | "image" | "video";

type ChannelHealthResult = {
    ok: boolean;
    kind: ChannelHealthKind;
    model: string;
    status: number;
    pointsCost?: number;
    pointsRemaining?: number;
    taskId?: string;
    remoteUrl?: string;
    error?: string;
};

type WebdavSyncProgressLine = {
    id: string;
    text: string;
    status?: "active" | "success" | "exception";
};

type AdminSectionKey = "overview" | "site" | "settings" | "cdk" | "announcements" | "users" | "logs" | "prompts";

const PROMPT_PAGE_SIZE = 20;
const PROMPT_SEARCH_DEBOUNCE_MS = 300;
const CDK_PAGE_SIZE = 20;
const GENERATION_LOG_PAGE_SIZE = 20;
const imageQualityMultiplierOptions = [
    { key: "auto", label: "自动" },
    { key: "low", label: "低清" },
    { key: "medium", label: "中等" },
    { key: "high", label: "高清" },
];
const videoQualityMultiplierOptions = [
    { key: "480", label: "480p" },
    { key: "720", label: "720p" },
    { key: "1080", label: "1080p" },
];
const videoSecondsMultiplierOptions = [
    { key: "-1", label: "智能" },
    { key: "5", label: "5s" },
    { key: "10", label: "10s" },
];
const suggestedVideoSecondOptions = [6, 8, 20];
const legacyDefaultVideoSecondKeys = new Set(["12", "16"]);

const siteSocialItems: Array<{ key: SiteSocialKey; label: string; placeholder: string; icon: ReactNode }> = [
    { key: "email", label: "邮箱联系", placeholder: "mailto:contact@example.com", icon: <Mail className="size-4" /> },
    { key: "telegram", label: "Telegram", placeholder: "https://t.me/vozeb", icon: <Send className="size-4" /> },
    { key: "x", label: "X", placeholder: "https://x.com/vozeb", icon: <span className="text-xs font-bold">X</span> },
    { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/vozeb", icon: <span className="text-[11px] font-bold">IG</span> },
];

export function AdminDashboard({ initialUsers, initialSettings, initialPromptCount, currentUser }: AdminDashboardProps) {
    const { message, modal } = App.useApp();
    const [promptForm] = Form.useForm<PromptFormValue>();
    const [userForm] = Form.useForm<UserEditorValue>();
    const logoInputRef = useRef<HTMLInputElement>(null);
    const backupInputRef = useRef<HTMLInputElement>(null);
    const promptRequestIdRef = useRef(0);
    const generationLogRequestIdRef = useRef(0);
    const [users, setUsers] = useState(initialUsers);
    const [settings, setSettings] = useState(initialSettings);
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [promptCount, setPromptCount] = useState(initialPromptCount);
    const [promptListTotal, setPromptListTotal] = useState(initialPromptCount);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [backupLoading, setBackupLoading] = useState(false);
    const [backupImporting, setBackupImporting] = useState(false);
    const [assetStats, setAssetStats] = useState<GenerationAssetStats | null>(null);
    const [assetStatsLoading, setAssetStatsLoading] = useState(false);
    const [assetCleanupLoading, setAssetCleanupLoading] = useState(false);
    const [mailTestLoading, setMailTestLoading] = useState(false);
    const [mailTestTo, setMailTestTo] = useState("");
    const [fetchingModelId, setFetchingModelId] = useState("");
    const [testingChannelKey, setTestingChannelKey] = useState("");
    const [channelHealthResults, setChannelHealthResults] = useState<Record<string, ChannelHealthResult>>({});
    const [promptSaving, setPromptSaving] = useState(false);
    const [promptsLoading, setPromptsLoading] = useState(false);
    const [deletingPromptId, setDeletingPromptId] = useState("");
    const [promptSearch, setPromptSearch] = useState("");
    const [debouncedPromptSearch, setDebouncedPromptSearch] = useState("");
    const [promptPage, setPromptPage] = useState(1);
    const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
    const [bulkDeletingPrompts, setBulkDeletingPrompts] = useState(false);
    const [userSearch, setUserSearch] = useState("");
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkDeletingUsers, setBulkDeletingUsers] = useState(false);
    const [generationLogs, setGenerationLogs] = useState<StoredGenerationLog[]>([]);
    const [generationLogTotal, setGenerationLogTotal] = useState(0);
    const [generationLogPage, setGenerationLogPage] = useState(1);
    const [generationLogSearch, setGenerationLogSearch] = useState("");
    const [generationLogKind, setGenerationLogKind] = useState("");
    const [generationLogSource, setGenerationLogSource] = useState("");
    const [generationLogStatus, setGenerationLogStatus] = useState("");
    const [generationLogUserId, setGenerationLogUserId] = useState("");
    const [generationLogStart, setGenerationLogStart] = useState("");
    const [generationLogEnd, setGenerationLogEnd] = useState("");
    const [selectedGenerationLogIds, setSelectedGenerationLogIds] = useState<string[]>([]);
    const [generationLogsLoading, setGenerationLogsLoading] = useState(false);
    const [bulkDeletingGenerationLogs, setBulkDeletingGenerationLogs] = useState(false);
    const [viewingGenerationLog, setViewingGenerationLog] = useState<StoredGenerationLog | null>(null);
    const [viewingCdkCode, setViewingCdkCode] = useState<PublicCdkCode | null>(null);
    const [cdkCodes, setCdkCodes] = useState<PublicCdkCode[]>([]);
    const [cdkLoading, setCdkLoading] = useState(false);
    const [cdkGenerating, setCdkGenerating] = useState(false);
    const [createdCdkCodes, setCreatedCdkCodes] = useState<CreatedCdkCode[]>([]);
    const [selectedCreatedCdkIds, setSelectedCreatedCdkIds] = useState<string[]>([]);
    const [cdkForm, setCdkForm] = useState({ count: 1, points: 10, maxRedemptions: 1, expiresInDays: null as number | null, note: "" });
    const [cdkSearch, setCdkSearch] = useState("");
    const [debouncedCdkSearch, setDebouncedCdkSearch] = useState("");
    const [cdkFilter, setCdkFilter] = useState<"all" | "redeemed" | "unused" | "expired">("all");
    const [cdkPage, setCdkPage] = useState(1);
    const [cdkTotal, setCdkTotal] = useState(0);
    const [cdkStats, setCdkStats] = useState({ total: 0, redeemed: 0, unused: 0, expired: 0 });
    const [selectedCdkIds, setSelectedCdkIds] = useState<string[]>([]);
    const [bulkDeletingCdk, setBulkDeletingCdk] = useState(false);
    const [announcements, setAnnouncements] = useState<PublicAnnouncement[]>([]);
    const [announcementsLoading, setAnnouncementsLoading] = useState(false);
    const [announcementSaving, setAnnouncementSaving] = useState(false);
    const [announcementDraft, setAnnouncementDraft] = useState<Partial<PublicAnnouncement>>({ title: "", content: "", enabled: true, popupHome: false, popupAfterLogin: false });
    const [webdavTesting, setWebdavTesting] = useState(false);
    const [webdavSyncOpen, setWebdavSyncOpen] = useState(false);
    const [webdavSyncing, setWebdavSyncing] = useState(false);
    const [webdavSyncProgress, setWebdavSyncProgress] = useState<WebdavSyncProgressLine[]>([]);
    const [webdavSyncSummary, setWebdavSyncSummary] = useState("");
    const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [activeSection, setActiveSection] = useState<AdminSectionKey>("overview");
    const [customPointModel, setCustomPointModel] = useState("");
    const stats = useMemo(
        () => ({
            total: users.length,
            active: users.filter((user) => user.status === "active").length,
            admins: users.filter((user) => user.role === "admin").length,
            disabled: users.filter((user) => user.status === "disabled").length,
        }),
        [users],
    );
    const settingsSummary = useMemo(
        () => ({
            totalChannels: settings.systemChannels.length,
            enabledChannels: settings.systemChannels.filter((channel) => channel.enabled).length,
            models: uniqueList(settings.systemChannels.flatMap((channel) => channel.models)).length,
        }),
        [settings.systemChannels],
    );
    const filteredUsers = useMemo(() => {
        const keyword = userSearch.trim().toLowerCase();
        if (!keyword) return users;
        return users.filter((user) => [user.displayName, user.username, user.email || "", user.role === "admin" ? "管理员" : "普通用户", user.status === "active" ? "可用" : "禁用"].some((value) => value.toLowerCase().includes(keyword)));
    }, [userSearch, users]);
    const selectedUsers = useMemo(() => users.filter((user) => selectedUserIds.includes(user.id)), [selectedUserIds, users]);
    const selectedPrompts = useMemo(() => prompts.filter((prompt) => selectedPromptIds.includes(prompt.id)), [prompts, selectedPromptIds]);
    const selectedGenerationLogs = useMemo(() => generationLogs.filter((log) => selectedGenerationLogIds.includes(log.id)), [generationLogs, selectedGenerationLogIds]);
    const promptListStart = promptListTotal ? (promptPage - 1) * PROMPT_PAGE_SIZE + 1 : 0;
    const promptListEnd = Math.min(promptPage * PROMPT_PAGE_SIZE, promptListTotal);
    const selectedCreatedCdkCodes = useMemo(() => createdCdkCodes.filter((code) => selectedCreatedCdkIds.includes(code.id)), [createdCdkCodes, selectedCreatedCdkIds]);
    const createdCdkActionCodes = selectedCreatedCdkCodes.length ? selectedCreatedCdkCodes : createdCdkCodes;
    const allCreatedCdkSelected = Boolean(createdCdkCodes.length) && selectedCreatedCdkIds.length === createdCdkCodes.length;

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedPromptSearch(promptSearch.trim()), PROMPT_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [promptSearch]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedCdkSearch(cdkSearch.trim()), PROMPT_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [cdkSearch]);

    useEffect(() => {
        if (activeSection !== "prompts") return;
        void loadPrompts(promptPage, debouncedPromptSearch);
    }, [activeSection, promptPage, debouncedPromptSearch]);

    useEffect(() => {
        if (activeSection !== "overview") return;
        void loadGenerationAssetStats();
    }, [activeSection]);

    useEffect(() => {
        if (activeSection !== "logs") return;
        void loadGenerationLogs();
    }, [activeSection, generationLogPage, generationLogSearch, generationLogKind, generationLogSource, generationLogStatus, generationLogUserId, generationLogStart, generationLogEnd]);

    useEffect(() => {
        if (activeSection !== "cdk") return;
        void loadCdkCodes();
    }, [activeSection, cdkPage, debouncedCdkSearch, cdkFilter]);

    useEffect(() => {
        if (activeSection !== "announcements") return;
        void loadAnnouncements();
    }, [activeSection]);

    const saveSettings = async (patch: Partial<AuthSettings>, successText = "设置已保存") => {
        setSettingsLoading(true);
        try {
            const response = await fetch("/api/admin/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            const payload = (await response.json()) as { settings?: AuthSettings; error?: string };
            if (!response.ok || !payload.settings) throw new Error(payload.error || "更新设置失败");
            setSettings(payload.settings);
            message.success(successText);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新设置失败");
        } finally {
            setSettingsLoading(false);
        }
    };

    const downloadBackup = async () => {
        setBackupLoading(true);
        try {
            const response = await fetch("/api/admin/backup");
            if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(payload?.error || "备份失败");
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            const date = new Date().toISOString().slice(0, 10);
            link.href = url;
            link.download = `vozeb-data-backup-${date}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            message.success("用户数据库备份已下载");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "备份失败");
        } finally {
            setBackupLoading(false);
        }
    };

    const chooseBackupFile = () => {
        backupInputRef.current?.click();
    };

    const importBackupFile = (file: File) => {
        modal.confirm({
            title: "导入数据库备份？",
            content: "导入会用备份文件覆盖服务端用户数据库、公共提示词和生成日志中包含的数据。系统会先在服务器保留当前数据快照，导入后页面会自动刷新。",
            okText: "导入",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setBackupImporting(true);
                try {
                    const formData = new FormData();
                    formData.append("file", file);
                    const response = await fetch("/api/admin/backup", { method: "POST", body: formData });
                    const payload = (await response.json().catch(() => null)) as { imported?: string[]; error?: string } | null;
                    if (!response.ok) throw new Error(payload?.error || "导入数据库失败");
                    message.success(`数据库导入完成：${(payload?.imported || []).join("、") || "已导入"}`);
                    window.setTimeout(() => window.location.reload(), 800);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "导入数据库失败");
                } finally {
                    setBackupImporting(false);
                }
            },
        });
    };

    const loadGenerationAssetStats = async () => {
        setAssetStatsLoading(true);
        try {
            const response = await fetch("/api/admin/generation-assets", { cache: "no-store" });
            const payload = (await response.json().catch(() => null)) as { stats?: GenerationAssetStats; error?: string } | null;
            if (!response.ok || !payload?.stats) throw new Error(payload?.error || "加载生成资源统计失败");
            setAssetStats(payload.stats);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载生成资源统计失败");
        } finally {
            setAssetStatsLoading(false);
        }
    };

    const cleanupGenerationAssets = () => {
        modal.confirm({
            title: "清理未引用的本地生成资源？",
            content: "只会删除后台生成日志已经不再引用的本地预览文件，不会删除日志仍在使用的结果，也不会处理远程图片或用户账号数据。",
            okText: "清理",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setAssetCleanupLoading(true);
                try {
                    const response = await fetch("/api/admin/generation-assets", { method: "DELETE" });
                    const payload = (await response.json().catch(() => null)) as { deletedFiles?: number; deletedBytes?: number; stats?: GenerationAssetStats; error?: string } | null;
                    if (!response.ok || !payload) throw new Error(payload?.error || "清理生成资源失败");
                    if (payload.stats) setAssetStats(payload.stats);
                    message.success(`已清理 ${payload.deletedFiles ?? 0} 个未引用文件，释放 ${formatBytes(payload.deletedBytes || 0)}`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "清理生成资源失败");
                } finally {
                    setAssetCleanupLoading(false);
                }
            },
        });
    };

    const updateUser = async (userId: string, patch: Partial<Pick<PublicUser, "displayName" | "email" | "role" | "status" | "pointsBalance">> & { password?: string }) => {
        setUpdatingUserId(userId);
        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            const payload = (await response.json()) as { user?: PublicUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || "更新用户失败");
            setUsers((items) => items.map((item) => (item.id === userId ? payload.user! : item)));
            message.success("用户已更新");
            return payload.user;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新用户失败");
            return null;
        } finally {
            setUpdatingUserId(null);
        }
    };

    const createUser = async (value: UserEditorValue) => {
        setUpdatingUserId("__new__");
        try {
            const response = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: value.username || "",
                    displayName: value.displayName,
                    email: value.email || "",
                    password: value.password || "",
                    role: value.role,
                    status: value.status,
                    pointsBalance: toNumberOrZero(value.pointsBalance),
                }),
            });
            const payload = (await response.json()) as { user?: PublicUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || "Create user failed");
            setUsers((items) => [payload.user!, ...items]);
            message.success("用户已新增");
            return payload.user;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Create user failed");
            return null;
        } finally {
            setUpdatingUserId(null);
        }
    };

    const deleteUser = async (userId: string) => {
        setUpdatingUserId(userId);
        try {
            const response = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "删除用户失败");
            setUsers((items) => items.filter((item) => item.id !== userId));
            setSelectedUserIds((items) => items.filter((id) => id !== userId));
            message.success("用户已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除用户失败");
        } finally {
            setUpdatingUserId(null);
        }
    };

    const bulkDeleteUsers = async () => {
        const deletable = selectedUsers.filter((user) => user.id !== currentUser.id);
        if (!deletable.length) {
            message.warning("请选择可删除的用户");
            return;
        }

        setBulkDeletingUsers(true);
        const deletedIds: string[] = [];
        const failedMessages: string[] = [];
        try {
            for (const user of deletable) {
                const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
                const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                if (response.ok) {
                    deletedIds.push(user.id);
                } else {
                    failedMessages.push(`${user.displayName || user.username}：${payload?.error || "删除失败"}`);
                }
            }
            if (deletedIds.length) {
                setUsers((items) => items.filter((item) => !deletedIds.includes(item.id)));
                setSelectedUserIds((items) => items.filter((id) => !deletedIds.includes(id)));
            }
            if (failedMessages.length) {
                message.warning(`已删除 ${deletedIds.length} 个，${failedMessages.length} 个失败：${failedMessages.join("；")}`);
            } else {
                message.success(`已删除 ${deletedIds.length} 个用户`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量删除失败");
        } finally {
            setBulkDeletingUsers(false);
        }
    };

    const createPrompt = async (value: PromptFormValue) => {
        setPromptSaving(true);
        try {
            const response = await fetch("/api/admin/prompts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...value, tags: splitTags(value.tags) }),
            });
            const payload = (await response.json()) as { prompt?: Prompt; error?: string };
            if (!response.ok || !payload.prompt) throw new Error(payload.error || "新增提示词失败");
            promptForm.resetFields();
            setPromptPage(1);
            setPromptSearch("");
            setDebouncedPromptSearch("");
            void loadPrompts(1, "");
            message.success("公共提示词已新增");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新增提示词失败");
        } finally {
            setPromptSaving(false);
        }
    };

    const deletePrompt = async (id: string) => {
        setDeletingPromptId(id);
        try {
            const response = await fetch(`/api/admin/prompts/${id}`, { method: "DELETE" });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "删除提示词失败");
            setSelectedPromptIds((ids) => ids.filter((item) => item !== id));
            const nextTotal = Math.max(0, promptListTotal - 1);
            const nextPage = Math.min(promptPage, Math.max(1, Math.ceil(nextTotal / PROMPT_PAGE_SIZE)));
            setPromptCount((count) => Math.max(0, count - 1));
            setPromptListTotal(nextTotal);
            if (nextPage !== promptPage) {
                setPromptPage(nextPage);
            } else {
                void loadPrompts(nextPage, debouncedPromptSearch);
            }
            message.success("公共提示词已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除提示词失败");
        } finally {
            setDeletingPromptId("");
        }
    };

    const bulkDeletePrompts = async () => {
        const ids = selectedPromptIds.filter((id) => prompts.some((prompt) => prompt.id === id));
        if (!ids.length) return;
        setBulkDeletingPrompts(true);
        try {
            for (const id of ids) {
                const response = await fetch(`/api/admin/prompts/${id}`, { method: "DELETE" });
                const payload = (await response.json()) as { error?: string };
                if (!response.ok) throw new Error(payload.error || "批量删除提示词失败");
            }
            setSelectedPromptIds([]);
            const nextTotal = Math.max(0, promptListTotal - ids.length);
            const nextPage = Math.min(promptPage, Math.max(1, Math.ceil(nextTotal / PROMPT_PAGE_SIZE)));
            setPromptCount((count) => Math.max(0, count - ids.length));
            setPromptListTotal(nextTotal);
            if (nextPage !== promptPage) {
                setPromptPage(nextPage);
            } else {
                void loadPrompts(nextPage, debouncedPromptSearch);
            }
            message.success(`已删除 ${ids.length} 条公共提示词`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量删除提示词失败");
        } finally {
            setBulkDeletingPrompts(false);
        }
    };

    const loadPrompts = async (page = promptPage, keyword = debouncedPromptSearch) => {
        const requestId = promptRequestIdRef.current + 1;
        promptRequestIdRef.current = requestId;
        setPromptsLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PROMPT_PAGE_SIZE) });
            if (keyword) params.set("keyword", keyword);
            const response = await fetch(`/api/admin/prompts?${params.toString()}`);
            const payload = (await response.json()) as { prompts?: Prompt[]; total?: number; scopeTotal?: number; error?: string };
            if (!response.ok || !payload.prompts) throw new Error(payload.error || "加载提示词失败");
            if (requestId !== promptRequestIdRef.current) return;
            setPrompts(payload.prompts);
            setPromptListTotal(Number(payload.total ?? payload.prompts.length));
            setPromptCount(Number(payload.scopeTotal ?? payload.total ?? payload.prompts.length));
            setSelectedPromptIds((ids) => ids.filter((id) => payload.prompts!.some((prompt) => prompt.id === id)));
        } catch (error) {
            if (requestId === promptRequestIdRef.current) message.error(error instanceof Error ? error.message : "加载提示词失败");
        } finally {
            if (requestId === promptRequestIdRef.current) setPromptsLoading(false);
        }
    };

    const loadGenerationLogs = async (page = generationLogPage) => {
        const requestId = generationLogRequestIdRef.current + 1;
        generationLogRequestIdRef.current = requestId;
        setGenerationLogsLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(GENERATION_LOG_PAGE_SIZE) });
            if (generationLogSearch.trim()) params.set("keyword", generationLogSearch.trim());
            if (generationLogKind) params.set("kind", generationLogKind);
            if (generationLogSource) params.set("source", generationLogSource);
            if (generationLogStatus) params.set("status", generationLogStatus);
            if (generationLogUserId) params.set("userId", generationLogUserId);
            if (generationLogStart) params.set("start", generationLogStart);
            if (generationLogEnd) params.set("end", generationLogEnd);
            const response = await fetch(`/api/admin/generation-logs?${params.toString()}`, { cache: "no-store" });
            const payload = (await response.json()) as { logs?: StoredGenerationLog[]; total?: number; error?: string };
            if (!response.ok || !payload.logs) throw new Error(payload.error || "加载生成日志失败");
            if (requestId !== generationLogRequestIdRef.current) return;
            setGenerationLogs(payload.logs);
            setGenerationLogTotal(Number(payload.total ?? payload.logs.length));
            setSelectedGenerationLogIds((ids) => ids.filter((id) => payload.logs!.some((log) => log.id === id)));
        } catch (error) {
            if (requestId === generationLogRequestIdRef.current) message.error(error instanceof Error ? error.message : "加载生成日志失败");
        } finally {
            if (requestId === generationLogRequestIdRef.current) setGenerationLogsLoading(false);
        }
    };

    const deleteGenerationLogsByIds = async (ids: string[]) => {
        const deletingIds = Array.from(new Set(ids)).filter(Boolean);
        if (!deletingIds.length) return;
        setBulkDeletingGenerationLogs(true);
        try {
            const response = await fetch("/api/admin/generation-logs", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: deletingIds }),
            });
            const payload = (await response.json()) as { deleted?: number; error?: string };
            if (!response.ok) throw new Error(payload.error || "删除生成日志失败");
            setSelectedGenerationLogIds((current) => current.filter((id) => !deletingIds.includes(id)));
            void loadGenerationLogs();
            message.success(`已删除 ${payload.deleted ?? deletingIds.length} 条生成日志`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除生成日志失败");
        } finally {
            setBulkDeletingGenerationLogs(false);
        }
    };

    const resetGenerationLogFilters = () => {
        setGenerationLogSearch("");
        setGenerationLogKind("");
        setGenerationLogSource("");
        setGenerationLogStatus("");
        setGenerationLogUserId("");
        setGenerationLogStart("");
        setGenerationLogEnd("");
        setGenerationLogPage(1);
    };

    const loadCdkCodes = async (override?: { page?: number; keyword?: string; filter?: typeof cdkFilter }) => {
        setCdkLoading(true);
        try {
            const nextPage = override?.page ?? cdkPage;
            const nextKeyword = override?.keyword ?? debouncedCdkSearch;
            const nextFilter = override?.filter ?? cdkFilter;
            const params = new URLSearchParams({
                page: String(nextPage),
                pageSize: String(CDK_PAGE_SIZE),
                keyword: nextKeyword,
                filter: nextFilter,
            });
            const response = await fetch(`/api/admin/cdk?${params.toString()}`, { cache: "no-store" });
            const payload = (await response.json()) as {
                codes?: PublicCdkCode[];
                total?: number;
                page?: number;
                stats?: typeof cdkStats;
                error?: string;
            };
            if (!response.ok || !payload.codes) throw new Error(payload.error || "加载 CDK 失败");
            setCdkCodes(payload.codes);
            setCdkTotal(payload.total || 0);
            setCdkStats(payload.stats || { total: 0, redeemed: 0, unused: 0, expired: 0 });
            if (payload.page && payload.page !== cdkPage) setCdkPage(payload.page);
            setSelectedCdkIds((current) => current.filter((id) => payload.codes!.some((code) => code.id === id)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载 CDK 失败");
        } finally {
            setCdkLoading(false);
        }
    };

    const generateCdkCodes = async () => {
        setCdkGenerating(true);
        try {
            const response = await fetch("/api/admin/cdk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(cdkForm),
            });
            const payload = (await response.json()) as { codes?: CreatedCdkCode[]; error?: string };
            if (!response.ok || !payload.codes) throw new Error(payload.error || "生成 CDK 失败");
            setCreatedCdkCodes((current) => [...payload.codes!, ...current]);
            setSelectedCreatedCdkIds(payload.codes.map((code) => code.id));
            setCdkSearch("");
            setDebouncedCdkSearch("");
            setCdkFilter("unused");
            setCdkPage(1);
            await loadCdkCodes({ page: 1, keyword: "", filter: "unused" });
            message.success(`已生成 ${payload.codes.length} 个 CDK`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成 CDK 失败");
        } finally {
            setCdkGenerating(false);
        }
    };

    const deleteCdkById = async (id: string) => {
        try {
            const response = await fetch(`/api/admin/cdk/${id}`, { method: "DELETE" });
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "删除 CDK 失败");
            setCreatedCdkCodes((current) => current.filter((code) => code.id !== id));
            setSelectedCreatedCdkIds((current) => current.filter((item) => item !== id));
            setSelectedCdkIds((current) => current.filter((item) => item !== id));
            await loadCdkCodes();
            message.success("CDK 已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除 CDK 失败");
        }
    };

    const deleteCreatedCdkCodes = async (ids: string[]) => {
        const deletingIds = Array.from(new Set(ids)).filter(Boolean);
        if (!deletingIds.length) return;
        try {
            const response = await fetch("/api/admin/cdk", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: deletingIds }),
            });
            const payload = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
            if (!response.ok) throw new Error(payload.error || "删除 CDK 失败");
            setCreatedCdkCodes((current) => current.filter((code) => !deletingIds.includes(code.id)));
            setSelectedCreatedCdkIds((current) => current.filter((id) => !deletingIds.includes(id)));
            setSelectedCdkIds((current) => current.filter((id) => !deletingIds.includes(id)));
            await loadCdkCodes();
            message.success(`已删除 ${payload.deleted ?? deletingIds.length} 个 CDK`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除 CDK 失败");
        }
    };

    const bulkDeleteCdkCodes = async () => {
        const ids = Array.from(new Set(selectedCdkIds));
        if (!ids.length || bulkDeletingCdk) return;
        setBulkDeletingCdk(true);
        try {
            const response = await fetch("/api/admin/cdk", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
            });
            const payload = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
            if (!response.ok) throw new Error(payload.error || "批量删除 CDK 失败");
            setSelectedCdkIds([]);
            setCreatedCdkCodes((current) => current.filter((code) => !ids.includes(code.id)));
            setSelectedCreatedCdkIds((current) => current.filter((id) => !ids.includes(id)));
            await loadCdkCodes();
            message.success(`已删除 ${payload.deleted ?? ids.length} 个 CDK`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量删除 CDK 失败");
        } finally {
            setBulkDeletingCdk(false);
        }
    };

    const copyCreatedCdkCodes = async (codes = createdCdkActionCodes) => {
        if (!codes.length) return;
        try {
            await navigator.clipboard.writeText(codes.map((code) => code.code).join("\n"));
            message.success(`已复制 ${codes.length} 个 CDK`);
        } catch {
            message.error("复制失败，请手动复制明文 CDK");
        }
    };

    const copyCdkPlainCode = async (code: PublicCdkCode) => {
        if (!code.code) {
            message.warning("这个 CDK 没有可复制的明文");
            return;
        }
        try {
            await navigator.clipboard.writeText(code.code);
            message.success("已复制 CDK 明文");
        } catch {
            message.error("复制失败，请手动复制明文 CDK");
        }
    };

    const exportCreatedCdkCodes = (codes = createdCdkActionCodes) => {
        if (!codes.length) return;
        const text = formatCreatedCdkExport(codes);
        downloadTextFile(`vozeb-cdk-${dayjs().format("YYYYMMDD-HHmmss")}.txt`, text);
        message.success(`已导出 ${codes.length} 个 CDK`);
    };

    const loadAnnouncements = async () => {
        setAnnouncementsLoading(true);
        try {
            const response = await fetch("/api/admin/announcements", { cache: "no-store" });
            const payload = (await response.json()) as { announcements?: PublicAnnouncement[]; error?: string };
            if (!response.ok || !payload.announcements) throw new Error(payload.error || "加载公告失败");
            setAnnouncements(payload.announcements);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载公告失败");
        } finally {
            setAnnouncementsLoading(false);
        }
    };

    const saveAnnouncementDraft = async () => {
        setAnnouncementSaving(true);
        try {
            const response = await fetch("/api/admin/announcements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(announcementDraft),
            });
            const payload = (await response.json()) as { announcement?: PublicAnnouncement; error?: string };
            if (!response.ok || !payload.announcement) throw new Error(payload.error || "保存公告失败");
            setAnnouncementDraft({ title: "", content: "", enabled: true, popupHome: false, popupAfterLogin: false });
            await loadAnnouncements();
            message.success("公告已发布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存公告失败");
        } finally {
            setAnnouncementSaving(false);
        }
    };

    const updateAnnouncementById = async (announcement: PublicAnnouncement, patch: Partial<PublicAnnouncement>) => {
        try {
            const response = await fetch(`/api/admin/announcements/${announcement.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            const payload = (await response.json()) as { announcement?: PublicAnnouncement; error?: string };
            if (!response.ok || !payload.announcement) throw new Error(payload.error || "更新公告失败");
            setAnnouncements((current) => current.map((item) => (item.id === payload.announcement!.id ? payload.announcement! : item)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新公告失败");
        }
    };

    const deleteAnnouncementById = async (id: string) => {
        try {
            const response = await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "删除公告失败");
            setAnnouncements((current) => current.filter((item) => item.id !== id));
            message.success("公告已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除公告失败");
        }
    };

    const updateChannel = (id: string, patch: Partial<SystemModelChannel>) => {
        setSettings((current) => ({
            ...current,
            systemChannels: current.systemChannels.map((channel) => (channel.id === id ? { ...channel, ...patch, apiFormat: "openai", models: patch.models ? uniqueList(patch.models) : channel.models } : channel)),
        }));
    };

    const addChannel = () => {
        setSettings((current) => ({ ...current, systemChannels: [...current.systemChannels, createSystemChannel()] }));
    };

    const deleteChannel = (id: string) => {
        setSettings((current) => ({ ...current, systemChannels: current.systemChannels.filter((channel) => channel.id !== id) }));
    };

    const updateDefaultPoints = (value: number | null) => {
        setSettings((current) => ({ ...current, defaultPoints: toNumberOrZero(value) }));
    };

    const updateCheckInRewardPoints = (value: number | null) => {
        setSettings((current) => ({ ...current, checkInRewardPoints: toNumberOrZero(value) }));
    };

    const updateGenerationConcurrency = (key: keyof AuthSettings["generationConcurrency"], value: number | null) => {
        setSettings((current) => ({
            ...current,
            generationConcurrency: {
                ...current.generationConcurrency,
                [key]: clampInteger(value, 1, key === "image" ? 10 : 5, key === "image" ? 4 : 1),
            },
        }));
    };

    const updateGenerationDefaults = (key: keyof AuthSettings["generationDefaults"], value: number | null) => {
        setSettings((current) => ({
            ...current,
            generationDefaults: {
                ...current.generationDefaults,
                [key]: clampInteger(value, 1, 10, 1),
            },
        }));
    };

    const updateGenerationAssetStorage = (key: keyof AuthSettings["generationAssetStorage"], value: boolean) => {
        setSettings((current) => ({
            ...current,
            generationAssetStorage: {
                ...current.generationAssetStorage,
                [key]: value,
            },
        }));
    };

    const updateWebdavSetting = <K extends keyof AuthSettings["webdav"]>(key: K, value: AuthSettings["webdav"][K]) => {
        setSettings((current) => ({ ...current, webdav: { ...current.webdav, [key]: value } }));
    };

    const testWebdavSettings = async () => {
        setWebdavTesting(true);
        try {
            await saveSettings({ webdav: settings.webdav }, "WebDAV 设置已保存");
            const response = await fetch("/api/admin/webdav/test", { method: "POST" });
            const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!response.ok || !payload.ok) throw new Error(payload.error || "WebDAV 连接失败");
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接失败");
        } finally {
            setWebdavTesting(false);
        }
    };

    const startWebdavSync = async () => {
        if (webdavSyncing) return;
        if (!settings.webdav.enabled || !settings.webdav.url.trim()) {
            message.warning("请先开启并填写 WebDAV 地址");
            return;
        }
        setWebdavSyncing(true);
        setWebdavSyncSummary("");
        setWebdavSyncProgress([{ id: "start", text: "准备同步当前浏览器的本地数据", status: "active" }]);
        try {
            await saveSettings({ webdav: settings.webdav }, "WebDAV 设置已保存");
            const { syncAppDataToWebdav } = await import("@/services/app-sync");
            const result = await syncAppDataToWebdav(
                {
                    proxyMode: "nextjs",
                    url: "/api/webdav",
                    username: "",
                    password: "",
                    directory: "",
                    lastSyncedAt: "",
                },
                (event) => {
                    const text = [event.label, event.stage, event.total ? `${event.current || 0}/${event.total}` : ""].filter(Boolean).join(" · ");
                    setWebdavSyncProgress((current) => [...current.slice(-7), { id: `${Date.now()}-${current.length}`, text, status: event.status }]);
                },
            );
            setWebdavSyncSummary(`同步完成：画布 ${result.projects} 个，素材 ${result.assets} 个，生图记录 ${result.imageLogs} 条，视频记录 ${result.videoLogs} 条，上传文件 ${result.uploadedFiles} 个。`);
            message.success("当前浏览器数据同步完成");
        } catch (error) {
            const text = error instanceof Error ? error.message : "WebDAV 同步失败";
            setWebdavSyncProgress((current) => [...current.slice(-7), { id: `${Date.now()}-error`, text, status: "exception" }]);
            message.error(text);
        } finally {
            setWebdavSyncing(false);
        }
    };

    const updateModelPointCost = (model: string, value: number | null) => {
        setSettings((current) => ({ ...current, modelPointCosts: { ...current.modelPointCosts, [model]: toNumberOrOne(value) } }));
    };

    const updateGenerationPointMultiplier = (group: keyof AuthSettings["generationPointMultipliers"], key: string, value: number | null) => {
        setSettings((current) => ({
            ...current,
            generationPointMultipliers: {
                ...current.generationPointMultipliers,
                [group]: {
                    ...current.generationPointMultipliers[group],
                    [key]: toNumberOrOne(value),
                },
            },
        }));
    };

    const deleteGenerationPointMultiplier = (group: keyof AuthSettings["generationPointMultipliers"], key: string) => {
        setSettings((current) => {
            const nextGroup = { ...current.generationPointMultipliers[group] };
            delete nextGroup[key];
            return {
                ...current,
                generationPointMultipliers: {
                    ...current.generationPointMultipliers,
                    [group]: nextGroup,
                },
            };
        });
    };

    const addCustomPointModel = () => {
        const model = customPointModel.trim();
        if (!model) {
            message.warning("请输入模型名称");
            return;
        }
        updateModelPointCost(model, settings.modelPointCosts[model] ?? 1);
        setCustomPointModel("");
    };

    const deleteModelPointCost = (model: string) => {
        setSettings((current) => {
            const next = { ...current.modelPointCosts };
            delete next[model];
            return { ...current, modelPointCosts: next };
        });
    };

    const updateMailSetting = (key: keyof AuthSettings["mail"], value: string | number | boolean) => {
        setSettings((current) => ({ ...current, mail: { ...current.mail, [key]: value } }));
    };

    const testMailSettings = async () => {
        setMailTestLoading(true);
        try {
            const response = await fetch("/api/admin/mail/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mail: settings.mail, to: mailTestTo }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "测试邮件发送失败");
            message.success("测试邮件已发送，请检查收件箱");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "测试邮件发送失败");
        } finally {
            setMailTestLoading(false);
        }
    };

    const updateSiteSetting = <K extends keyof Omit<AuthSettings["site"], "socials">>(key: K, value: AuthSettings["site"][K]) => {
        setSettings((current) => ({ ...current, site: { ...current.site, [key]: value } }));
    };

    const uploadSiteLogo = (file?: File) => {
        if (!file) return;
        const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
        if (!allowed.includes(file.type)) {
            message.warning("Logo 仅支持 PNG、JPG、SVG");
            return;
        }
        if (file.size > 300 * 1024) {
            message.warning("Logo 文件不能超过 300KB");
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            updateSiteSetting("logoUrl", String(reader.result || ""));
            message.success("Logo 已读取，保存设置后生效");
        };
        reader.onerror = () => message.error("Logo 读取失败");
        reader.readAsDataURL(file);
    };

    const updateSiteSocialSetting = (key: SiteSocialKey, patch: Partial<AuthSettings["site"]["socials"][SiteSocialKey]>) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                socials: {
                    ...current.site.socials,
                    [key]: { ...current.site.socials[key], ...patch },
                },
            },
        }));
    };

    const addFriendLink = () => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                friendLinks: [...(current.site.friendLinks || []), { id: nanoid(), label: "友情链接", url: "https://", enabled: true }],
            },
        }));
    };

    const updateFriendLink = (id: string, patch: Partial<SiteFriendLink>) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                friendLinks: (current.site.friendLinks || []).map((link) => (link.id === id ? { ...link, ...patch } : link)),
            },
        }));
    };

    const deleteFriendLink = (id: string) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                friendLinks: (current.site.friendLinks || []).filter((link) => link.id !== id),
            },
        }));
    };

    const addHomeShowcaseItem = () => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                homeShowcaseMode: "custom",
                homeShowcaseItems: [
                    ...(current.site.homeShowcaseItems || []),
                    {
                        id: nanoid(),
                        title: "首页展示提示词",
                        coverUrl: "",
                        prompt: "",
                        tags: ["精选提示词"],
                        category: "首页展示",
                    },
                ].slice(0, 8),
            },
        }));
    };

    const updateHomeShowcaseItem = (id: string, patch: Partial<SiteShowcaseItem>) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                homeShowcaseItems: (current.site.homeShowcaseItems || []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
            },
        }));
    };

    const deleteHomeShowcaseItem = (id: string) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                homeShowcaseItems: (current.site.homeShowcaseItems || []).filter((item) => item.id !== id),
            },
        }));
    };

    const fetchModelsForChannel = async (channel: SystemModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setFetchingModelId(channel.id);
        try {
            const models = await requestAdminModels(channel);
            updateChannel(channel.id, { models });
            message.success(`${channel.name || "渠道"} 已拉取 ${models.length} 个模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setFetchingModelId("");
        }
    };

    const fetchAllModels = async () => {
        const runnable = settings.systemChannels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
        if (!runnable.length) {
            message.error("请先填写至少一个渠道的 Base URL 和 API Key");
            return;
        }
        setFetchingModelId("all");
        try {
            const entries: Array<readonly [string, string[]]> = [];
            for (const channel of runnable) {
                entries.push([channel.id, await requestAdminModels(channel)] as const);
            }
            const modelMap = new Map(entries);
            setSettings((current) => ({
                ...current,
                systemChannels: current.systemChannels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)),
            }));
            message.success("模型列表已拉取");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setFetchingModelId("");
        }
    };

    const testChannelHealth = async (channel: SystemModelChannel, kind: ChannelHealthKind) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        const model = selectChannelHealthModel(channel, settings.defaultModels, kind);
        if (!model) {
            message.error("请先为该渠道填写至少一个模型名");
            return;
        }
        const resultKey = `${channel.id}:${kind}`;
        setTestingChannelKey(resultKey);
        try {
            const response = await fetch("/api/admin/channel-health", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, model, kind }),
            });
            const payload = (await response.json()) as { result?: ChannelHealthResult; error?: string };
            if (!response.ok || !payload.result) throw new Error(payload.error || "接口测试失败");
            setChannelHealthResults((current) => ({ ...current, [resultKey]: payload.result! }));
            if (payload.result.ok) message.success(`${channel.name || "渠道"} ${healthKindLabel(kind)}测试成功`);
            else message.warning(payload.result.error || `${healthKindLabel(kind)}测试失败`);
        } catch (error) {
            const messageText = error instanceof Error ? error.message : "接口测试失败";
            setChannelHealthResults((current) => ({
                ...current,
                [resultKey]: { ok: false, kind, model, status: 0, error: messageText },
            }));
            message.error(messageText);
        } finally {
            setTestingChannelKey("");
        }
    };

    const openUserEditor = (user: PublicUser) => {
        setCreatingUser(false);
        setEditingUser(user);
        userForm.setFieldsValue({ username: user.username, displayName: user.displayName, email: user.email || "", password: "", role: user.role, status: user.status, pointsBalance: user.pointsBalance });
    };

    const openCreateUserEditor = () => {
        setEditingUser(null);
        setCreatingUser(true);
        userForm.setFieldsValue({ username: "", displayName: "", email: "", password: "", role: "user", status: "active", pointsBalance: settings.defaultPoints });
    };

    const closeUserEditor = () => {
        setEditingUser(null);
        setCreatingUser(false);
        userForm.resetFields();
    };

    const saveUserEditor = async (value: UserEditorValue) => {
        if (creatingUser) {
            const user = await createUser(value);
            if (user) closeUserEditor();
            return;
        }
        if (!editingUser) return;
        const user = await updateUser(editingUser.id, {
            displayName: value.displayName,
            email: value.email || "",
            password: value.password || undefined,
            role: value.role,
            status: value.status,
            pointsBalance: toNumberOrZero(value.pointsBalance),
        });
        if (user) closeUserEditor();
    };

    const userColumns: TableColumnsType<PublicUser> = [
        {
            title: "用户",
            dataIndex: "displayName",
            render: (_, record) => (
                <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-stone-950 dark:text-stone-100">
                        <UserRound className="size-4 text-stone-400" />
                        <span className="truncate">{record.displayName}</span>
                    </div>
                    <div className="mt-1 text-xs text-stone-500">@{record.username}</div>
                    <div className="mt-0.5 truncate text-xs text-stone-400">{record.email || "未绑定邮箱"}</div>
                </div>
            ),
        },
        {
            title: "角色",
            dataIndex: "role",
            width: 120,
            render: (role: UserRole) => <Tag color={role === "admin" ? "blue" : "default"}>{role === "admin" ? "管理员" : "普通用户"}</Tag>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 120,
            render: (status: UserStatus) => <Tag color={status === "active" ? "green" : "red"}>{status === "active" ? "可用" : "已禁用"}</Tag>,
        },
        {
            title: "积分余额",
            dataIndex: "pointsBalance",
            width: 140,
            render: (pointsBalance: number) => <Tag className="m-0">{formatCreditAmount(pointsBalance)} 积分</Tag>,
        },
        {
            title: "操作",
            width: 150,
            render: (_, record) => (
                <Space size={6}>
                    <Button size="small" icon={<SlidersHorizontal className="size-3.5" />} loading={updatingUserId === record.id} onClick={() => openUserEditor(record)}>
                        管理
                    </Button>
                    <Popconfirm title="删除该用户？" description="会同时清理该用户会话、签到、额度记录、生成日志和服务器副本。" okText="删除" cancelText="取消" onConfirm={() => void deleteUser(record.id)}>
                        <Button size="small" danger disabled={record.id === currentUser.id} loading={updatingUserId === record.id} icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const promptColumns: TableColumnsType<Prompt> = [
        {
            title: "提示词",
            dataIndex: "title",
            render: (_, record) => (
                <div className="flex min-w-0 gap-3">
                    {record.coverUrl ? (
                        <img src={record.coverUrl} alt={record.title} className="h-14 w-20 shrink-0 rounded-md border border-stone-200 object-cover dark:border-stone-800" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="h-14 w-20 shrink-0 rounded-md border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                    )}
                    <div className="min-w-0">
                        <div className="font-medium text-stone-950 dark:text-stone-100">{record.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{record.prompt}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                            {record.tags.map((tag) => (
                                <Tag key={tag} className="m-0 text-[11px]">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                    </div>
                </div>
            ),
        },
        { title: "分类", dataIndex: "category", width: 140 },
        {
            title: "操作",
            width: 90,
            render: (_, record) => (
                <Popconfirm title="删除公共提示词？" okText="删除" cancelText="取消" onConfirm={() => deletePrompt(record.id)}>
                    <Button size="small" danger loading={deletingPromptId === record.id} icon={<Trash2 className="size-3.5" />} />
                </Popconfirm>
            ),
        },
    ];
    const generationLogColumns: TableColumnsType<StoredGenerationLog> = [
        {
            title: "时间",
            dataIndex: "createdAt",
            width: 170,
            render: (value) => <span className="text-sm text-stone-700 dark:text-stone-200">{formatAdminLogTime(String(value))}</span>,
        },
        {
            title: "类型",
            dataIndex: "kind",
            width: 92,
            render: (_, record) => (
                <Tag className="m-0" color={record.kind === "video" ? "purple" : "blue"}>
                    {generationKindLabel(record.kind)}
                </Tag>
            ),
        },
        {
            title: "用户",
            width: 150,
            render: (_, record) => (
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{record.displayName || record.username}</div>
                    <div className="truncate text-xs text-stone-500 dark:text-stone-400">@{record.username || "unknown"}</div>
                </div>
            ),
        },
        {
            title: "入口",
            dataIndex: "source",
            width: 120,
            render: (value) => <span className="text-sm text-stone-600 dark:text-stone-300">{generationSourceLabel(String(value))}</span>,
        },
        {
            title: "模型",
            dataIndex: "model",
            width: 160,
            render: (value) => <span className="line-clamp-1 text-sm text-stone-600 dark:text-stone-300">{String(value || "-")}</span>,
        },
        {
            title: "耗时",
            dataIndex: "durationMs",
            width: 90,
            render: (value) => <span className="text-sm tabular-nums text-stone-700 dark:text-stone-200">{formatAdminLogDuration(Number(value) || 0)}</span>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 92,
            render: (_, record) => <span className={generationStatusClass(record.status)}>{generationStatusLabel(record.status)}</span>,
        },
        {
            title: "结果",
            width: 100,
            render: (_, record) => <GenerationLogAssetPreview log={record} settings={settings.generationAssetStorage} />,
        },
        {
            title: "提示词",
            dataIndex: "prompt",
            width: 360,
            render: (_, record) => (
                <div className="admin-generation-log-prompt-cell min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{record.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{record.prompt || record.summary}</div>
                </div>
            ),
        },
        {
            title: "操作",
            width: 176,
            fixed: "right",
            render: (_, record) => (
                <div className="admin-generation-log-actions">
                    <Button size="small" type="text" icon={<Eye className="size-3.5" />} onClick={() => setViewingGenerationLog(record)}>
                        详情
                    </Button>
                    <Popconfirm title="删除这条生成日志？" okText="删除" cancelText="取消" onConfirm={() => void deleteGenerationLogsByIds([record.id])}>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />}>
                            删除
                        </Button>
                    </Popconfirm>
                </div>
            ),
        },
    ];
    const cdkColumns: TableColumnsType<PublicCdkCode> = [
        {
            title: "CDK",
            dataIndex: "codePreview",
            width: 390,
            render: (_, code) => (
                <div className="min-w-0 space-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 max-w-full truncate font-mono text-sm font-semibold text-stone-950 dark:text-stone-100">{code.code || "CDK"}</span>
                        <Tag className="m-0" color={cdkStatusTone(code)}>
                            {cdkStatusLabel(code)}
                        </Tag>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                        <Button className="h-6 px-1.5 text-xs" size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => void copyCdkPlainCode(code)}>
                            复制
                        </Button>
                        {code.note ? <span className="min-w-0 max-w-full truncate">备注：{code.note}</span> : null}
                    </div>
                </div>
            ),
        },
        {
            title: "兑换规则",
            width: 190,
            render: (_, code) => (
                <div className="text-sm leading-6 text-stone-700 dark:text-stone-200">
                    <div>{formatCreditAmount(code.points)} 积分</div>
                    <div className="text-xs text-stone-500 dark:text-stone-400">
                        已兑 {code.redeemedCount}/{code.maxRedemptions}
                    </div>
                </div>
            ),
        },
        {
            title: "最近兑换",
            width: 260,
            render: (_, code) => {
                const latest = [...code.redemptions].sort((a, b) => Date.parse(b.redeemedAt) - Date.parse(a.redeemedAt))[0];
                if (!latest) return <span className="text-sm text-stone-500 dark:text-stone-400">暂无兑换</span>;
                return (
                    <div className="min-w-0 text-sm leading-6 text-stone-700 dark:text-stone-200">
                        <div className="truncate font-medium">
                            {latest.displayName}
                            <span className="ml-1 font-normal text-stone-500 dark:text-stone-400">@{latest.username}</span>
                        </div>
                        <div className="text-xs text-stone-500 dark:text-stone-400">{new Date(latest.redeemedAt).toLocaleString("zh-CN")}</div>
                    </div>
                );
            },
        },
        {
            title: "有效期",
            width: 190,
            render: (_, code) => (
                <div className="text-sm text-stone-700 dark:text-stone-200">
                    {code.expiresAt ? (
                        <>
                            <div>{new Date(code.expiresAt).toLocaleString("zh-CN")}</div>
                            <div className="text-xs text-stone-500 dark:text-stone-400">创建 {new Date(code.createdAt).toLocaleDateString("zh-CN")}</div>
                        </>
                    ) : (
                        <>
                            <div>长期有效</div>
                            <div className="text-xs text-stone-500 dark:text-stone-400">创建 {new Date(code.createdAt).toLocaleDateString("zh-CN")}</div>
                        </>
                    )}
                </div>
            ),
        },
        {
            title: "操作",
            width: 200,
            fixed: "right",
            render: (_, code) => (
                <Space size={6} wrap>
                    <Button size="small" type="text" icon={<Eye className="size-3.5" />} onClick={() => setViewingCdkCode(code)}>
                        明细
                    </Button>
                    <Popconfirm title="删除这个 CDK？" description="删除后用户将不能再兑换这个密钥，已有积分流水不会被删除。" okText="删除" cancelText="取消" onConfirm={() => void deleteCdkById(code.id)}>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />}>
                            删除
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];
    const activeSectionInfo = adminSections.find((section) => section.key === activeSection) || adminSections[0];

    return (
        <div className="admin-mobile-safe grid min-w-0 gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
            <AdminSectionNav activeKey={activeSection} onChange={setActiveSection} />
            <div className="min-w-0 space-y-5">
                <div className="rounded-lg border border-stone-200 bg-white px-5 py-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
                    <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-950 text-white dark:bg-white dark:text-stone-950">{activeSectionInfo.icon}</span>
                        <div className="min-w-0">
                            <div className="text-lg font-semibold leading-7 text-stone-950 dark:text-stone-100">{activeSectionInfo.label}</div>
                            <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{activeSectionInfo.description}</p>
                        </div>
                    </div>
                </div>

                {activeSection === "overview" ? (
                    <div className="space-y-5">
                        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                            <Metric label="用户总数" value={stats.total} detail={`${stats.active} 个可用账号`} icon={<UsersRound className="size-5" />} tone="slate" />
                            <Metric label="管理员" value={stats.admins} detail={`${stats.disabled} 个账号禁用`} icon={<ShieldCheck className="size-5" />} tone="blue" />
                            <Metric label="通用接口" value={settingsSummary.enabledChannels} detail={`共 ${settingsSummary.totalChannels} 个渠道`} icon={<PlugZap className="size-5" />} tone="emerald" />
                            <Metric label="公共提示词" value={promptCount} detail={`${settingsSummary.models} 个模型已录入`} icon={<KeyRound className="size-5" />} tone="amber" />
                            <Metric label="生成资源" value={assetStats ? assetStats.totalFiles : "-"} detail={assetStats ? `${formatBytes(assetStats.totalBytes)} 本地预览` : "统计加载中"} icon={<ImageIcon className="size-5" />} tone="cyan" />
                        </section>
                        <Panel>
                            <PanelHeader
                                title="数据备份"
                                description="下载或导入服务端用户数据库、公共提示词与生成日志备份，适合升级镜像、迁移服务器前留底。"
                                actions={
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <input
                                            ref={backupInputRef}
                                            type="file"
                                            accept="application/json,.json"
                                            className="hidden"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                event.currentTarget.value = "";
                                                if (file) importBackupFile(file);
                                            }}
                                        />
                                        <Button loading={backupImporting} icon={<Upload className="size-4" />} onClick={chooseBackupFile}>
                                            导入数据库
                                        </Button>
                                        <Button loading={backupLoading} icon={<Download className="size-4" />} onClick={() => void downloadBackup()}>
                                            备份用户数据库
                                        </Button>
                                    </div>
                                }
                            />
                            <div className="grid gap-3 p-4 text-sm leading-6 text-stone-500 sm:grid-cols-2 sm:p-5 dark:text-stone-400">
                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">备份包含 `.data/auth.json`，也就是账号、密码哈希、角色、额度、签到和网站设置。</div>
                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    导入会先把当前数据快照保存到 `.data/restore-backups`，再恢复备份里的 `.data/prompts.json` 与 `.data/generation-logs.json` 等内容。
                                </div>
                            </div>
                        </Panel>
                        <Panel>
                            <PanelHeader
                                title="生成资源清理"
                                description="统计后台生成日志的本地预览资源，清理不再被日志引用的图片或视频文件，减少 .data 占用。"
                                actions={
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button loading={assetStatsLoading} icon={<RefreshCw className="size-4" />} onClick={() => void loadGenerationAssetStats()}>
                                            刷新统计
                                        </Button>
                                        <Button danger disabled={!assetStats?.unreferencedFiles} loading={assetCleanupLoading} icon={<Trash2 className="size-4" />} onClick={cleanupGenerationAssets}>
                                            清理未引用资源
                                        </Button>
                                    </div>
                                }
                            />
                            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
                                <ResourceStat label="本地预览文件" value={assetStats ? `${assetStats.totalFiles} 个` : "-"} detail={assetStats ? formatBytes(assetStats.totalBytes) : "等待统计"} />
                                <ResourceStat label="日志引用中" value={assetStats ? `${assetStats.referencedFiles} 个` : "-"} detail={assetStats ? formatBytes(assetStats.referencedBytes) : "等待统计"} />
                                <ResourceStat label="未引用文件" value={assetStats ? `${assetStats.unreferencedFiles} 个` : "-"} detail={assetStats ? formatBytes(assetStats.unreferencedBytes) : "可安全清理"} />
                                <ResourceStat label="丢失引用" value={assetStats ? `${assetStats.missingReferences} 个` : "-"} detail="日志记录存在但文件不存在" />
                            </div>
                        </Panel>
                    </div>
                ) : null}

                {activeSection === "site" ? (
                    <Panel>
                        <PanelHeader
                            title="网站设置"
                            description="统一管理前台品牌、Logo、浏览器标题和搜索引擎展示信息。"
                            actions={
                                <Button type="primary" loading={settingsLoading} icon={<Save className="size-4" />} onClick={() => saveSettings({ site: settings.site }, "网站信息已保存")}>
                                    保存网站设置
                                </Button>
                            }
                        />
                        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_360px] sm:p-5">
                            <div className="space-y-5">
                                <div className="space-y-5 rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    <SectionTitle icon={<Globe2 className="size-4" />} title="基础信息" />
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <LabeledControl label="网站标题">
                                            <Input value={settings.site.title} maxLength={40} placeholder="VOZEB" onChange={(event) => updateSiteSetting("title", event.target.value)} />
                                        </LabeledControl>
                                        <LabeledControl label="Logo URL">
                                            <div className="flex gap-2">
                                                <Input value={settings.site.logoUrl} maxLength={2000} placeholder="/logo.svg 或 https://..." onChange={(event) => updateSiteSetting("logoUrl", event.target.value)} />
                                                <Button icon={<Upload className="size-4" />} onClick={() => logoInputRef.current?.click()}>
                                                    上传
                                                </Button>
                                            </div>
                                        </LabeledControl>
                                    </div>
                                    <div className="rounded-md border border-dashed border-stone-300 bg-white p-3 text-xs leading-5 text-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-400">
                                        Logo 支持站内路径、远程 URL、data:image 或本地上传。上传支持 PNG、JPG、SVG，最大 300KB；Docker 部署也可直接使用 data:image。
                                    </div>

                                    <div className="border-t border-stone-200 pt-5 dark:border-stone-800">
                                        <SectionTitle icon={<Search className="size-4" />} title="SEO 信息" />
                                        <div className="mt-4 space-y-4">
                                            <LabeledControl label="SEO 标题">
                                                <Input value={settings.site.seoTitle} maxLength={72} placeholder={settings.site.title} onChange={(event) => updateSiteSetting("seoTitle", event.target.value)} />
                                            </LabeledControl>
                                            <LabeledControl label="SEO 描述">
                                                <Input.TextArea value={settings.site.seoDescription} maxLength={180} rows={4} placeholder="用于搜索结果和社交分享摘要" onChange={(event) => updateSiteSetting("seoDescription", event.target.value)} />
                                            </LabeledControl>
                                            <LabeledControl label="SEO 关键词">
                                                <Input value={settings.site.seoKeywords} maxLength={240} placeholder="VOZEB,AI 绘图,无限画布" onChange={(event) => updateSiteSetting("seoKeywords", event.target.value)} />
                                            </LabeledControl>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <SectionTitle icon={<Sparkles className="size-4" />} title="首页提示词展示" />
                                            <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">控制首页“沉淀每一次好结果”区域。随机模式会从公共提示词库抽取，自定义模式优先展示下方内容。</div>
                                        </div>
                                        <div className="w-full sm:w-[272px] sm:shrink-0">
                                            <Segmented
                                                block
                                                size="small"
                                                className="w-full [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-w-0 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!px-2 [&_.ant-segmented-item-label]:!text-center"
                                                value={settings.site.homeShowcaseMode || "random"}
                                                onChange={(value) => updateSiteSetting("homeShowcaseMode", value as AuthSettings["site"]["homeShowcaseMode"])}
                                                options={[
                                                    { label: "随机提示词", value: "random" },
                                                    { label: "后台自定义", value: "custom" },
                                                ]}
                                            />
                                        </div>
                                    </div>

                                    {settings.site.homeShowcaseMode === "custom" ? (
                                        <div className="mt-5 space-y-3">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="text-xs text-stone-500 dark:text-stone-400">建议至少填写 4 条，封面 URL 可留空，首页会自动使用渐变占位。</div>
                                                <Button icon={<Plus className="size-4" />} disabled={(settings.site.homeShowcaseItems || []).length >= 8} onClick={addHomeShowcaseItem}>
                                                    添加展示
                                                </Button>
                                            </div>
                                            <div className="grid gap-3">
                                                {(settings.site.homeShowcaseItems || []).map((item, index) => (
                                                    <div key={item.id} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/60 md:grid-cols-[168px_minmax(0,1fr)]">
                                                        <div className="overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900">
                                                            {item.coverUrl ? (
                                                                <img src={item.coverUrl} alt="" className="aspect-[4/3] w-full object-cover" referrerPolicy="no-referrer" />
                                                            ) : (
                                                                <div className="flex aspect-[4/3] items-center justify-center bg-[linear-gradient(135deg,#f8fafc,#dff5ff_45%,#111827)] text-xs text-stone-500 dark:bg-[linear-gradient(135deg,#0f172a,#164e63_45%,#020617)] dark:text-stone-300">
                                                                    无封面
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 space-y-3">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">展示 {index + 1}</div>
                                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除首页展示" title="删除首页展示" onClick={() => deleteHomeShowcaseItem(item.id)} />
                                                            </div>
                                                            <div className="grid gap-3 md:grid-cols-2">
                                                                <Input value={item.title} maxLength={80} placeholder="展示标题" onChange={(event) => updateHomeShowcaseItem(item.id, { title: event.target.value })} />
                                                                <Input value={item.category} maxLength={40} placeholder="分类，例如 首页展示" onChange={(event) => updateHomeShowcaseItem(item.id, { category: event.target.value })} />
                                                            </div>
                                                            <Input value={item.coverUrl} maxLength={2000} placeholder="封面 URL，可留空" onChange={(event) => updateHomeShowcaseItem(item.id, { coverUrl: event.target.value })} />
                                                            <Input
                                                                value={(item.tags || []).join("，")}
                                                                maxLength={120}
                                                                placeholder="标签，用逗号分隔"
                                                                onChange={(event) =>
                                                                    updateHomeShowcaseItem(item.id, {
                                                                        tags: event.target.value
                                                                            .split(/[,，]/)
                                                                            .map((tag) => tag.trim())
                                                                            .filter(Boolean),
                                                                    })
                                                                }
                                                            />
                                                            <Input.TextArea value={item.prompt} rows={3} maxLength={3000} placeholder="提示词内容" onChange={(event) => updateHomeShowcaseItem(item.id, { prompt: event.target.value })} />
                                                        </div>
                                                    </div>
                                                ))}
                                                {!settings.site.homeShowcaseItems?.length ? (
                                                    <div className="rounded-md border border-dashed border-stone-200 px-3 py-8 text-center text-sm text-stone-500 dark:border-stone-800">暂无自定义展示，点击“添加展示”开始配置。</div>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-5 rounded-lg border border-dashed border-stone-200 bg-white px-4 py-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-950/60 dark:text-stone-300">
                                            当前使用公共提示词库随机展示。首页接近该区域时才会加载随机内容，避免拖慢首屏。
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <SectionTitle icon={<Globe2 className="size-4" />} title="首页收尾与社交媒体" />
                                        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">独立控制首页尾页展示</span>
                                    </div>
                                    <div className="mt-5 space-y-4">
                                        <LabeledControl label="版权所有">
                                            <Input value={settings.site.footerCopyright} maxLength={120} placeholder="© 2026 VOZEB. All rights reserved." onChange={(event) => updateSiteSetting("footerCopyright", event.target.value)} />
                                        </LabeledControl>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <LabeledControl label="使用条款链接">
                                                <Input value={settings.site.termsUrl} maxLength={2000} placeholder="/terms 或 https://..." onChange={(event) => updateSiteSetting("termsUrl", event.target.value)} />
                                            </LabeledControl>
                                            <LabeledControl label="隐私政策链接">
                                                <Input value={settings.site.privacyUrl} maxLength={2000} placeholder="/privacy 或 https://..." onChange={(event) => updateSiteSetting("privacyUrl", event.target.value)} />
                                            </LabeledControl>
                                        </div>
                                        <div className="grid gap-3">
                                            {siteSocialItems.map((item) => {
                                                const social = settings.site.socials[item.key];
                                                return (
                                                    <div key={item.key} className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/60">
                                                        <div className="mb-3 flex items-center justify-between gap-3">
                                                            <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                                                                <span className="flex size-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200/70 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-900/60">
                                                                    {item.icon}
                                                                </span>
                                                                {item.label}
                                                            </div>
                                                            <Switch checked={social.enabled} checkedChildren="显示" unCheckedChildren="隐藏" onChange={(enabled) => updateSiteSocialSetting(item.key, { enabled })} />
                                                        </div>
                                                        <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                                                            <Input value={social.label} maxLength={32} placeholder={item.label} onChange={(event) => updateSiteSocialSetting(item.key, { label: event.target.value })} />
                                                            <Input value={social.url} maxLength={2000} placeholder={item.placeholder} onChange={(event) => updateSiteSocialSetting(item.key, { url: event.target.value })} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
                                            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">友情链接</div>
                                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">启用后会显示在首页顶部导航和底部链接区。</div>
                                                </div>
                                                <Button icon={<Plus className="size-4" />} onClick={addFriendLink}>
                                                    添加链接
                                                </Button>
                                            </div>
                                            <div className="grid gap-3">
                                                {(settings.site.friendLinks || []).map((link) => (
                                                    <div key={link.id} className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/60">
                                                        <div className="mb-3 flex items-center justify-between gap-3">
                                                            <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{link.label || "友情链接"}</div>
                                                            <div className="flex items-center gap-2">
                                                                <Switch checked={link.enabled} checkedChildren="显示" unCheckedChildren="隐藏" onChange={(enabled) => updateFriendLink(link.id, { enabled })} />
                                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除友情链接" title="删除友情链接" onClick={() => deleteFriendLink(link.id)} />
                                                            </div>
                                                        </div>
                                                        <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                                                            <Input value={link.label} maxLength={32} placeholder="Linux.do" onChange={(event) => updateFriendLink(link.id, { label: event.target.value })} />
                                                            <Input value={link.url} maxLength={2000} placeholder="https://linux.do/" onChange={(event) => updateFriendLink(link.id, { url: event.target.value })} />
                                                        </div>
                                                    </div>
                                                ))}
                                                {!settings.site.friendLinks?.length ? <div className="rounded-md border border-dashed border-stone-200 px-3 py-6 text-center text-sm text-stone-500 dark:border-stone-800">暂无友情链接。</div> : null}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                                <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
                                    <SectionTitle icon={<ImageIcon className="size-4" />} title="前台预览" />
                                    <div className="mt-5 rounded-lg border border-stone-200 bg-white p-5 text-stone-950 shadow-sm shadow-stone-200/60 dark:border-white/10 dark:bg-stone-950 dark:text-white dark:shadow-black/20">
                                        <div className="flex items-center gap-3">
                                            <SiteLogoPreview logoUrl={settings.site.logoUrl} />
                                            <div className="min-w-0">
                                                <div className="truncate text-lg font-semibold">{settings.site.title || "VOZEB"}</div>
                                                <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">首页导航品牌</div>
                                            </div>
                                        </div>
                                        <div className="mt-6 border-t border-stone-200 pt-4 dark:border-white/10">
                                            <div className="text-base font-semibold">{settings.site.seoTitle || settings.site.title}</div>
                                            <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{settings.site.seoDescription}</p>
                                        </div>
                                    </div>
                                </div>
                                <SiteSettingStatus site={settings.site} />
                                <SiteShowcasePreview site={settings.site} onAdd={addHomeShowcaseItem} />
                            </div>
                        </div>
                    </Panel>
                ) : null}

                {activeSection === "settings" ? (
                    <Panel>
                        <PanelHeader
                            title="系统设置"
                            description="账号、额度和系统接口分区管理。"
                            actions={
                                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                                    <div className="flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-400">
                                        <Tag className="m-0">
                                            接口 {settingsSummary.enabledChannels}/{settingsSummary.totalChannels}
                                        </Tag>
                                        <Tag className="m-0">模型 {settingsSummary.models}</Tag>
                                        <Tag className="m-0">{settings.registrationEnabled ? "注册开放" : "注册关闭"}</Tag>
                                    </div>
                                    <Button
                                        className="w-full sm:w-auto"
                                        type="primary"
                                        loading={settingsLoading}
                                        icon={<Save className="size-4" />}
                                        onClick={() =>
                                            saveSettings(
                                                {
                                                    registrationEnabled: settings.registrationEnabled,
                                                    emailRegistrationEnabled: settings.emailRegistrationEnabled,
                                                    mail: settings.mail,
                                                    defaultPoints: settings.defaultPoints,
                                                    checkInRewardPoints: settings.checkInRewardPoints,
                                                    modelPointCosts: settings.modelPointCosts,
                                                    generationPointMultipliers: settings.generationPointMultipliers,
                                                    generationConcurrency: settings.generationConcurrency,
                                                    generationDefaults: settings.generationDefaults,
                                                    generationAssetStorage: settings.generationAssetStorage,
                                                    webdav: settings.webdav,
                                                },
                                                "账号、邮箱、积分、生成默认值、兜底与 WebDAV 设置已保存",
                                            )
                                        }
                                    >
                                        保存系统设置
                                    </Button>
                                </div>
                            }
                        />
                        <div className="space-y-5 p-4 sm:p-5">
                            <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
                                <div className="space-y-4 rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    <SectionTitle icon={<UserCog className="size-4" />} title="账号策略" />
                                    <div className="space-y-4">
                                        <SettingToggle
                                            title="开放注册"
                                            description="关闭后，新账号不能自助注册。"
                                            checked={settings.registrationEnabled}
                                            checkedChildren="开放"
                                            unCheckedChildren="关闭"
                                            onChange={(registrationEnabled) => setSettings((current) => ({ ...current, registrationEnabled }))}
                                        />
                                        <SettingToggle
                                            title="邮箱注册"
                                            description="开启后，注册页必须填写邮箱；邮箱唯一，不允许重复注册。"
                                            checked={settings.emailRegistrationEnabled}
                                            checkedChildren="开启"
                                            unCheckedChildren="关闭"
                                            onChange={(emailRegistrationEnabled) => setSettings((current) => ({ ...current, emailRegistrationEnabled }))}
                                        />
                                    </div>
                                    <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <SectionTitle icon={<Mail className="size-4" />} title="邮箱服务" />
                                            <Button loading={mailTestLoading} icon={<Send className="size-4" />} onClick={() => void testMailSettings()}>
                                                测试邮箱
                                            </Button>
                                        </div>
                                        <div className="mt-4 grid gap-3">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <LabeledControl label="邮箱类型">
                                                    <Input value={settings.mail.provider} placeholder="QQ 邮箱" onChange={(event) => updateMailSetting("provider", event.target.value)} />
                                                </LabeledControl>
                                                <LabeledControl label="SMTP 服务器">
                                                    <Input value={settings.mail.host} placeholder="smtp.qq.com" onChange={(event) => updateMailSetting("host", event.target.value)} />
                                                </LabeledControl>
                                            </div>
                                            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                                                <LabeledControl label="端口">
                                                    <InputNumber className="w-full" min={1} max={65535} precision={0} value={settings.mail.port} onChange={(value) => updateMailSetting("port", Number(value) || 465)} />
                                                </LabeledControl>
                                                <SettingInlineToggle title="SSL" checked={settings.mail.secure} checkedChildren="开启" unCheckedChildren="关闭" onChange={(secure) => updateMailSetting("secure", secure)} />
                                            </div>
                                            <LabeledControl label="邮箱账号">
                                                <Input value={settings.mail.username} placeholder="name@qq.com" onChange={(event) => updateMailSetting("username", event.target.value)} />
                                            </LabeledControl>
                                            <LabeledControl label="授权码 / 密码">
                                                <Input.Password value={settings.mail.password} placeholder="QQ 邮箱请填写 SMTP 授权码" onChange={(event) => updateMailSetting("password", event.target.value)} />
                                            </LabeledControl>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <LabeledControl label="发件邮箱">
                                                    <Input value={settings.mail.fromEmail} placeholder="默认使用邮箱账号" onChange={(event) => updateMailSetting("fromEmail", event.target.value)} />
                                                </LabeledControl>
                                                <LabeledControl label="发件名称">
                                                    <Input value={settings.mail.fromName} placeholder="VOZEB" onChange={(event) => updateMailSetting("fromName", event.target.value)} />
                                                </LabeledControl>
                                            </div>
                                            <LabeledControl label="测试收件邮箱">
                                                <Input value={mailTestTo} placeholder="留空则发送到发件邮箱" onChange={(event) => setMailTestTo(event.target.value)} />
                                            </LabeledControl>
                                            <div className="rounded-md border border-cyan-200/70 bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-100">
                                                QQ、网易、企业邮箱都可填写对应 SMTP；QQ 默认 `smtp.qq.com:465 SSL`，密码通常使用邮箱授权码。
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <GenerationConcurrencyPanel settings={settings} onChange={updateGenerationConcurrency} />
                                    <GenerationDefaultsPanel settings={settings} onChange={updateGenerationDefaults} />
                                    <GenerationAssetStoragePanel settings={settings} onChange={updateGenerationAssetStorage} />
                                    <WebdavSettingsPanel settings={settings} testing={webdavTesting} syncing={webdavSyncing} onChange={updateWebdavSetting} onTest={() => void testWebdavSettings()} onOpenSync={() => setWebdavSyncOpen(true)} />
                                </div>
                            </div>
                            <QuotaRuleTable
                                settings={settings}
                                customModel={customPointModel}
                                onCustomModelChange={setCustomPointModel}
                                onAddCustomModel={addCustomPointModel}
                                onDefaultPointsChange={updateDefaultPoints}
                                onCheckInRewardPointsChange={updateCheckInRewardPoints}
                                onModelPointCostChange={updateModelPointCost}
                                onModelPointCostDelete={deleteModelPointCost}
                                onGenerationPointMultiplierChange={updateGenerationPointMultiplier}
                                onGenerationPointMultiplierDelete={deleteGenerationPointMultiplier}
                            />
                            <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50/70 p-3 xl:flex-row xl:items-center xl:justify-between dark:border-stone-800 dark:bg-stone-900/40">
                                <div className="text-sm leading-6 text-stone-600 dark:text-stone-300">用户端不再显示接口配置，所有模型与上游地址统一由管理员在这里匹配。</div>
                                <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
                                    <Button icon={<RefreshCw className="size-4" />} loading={fetchingModelId === "all"} onClick={() => void fetchAllModels()}>
                                        拉取全部模型
                                    </Button>
                                    <Button icon={<Plus className="size-4" />} onClick={addChannel}>
                                        新增渠道
                                    </Button>
                                    <Button type="primary" loading={settingsLoading} icon={<Save className="size-4" />} onClick={() => saveSettings({ systemChannels: settings.systemChannels, defaultModels: settings.defaultModels }, "通用接口已保存")}>
                                        保存接口设置
                                    </Button>
                                </div>
                            </div>
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                                <div className="space-y-3">
                                    {settings.systemChannels.map((channel) => (
                                        <SystemChannelEditor
                                            key={channel.id}
                                            channel={channel}
                                            fetching={fetchingModelId === channel.id}
                                            testingKey={testingChannelKey}
                                            healthResults={channelHealthResults}
                                            onChange={(patch) => updateChannel(channel.id, patch)}
                                            onDelete={() => deleteChannel(channel.id)}
                                            onFetchModels={() => void fetchModelsForChannel(channel)}
                                            onTestHealth={(kind) => void testChannelHealth(channel, kind)}
                                        />
                                    ))}
                                    {!settings.systemChannels.length ? (
                                        <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50/70 p-8 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-400">还没有通用接口。</div>
                                    ) : null}
                                </div>
                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    <SectionTitle icon={<Database className="size-4" />} title="默认模型" />
                                    <div className="mt-4 space-y-3">
                                        {defaultModelKeys.map((item) => (
                                            <LabeledControl key={item.key} label={item.label}>
                                                <Input
                                                    value={settings.defaultModels[item.key]}
                                                    placeholder="模型名"
                                                    onChange={(event) => setSettings((current) => ({ ...current, defaultModels: { ...current.defaultModels, [item.key]: event.target.value } }))}
                                                />
                                            </LabeledControl>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Panel>
                ) : null}

                {activeSection === "cdk" ? (
                    <Panel>
                        <PanelHeader
                            title="CDK 管理"
                            description="随机生成积分兑换密钥，用户可在前端积分面板中兑换；后台可复制、导出、查看兑换明细并删除密钥。"
                            actions={
                                <Button icon={<RefreshCw className="size-4" />} loading={cdkLoading} onClick={() => void loadCdkCodes()}>
                                    刷新
                                </Button>
                            }
                        />
                        <div className="space-y-5 p-4 sm:p-5">
                            <div className="grid items-start gap-4 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]">
                                <section className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                    <SectionTitle icon={<KeyRound className="size-4" />} title="生成 CDK" />
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        <LabeledControl label="生成数量">
                                            <InputNumber className="w-full" min={1} max={100} precision={0} value={cdkForm.count} onChange={(value) => setCdkForm((current) => ({ ...current, count: clampInteger(value, 1, 100, 1) }))} />
                                        </LabeledControl>
                                        <LabeledControl label="每次兑换积分">
                                            <InputNumber className="w-full" min={0} precision={0} value={cdkForm.points} onChange={(value) => setCdkForm((current) => ({ ...current, points: toNumberOrZero(value) }))} />
                                        </LabeledControl>
                                        <LabeledControl label="每个密钥可兑换次数">
                                            <InputNumber
                                                className="w-full"
                                                min={1}
                                                max={10000}
                                                precision={0}
                                                value={cdkForm.maxRedemptions}
                                                onChange={(value) => setCdkForm((current) => ({ ...current, maxRedemptions: clampInteger(value, 1, 10000, 1) }))}
                                            />
                                        </LabeledControl>
                                        <LabeledControl label="有效天数">
                                            <InputNumber
                                                className="w-full"
                                                min={1}
                                                max={3650}
                                                precision={0}
                                                value={cdkForm.expiresInDays}
                                                placeholder="留空为永久"
                                                onChange={(value) => setCdkForm((current) => ({ ...current, expiresInDays: value === null ? null : clampInteger(value, 1, 3650, 1) }))}
                                            />
                                            <div className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">留空就是长期有效；填写数字表示从生成时间起多少天后过期。</div>
                                        </LabeledControl>
                                        <div className="sm:col-span-2">
                                            <LabeledControl label="备注">
                                                <Input value={cdkForm.note} maxLength={120} placeholder="例如：活动赠送 / 测试兑换" onChange={(event) => setCdkForm((current) => ({ ...current, note: event.target.value }))} />
                                            </LabeledControl>
                                        </div>
                                    </div>
                                    <div className="mt-5 flex justify-end">
                                        <Button className="w-full sm:w-auto" type="primary" icon={<Gift className="size-4" />} loading={cdkGenerating} onClick={() => void generateCdkCodes()}>
                                            随机生成 CDK
                                        </Button>
                                    </div>
                                </section>
                                <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <SectionTitle icon={<ShieldCheck className="size-4" />} title="本次生成结果" />
                                            <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">新生成会显示完整明文；删除后会从密钥管理移除，用户不能再兑换。</p>
                                        </div>
                                        <div className="flex shrink-0 flex-wrap gap-2">
                                            <Button size="small" disabled={!createdCdkActionCodes.length} onClick={() => void copyCreatedCdkCodes()}>
                                                {selectedCreatedCdkCodes.length ? "复制选中" : "复制全部"}
                                            </Button>
                                            <Button size="small" icon={<Download className="size-3.5" />} disabled={!createdCdkActionCodes.length} onClick={() => exportCreatedCdkCodes()}>
                                                {selectedCreatedCdkCodes.length ? "导出选中" : "导出 TXT"}
                                            </Button>
                                            <Popconfirm
                                                title={selectedCreatedCdkCodes.length ? "删除选中的 CDK？" : "删除本次生成的 CDK？"}
                                                description="删除后这些密钥不能再兑换，也不会继续显示在密钥管理里。建议先复制或导出明文。"
                                                okText="删除"
                                                cancelText="取消"
                                                onConfirm={() => void deleteCreatedCdkCodes(createdCdkActionCodes.map((code) => code.id))}
                                            >
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!createdCdkActionCodes.length}>
                                                    {selectedCreatedCdkCodes.length ? "删除选中" : "删除本次"}
                                                </Button>
                                            </Popconfirm>
                                        </div>
                                    </div>
                                    {createdCdkCodes.length ? (
                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50/80 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900/40">
                                            <Checkbox
                                                checked={allCreatedCdkSelected}
                                                indeterminate={Boolean(selectedCreatedCdkIds.length) && !allCreatedCdkSelected}
                                                onChange={(event) => setSelectedCreatedCdkIds(event.target.checked ? createdCdkCodes.map((code) => code.id) : [])}
                                            >
                                                全选当前结果
                                            </Checkbox>
                                            <span className="text-xs text-stone-500 dark:text-stone-400">
                                                已选 {selectedCreatedCdkIds.length} 个 / 共 {createdCdkCodes.length} 个；新生成会追加在顶部并自动选中
                                            </span>
                                        </div>
                                    ) : null}
                                    <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                                        {createdCdkCodes.length ? (
                                            createdCdkCodes.map((code) => (
                                                <div key={code.id} className="grid gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-800 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                                                    <Checkbox
                                                        checked={selectedCreatedCdkIds.includes(code.id)}
                                                        onChange={(event) => setSelectedCreatedCdkIds((current) => (event.target.checked ? Array.from(new Set([...current, code.id])) : current.filter((id) => id !== code.id)))}
                                                        aria-label={`选择 ${code.codePreview}`}
                                                    />
                                                    <div className="min-w-0">
                                                        <div className="break-all font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">{code.code}</div>
                                                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                                            {formatCreditAmount(code.points)} 积分 / 可兑 {code.maxRedemptions} 次{code.expiresAt ? ` / ${new Date(code.expiresAt).toLocaleDateString("zh-CN")} 过期` : " / 长期有效"}
                                                        </div>
                                                    </div>
                                                    <Space size={6}>
                                                        <Button size="small" onClick={() => void navigator.clipboard?.writeText(code.code).then(() => message.success("已复制 CDK"))}>
                                                            复制
                                                        </Button>
                                                        <Popconfirm title="删除这个 CDK？" description="删除后会从密钥管理移除，用户不能再兑换。" okText="删除" cancelText="取消" onConfirm={() => void deleteCreatedCdkCodes([code.id])}>
                                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />}>
                                                                删除
                                                            </Button>
                                                        </Popconfirm>
                                                    </Space>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="rounded-md border border-dashed border-stone-200 px-3 py-10 text-center text-sm text-stone-500 dark:border-stone-800">生成后会在这里显示明文，请及时复制。</div>
                                        )}
                                    </div>
                                </section>
                            </div>
                            <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                                <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                    <div className="min-w-0">
                                        <SectionTitle icon={<Database className="size-4" />} title="CDK 密钥管理" />
                                        <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">这里管理的是可兑换密钥本身；可搜索、复制、查看明细、勾选批量删除，已兑换流水会保留在用户积分记录中。</p>
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-400">
                                            <Tag className="m-0">总数 {cdkStats.total}</Tag>
                                            <Tag className="m-0">已兑换 {cdkStats.redeemed}</Tag>
                                            <Tag className="m-0">未兑换 {cdkStats.unused}</Tag>
                                            <Tag className="m-0">已过期 {cdkStats.expired}</Tag>
                                        </div>
                                    </div>
                                    <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[520px] xl:flex-row xl:justify-end">
                                        <Input
                                            allowClear
                                            className="w-full xl:max-w-64"
                                            prefix={<Search className="size-4 text-stone-400" />}
                                            placeholder="搜索明文、备注、兑换用户"
                                            value={cdkSearch}
                                            onChange={(event) => {
                                                setCdkSearch(event.target.value);
                                                setCdkPage(1);
                                            }}
                                        />
                                        <Select
                                            className="w-full xl:w-36"
                                            value={cdkFilter}
                                            onChange={(value) => {
                                                setCdkFilter(value);
                                                setCdkPage(1);
                                            }}
                                            options={[
                                                { value: "all", label: "全部" },
                                                { value: "redeemed", label: "已兑换" },
                                                { value: "unused", label: "未兑换" },
                                                { value: "expired", label: "已过期" },
                                            ]}
                                        />
                                        <Popconfirm title="批量删除选中 CDK？" description="删除后用户将不能再兑换这些密钥，已有积分流水不会被删除。" okText="删除" cancelText="取消" onConfirm={() => void bulkDeleteCdkCodes()}>
                                            <Button danger disabled={!selectedCdkIds.length} loading={bulkDeletingCdk} icon={<Trash2 className="size-4" />}>
                                                批量删除
                                            </Button>
                                        </Popconfirm>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                                    <div className="md:hidden">
                                        {cdkLoading ? (
                                            <div className="px-3 py-8 text-center text-sm text-stone-500 dark:text-stone-400">加载中...</div>
                                        ) : cdkCodes.length ? (
                                            <div className="divide-y divide-stone-200 dark:divide-stone-800">
                                                {cdkCodes.map((code) => {
                                                    const latest = [...code.redemptions].sort((a, b) => Date.parse(b.redeemedAt) - Date.parse(a.redeemedAt))[0];
                                                    const selected = selectedCdkIds.includes(code.id);
                                                    return (
                                                        <article key={code.id} className="space-y-3 px-3 py-4">
                                                            <div className="flex min-w-0 items-start gap-2">
                                                                <Checkbox
                                                                    className="mt-0.5 shrink-0"
                                                                    checked={selected}
                                                                    onChange={(event) => setSelectedCdkIds((current) => (event.target.checked ? Array.from(new Set([...current, code.id])) : current.filter((id) => id !== code.id)))}
                                                                    aria-label={`选择 ${code.code}`}
                                                                />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                        <span className="min-w-0 max-w-full break-all font-mono text-sm font-semibold leading-5 text-stone-950 dark:text-stone-100">{code.code || "CDK"}</span>
                                                                        <Tag className="m-0" color={cdkStatusTone(code)}>
                                                                            {cdkStatusLabel(code)}
                                                                        </Tag>
                                                                    </div>
                                                                    {code.note ? <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">备注：{code.note}</div> : null}
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2 rounded-md bg-stone-50/80 p-3 text-xs leading-5 dark:bg-stone-900/50">
                                                                <div>
                                                                    <div className="text-stone-400 dark:text-stone-500">兑换规则</div>
                                                                    <div className="mt-0.5 font-medium text-stone-800 dark:text-stone-100">
                                                                        {formatCreditAmount(code.points)} 积分 · {code.redeemedCount}/{code.maxRedemptions}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-stone-400 dark:text-stone-500">有效期</div>
                                                                    <div className="mt-0.5 font-medium text-stone-800 dark:text-stone-100">{code.expiresAt ? new Date(code.expiresAt).toLocaleDateString("zh-CN") : "长期有效"}</div>
                                                                </div>
                                                                <div className="col-span-2">
                                                                    <div className="text-stone-400 dark:text-stone-500">最近兑换</div>
                                                                    <div className="mt-0.5 truncate font-medium text-stone-800 dark:text-stone-100">{latest ? `${latest.displayName} @${latest.username}` : "暂无兑换"}</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap justify-end gap-2">
                                                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyCdkPlainCode(code)}>
                                                                    复制
                                                                </Button>
                                                                <Button size="small" type="text" icon={<Eye className="size-3.5" />} onClick={() => setViewingCdkCode(code)}>
                                                                    明细
                                                                </Button>
                                                                <Popconfirm title="删除这个 CDK？" okText="删除" cancelText="取消" onConfirm={() => void deleteCdkById(code.id)}>
                                                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />}>
                                                                        删除
                                                                    </Button>
                                                                </Popconfirm>
                                                            </div>
                                                        </article>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="px-3 py-8 text-center text-sm text-stone-500 dark:text-stone-400">暂无符合条件的 CDK</div>
                                        )}
                                    </div>
                                    <div className="hidden md:block">
                                        <Table
                                            rowKey="id"
                                            columns={cdkColumns}
                                            dataSource={cdkCodes}
                                            loading={cdkLoading}
                                            pagination={false}
                                            scroll={{ x: 1080 }}
                                            rowSelection={{
                                                selectedRowKeys: selectedCdkIds,
                                                onChange: (keys) => setSelectedCdkIds(keys.map(String)),
                                            }}
                                            locale={{ emptyText: "暂无符合条件的 CDK" }}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-3 border-t border-stone-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800">
                                        <div className="text-sm text-stone-500 dark:text-stone-400">
                                            已选 <span className="font-semibold text-stone-950 dark:text-stone-100">{selectedCdkIds.length}</span> 个，当前页 <span className="font-semibold text-stone-950 dark:text-stone-100">{cdkCodes.length}</span>{" "}
                                            条，共 <span className="font-semibold text-stone-950 dark:text-stone-100">{cdkTotal}</span> 条
                                        </div>
                                        <Pagination current={cdkPage} pageSize={CDK_PAGE_SIZE} total={cdkTotal} showSizeChanger={false} onChange={(page) => setCdkPage(page)} />
                                    </div>
                                </div>
                            </section>
                        </div>
                    </Panel>
                ) : null}

                {activeSection === "announcements" ? (
                    <Panel>
                        <PanelHeader
                            title="网站公告"
                            description="发布网站公告记录，并可设置首页弹窗或登录后弹窗提醒。"
                            actions={
                                <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                                    <Button icon={<ExternalLink className="size-4" />} href="/announcements" target="_blank">
                                        前台公告
                                    </Button>
                                    <Button icon={<RefreshCw className="size-4" />} loading={announcementsLoading} onClick={() => void loadAnnouncements()}>
                                        刷新
                                    </Button>
                                </div>
                            }
                        />
                        <div className="space-y-5 p-4 sm:p-5">
                            <section className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                <SectionTitle icon={<Megaphone className="size-4" />} title="发布公告" />
                                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
                                    <LabeledControl label="标题">
                                        <Input value={announcementDraft.title} maxLength={80} placeholder="例如：维护通知" onChange={(event) => setAnnouncementDraft((current) => ({ ...current, title: event.target.value }))} />
                                    </LabeledControl>
                                    <LabeledControl label="开始时间">
                                        <DatePicker
                                            className="w-full"
                                            classNames={{ popup: { root: "admin-date-picker-dropdown" } }}
                                            showTime
                                            allowClear
                                            value={announcementDraft.startsAt ? dayjs(announcementDraft.startsAt) : null}
                                            onChange={(value) => setAnnouncementDraft((current) => ({ ...current, startsAt: value?.toISOString() || undefined }))}
                                        />
                                    </LabeledControl>
                                    <LabeledControl label="结束时间">
                                        <DatePicker
                                            className="w-full"
                                            classNames={{ popup: { root: "admin-date-picker-dropdown" } }}
                                            showTime
                                            allowClear
                                            value={announcementDraft.endsAt ? dayjs(announcementDraft.endsAt) : null}
                                            onChange={(value) => setAnnouncementDraft((current) => ({ ...current, endsAt: value?.toISOString() || undefined }))}
                                        />
                                    </LabeledControl>
                                    <div className="lg:col-span-3">
                                        <LabeledControl label="公告内容">
                                            <Input.TextArea
                                                value={announcementDraft.content}
                                                rows={5}
                                                maxLength={3000}
                                                placeholder="写入公告正文，支持换行。"
                                                onChange={(event) => setAnnouncementDraft((current) => ({ ...current, content: event.target.value }))}
                                            />
                                        </LabeledControl>
                                    </div>
                                </div>
                                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap gap-3">
                                        <Checkbox checked={announcementDraft.enabled !== false} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, enabled: event.target.checked }))}>
                                            启用展示
                                        </Checkbox>
                                        <Checkbox checked={announcementDraft.popupHome === true} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, popupHome: event.target.checked }))}>
                                            首页弹窗
                                        </Checkbox>
                                        <Checkbox checked={announcementDraft.popupAfterLogin === true} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, popupAfterLogin: event.target.checked }))}>
                                            登录后弹窗
                                        </Checkbox>
                                    </div>
                                    <Button type="primary" loading={announcementSaving} icon={<Save className="size-4" />} onClick={() => void saveAnnouncementDraft()}>
                                        发布公告
                                    </Button>
                                </div>
                            </section>
                            <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <SectionTitle icon={<Database className="size-4" />} title="公告记录" />
                                    <Tag className="m-0 w-fit">共 {announcements.length} 条</Tag>
                                </div>
                                <div className="grid gap-3">
                                    {announcements.map((announcement) => (
                                        <div key={announcement.id} className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="text-base font-semibold text-stone-950 dark:text-stone-100">{announcement.title}</h3>
                                                        <Tag color={announcement.enabled ? "green" : "default"} className="m-0">
                                                            {announcement.enabled ? "展示中" : "已停用"}
                                                        </Tag>
                                                        {announcement.popupHome ? <Tag className="m-0">首页弹窗</Tag> : null}
                                                        {announcement.popupAfterLogin ? <Tag className="m-0">登录弹窗</Tag> : null}
                                                    </div>
                                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-600 dark:text-stone-300">{announcement.content}</p>
                                                    <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">{new Date(announcement.createdAt).toLocaleString("zh-CN")}</div>
                                                </div>
                                                <Space wrap className="shrink-0 lg:justify-end">
                                                    <Button size="small" href={`/announcements#${announcement.id}`} target="_blank" icon={<ExternalLink className="size-3.5" />}>
                                                        查看
                                                    </Button>
                                                    <Switch checked={announcement.enabled} checkedChildren="展示" unCheckedChildren="停用" onChange={(enabled) => void updateAnnouncementById(announcement, { enabled })} />
                                                    <Switch checked={announcement.popupHome} checkedChildren="首页" unCheckedChildren="首页" onChange={(popupHome) => void updateAnnouncementById(announcement, { popupHome })} />
                                                    <Switch checked={announcement.popupAfterLogin} checkedChildren="登录" unCheckedChildren="登录" onChange={(popupAfterLogin) => void updateAnnouncementById(announcement, { popupAfterLogin })} />
                                                    <Popconfirm title="删除这条公告？" okText="删除" cancelText="取消" onConfirm={() => void deleteAnnouncementById(announcement.id)}>
                                                        <Button danger icon={<Trash2 className="size-4" />}>
                                                            删除
                                                        </Button>
                                                    </Popconfirm>
                                                </Space>
                                            </div>
                                        </div>
                                    ))}
                                    {!announcements.length && !announcementsLoading ? <div className="rounded-md border border-dashed border-stone-200 px-3 py-8 text-center text-sm text-stone-500 dark:border-stone-800">暂无公告。</div> : null}
                                </div>
                            </section>
                        </div>
                    </Panel>
                ) : null}

                {activeSection === "users" ? (
                    <Panel>
                        <PanelHeader
                            title="用户管理"
                            description="调整角色、账号状态和积分余额。"
                            actions={
                                <Button icon={<Plus className="size-4" />} onClick={openCreateUserEditor}>
                                    新增用户
                                </Button>
                            }
                        />
                        <div className="border-b border-stone-200 bg-stone-50/45 p-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900/20">
                            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                                <Input
                                    allowClear
                                    className="w-full min-w-0 sm:max-w-2xl xl:max-w-3xl"
                                    prefix={<Search className="size-4 text-stone-400" />}
                                    placeholder="搜索昵称、用户名、邮箱、角色或状态"
                                    value={userSearch}
                                    onChange={(event) => setUserSearch(event.target.value)}
                                />
                                <div className="flex w-full flex-wrap items-center justify-between gap-2 xl:w-auto xl:justify-end">
                                    <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                                        已选 <strong className="mx-1 text-stone-950 dark:text-stone-100">{selectedUserIds.length}</strong>
                                        <span className="mx-1 text-stone-300 dark:text-stone-700">/</span>
                                        显示 <strong className="ml-1 text-stone-950 dark:text-stone-100">{filteredUsers.length}</strong>
                                    </span>
                                    <Popconfirm title="批量删除选中用户？" description="会逐个清理用户会话、签到和额度记录；当前账号和最后一个管理员会被系统阻止删除。" okText="删除" cancelText="取消" onConfirm={() => void bulkDeleteUsers()}>
                                        <Button danger icon={<Trash2 className="size-4" />} disabled={!selectedUserIds.length} loading={bulkDeletingUsers}>
                                            批量删除
                                        </Button>
                                    </Popconfirm>
                                </div>
                            </div>
                        </div>
                        <Table
                            rowKey="id"
                            columns={userColumns}
                            dataSource={filteredUsers}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            rowSelection={{
                                selectedRowKeys: selectedUserIds,
                                onChange: (keys) => setSelectedUserIds(keys.map(String)),
                                getCheckboxProps: (record) => ({
                                    disabled: record.id === currentUser.id,
                                    title: record.id === currentUser.id ? "不能选择当前登录账号" : undefined,
                                }),
                            }}
                            scroll={{ x: 1040 }}
                            size="middle"
                        />
                    </Panel>
                ) : null}

                {activeSection === "logs" ? (
                    <Panel>
                        <PanelHeader title="生成日志" description="查看所有用户通过画布、图片工作台和视频创作台产生的图片/视频生成记录。" />
                        <div className="space-y-4 p-4 sm:p-5">
                            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_286px] xl:items-start">
                                <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-[minmax(220px,300px)_118px_138px_118px_minmax(132px,180px)]">
                                    <Input
                                        allowClear
                                        className="col-span-2 min-w-0 sm:col-span-1"
                                        prefix={<Search className="size-4 text-stone-400" />}
                                        placeholder="搜索日志"
                                        value={generationLogSearch}
                                        onChange={(event) => {
                                            setGenerationLogSearch(event.target.value);
                                            setGenerationLogPage(1);
                                        }}
                                    />
                                    <Select
                                        allowClear
                                        className="min-w-0"
                                        placeholder="类型"
                                        value={generationLogKind || undefined}
                                        onChange={(value) => {
                                            setGenerationLogKind(value || "");
                                            setGenerationLogPage(1);
                                        }}
                                        options={[
                                            { label: "图片", value: "image" },
                                            { label: "视频", value: "video" },
                                        ]}
                                    />
                                    <Select
                                        allowClear
                                        className="min-w-0"
                                        placeholder="入口"
                                        value={generationLogSource || undefined}
                                        onChange={(value) => {
                                            setGenerationLogSource(value || "");
                                            setGenerationLogPage(1);
                                        }}
                                        options={[
                                            { label: "画布", value: "canvas" },
                                            { label: "生图工作台", value: "image-workbench" },
                                            { label: "视频创作台", value: "video-workbench" },
                                        ]}
                                    />
                                    <Select
                                        allowClear
                                        className="min-w-0"
                                        placeholder="状态"
                                        value={generationLogStatus || undefined}
                                        onChange={(value) => {
                                            setGenerationLogStatus(value || "");
                                            setGenerationLogPage(1);
                                        }}
                                        options={[
                                            { label: "成功", value: "success" },
                                            { label: "失败", value: "failed" },
                                            { label: "生成中", value: "pending" },
                                        ]}
                                    />
                                    <Select
                                        allowClear
                                        className="min-w-0"
                                        showSearch
                                        placeholder="用户"
                                        value={generationLogUserId || undefined}
                                        optionFilterProp="label"
                                        onChange={(value) => {
                                            setGenerationLogUserId(value || "");
                                            setGenerationLogPage(1);
                                        }}
                                        options={users.map((user) => ({ label: `${user.displayName} / ${user.username}`, value: user.id }))}
                                    />
                                </div>
                                <DatePicker.RangePicker
                                    className="admin-log-date-range w-full min-w-0 max-w-full"
                                    classNames={{ popup: { root: "admin-date-picker-dropdown" } }}
                                    allowClear
                                    format="YYYY-MM-DD"
                                    placeholder={["开始日期", "结束日期"]}
                                    separator="至"
                                    value={generationLogStart || generationLogEnd ? [generationLogStart ? dayjs(generationLogStart) : null, generationLogEnd ? dayjs(generationLogEnd) : null] : null}
                                    onChange={(dates) => {
                                        setGenerationLogStart(dates?.[0]?.format("YYYY-MM-DD") || "");
                                        setGenerationLogEnd(dates?.[1]?.format("YYYY-MM-DD") || "");
                                        setGenerationLogPage(1);
                                    }}
                                />
                            </div>
                            <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-3 dark:border-stone-800 dark:bg-stone-900/40 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                                    <span>共 {generationLogTotal} 条</span>
                                    <span>已选 {selectedGenerationLogs.length} 条</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                                    <Button className="w-full sm:w-auto" icon={<RefreshCw className="size-4" />} loading={generationLogsLoading} onClick={() => void loadGenerationLogs()}>
                                        刷新
                                    </Button>
                                    <Button className="w-full sm:w-auto" disabled={!generationLogs.length} onClick={() => setSelectedGenerationLogIds(generationLogs.map((log) => log.id))}>
                                        本页全选
                                    </Button>
                                    <Button className="w-full sm:w-auto" onClick={resetGenerationLogFilters}>
                                        清除筛选
                                    </Button>
                                    <Popconfirm
                                        title="删除选中的生成日志？"
                                        description="只删除后台日志和本地日志预览资源，不会删除用户账号或提示词库。"
                                        okText="删除"
                                        cancelText="取消"
                                        onConfirm={() => void deleteGenerationLogsByIds(selectedGenerationLogIds)}
                                    >
                                        <Button className="w-full sm:w-auto" danger disabled={!selectedGenerationLogIds.length} loading={bulkDeletingGenerationLogs} icon={<Trash2 className="size-4" />}>
                                            删除所选
                                        </Button>
                                    </Popconfirm>
                                </div>
                            </div>
                            <div className="space-y-3 md:hidden">
                                {generationLogs.map((log) => (
                                    <GenerationLogMobileCard
                                        key={log.id}
                                        log={log}
                                        selected={selectedGenerationLogIds.includes(log.id)}
                                        onSelectedChange={(checked) => setSelectedGenerationLogIds((ids) => (checked ? Array.from(new Set([...ids, log.id])) : ids.filter((id) => id !== log.id)))}
                                        settings={settings.generationAssetStorage}
                                        onView={() => setViewingGenerationLog(log)}
                                        onDelete={() => void deleteGenerationLogsByIds([log.id])}
                                    />
                                ))}
                                {!generationLogs.length && !generationLogsLoading ? <div className="rounded-lg border border-dashed border-stone-300 py-12 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成日志</div> : null}
                            </div>
                            <div className="hidden md:block">
                                <Table
                                    className="admin-generation-log-table"
                                    rowKey="id"
                                    columns={generationLogColumns}
                                    dataSource={generationLogs}
                                    loading={generationLogsLoading}
                                    pagination={{
                                        current: generationLogPage,
                                        pageSize: GENERATION_LOG_PAGE_SIZE,
                                        total: generationLogTotal,
                                        showSizeChanger: false,
                                        showTotal: (total, range) => `${range[0]}-${range[1]} / ${total} 条`,
                                        onChange: (page) => setGenerationLogPage(page),
                                    }}
                                    rowSelection={{
                                        selectedRowKeys: selectedGenerationLogIds,
                                        onChange: (keys) => setSelectedGenerationLogIds(keys.map(String)),
                                    }}
                                    scroll={{ x: 1500 }}
                                    size="middle"
                                    tableLayout="fixed"
                                />
                            </div>
                        </div>
                    </Panel>
                ) : null}

                {activeSection === "prompts" ? (
                    <Panel>
                        <PanelHeader title="公共提示词库" description="这里新增的提示词会出现在用户端“提示词库”；旧的外部仓库提示词已不再加载。" />
                        <div className="space-y-6 p-4 sm:p-6">
                            <section className="admin-prompt-builder rounded-xl">
                                <Form className="admin-prompt-form mx-auto max-w-5xl px-5 py-5 sm:px-8 sm:py-7" form={promptForm} layout="vertical" requiredMark={false} onFinish={createPrompt}>
                                    <div className="admin-prompt-note mb-7 rounded-lg p-4 sm:p-5">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                                            <Plus className="size-4 text-cyan-600 dark:text-cyan-300" />
                                            新增公共提示词
                                        </div>
                                        <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">建议填写远程图片封面 URL，用户端会直接显示封面，不走本地素材存储。</p>
                                    </div>
                                    <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
                                        <Form.Item label="提示词标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
                                            <Input placeholder="例如：赛博城市海报" />
                                        </Form.Item>
                                        <Form.Item label="分类" name="category">
                                            <Input placeholder="商业海报 / 人像 / 产品" />
                                        </Form.Item>
                                    </div>
                                    <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
                                        <Form.Item label="标签" name="tags">
                                            <Input placeholder="用逗号分隔，例如：霓虹, 海报, 科幻" />
                                        </Form.Item>
                                        <Form.Item label="封面 URL" name="coverUrl">
                                            <Input placeholder="https://example.com/image.png" />
                                        </Form.Item>
                                    </div>
                                    <Form.Item label="提示词内容" name="prompt" rules={[{ required: true, message: "请输入提示词内容" }]}>
                                        <Input.TextArea rows={7} placeholder="写入可直接用于生成的完整提示词，支持中英文描述。" />
                                    </Form.Item>
                                    <Form.Item label="备注 / 预览说明" name="preview">
                                        <Input.TextArea rows={3} placeholder="可补充适用场景、参数建议或出图效果。" />
                                    </Form.Item>
                                    <div className="flex justify-end">
                                        <Button className="admin-prompt-submit w-full sm:w-auto" type="primary" htmlType="submit" loading={promptSaving} icon={<Plus className="size-4" />}>
                                            插入公共提示词
                                        </Button>
                                    </div>
                                </Form>
                            </section>
                            <section className="admin-prompt-table rounded-xl">
                                <div className="admin-prompt-table-header flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
                                    <div className="min-w-0">
                                        <h3 className="text-base font-semibold text-stone-950 dark:text-stone-100">提示词列表</h3>
                                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">已收录的公共提示词会同步展示到用户端提示词库。</p>
                                    </div>
                                    <span className="shrink-0 rounded-md bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 dark:bg-white/10 dark:text-stone-300">
                                        {promptListTotal ? `${promptListStart}-${promptListEnd} / ${promptListTotal} 条` : "0 条"}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-3 border-t border-stone-200/70 px-4 py-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                    <Input
                                        className="w-full sm:max-w-md"
                                        prefix={<Search className="size-4 text-stone-400" />}
                                        allowClear
                                        placeholder="搜索标题、分类、标签或提示词内容"
                                        value={promptSearch}
                                        onChange={(event) => {
                                            setPromptSearch(event.target.value);
                                            setPromptPage(1);
                                        }}
                                    />
                                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                                        <span className="text-xs text-stone-500 dark:text-stone-400">已选 {selectedPrompts.length} 条</span>
                                        <Popconfirm title="批量删除选中提示词？" description="会从公共提示词库中移除，用户端将不再显示这些提示词。" okText="删除" cancelText="取消" onConfirm={() => void bulkDeletePrompts()}>
                                            <Button danger disabled={!selectedPrompts.length} loading={bulkDeletingPrompts} icon={<Trash2 className="size-4" />}>
                                                批量删除
                                            </Button>
                                        </Popconfirm>
                                    </div>
                                </div>
                                <div className="space-y-3 px-4 pb-4 md:hidden">
                                    {prompts.map((prompt) => (
                                        <div key={prompt.id} className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
                                            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3">
                                                <Checkbox
                                                    checked={selectedPromptIds.includes(prompt.id)}
                                                    onChange={(event) => setSelectedPromptIds((ids) => (event.target.checked ? Array.from(new Set([...ids, prompt.id])) : ids.filter((id) => id !== prompt.id)))}
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex min-w-0 gap-3">
                                                        {prompt.coverUrl ? (
                                                            <img src={prompt.coverUrl} alt={prompt.title} className="h-16 w-24 shrink-0 rounded-md border border-stone-200 object-cover dark:border-stone-800" loading="lazy" referrerPolicy="no-referrer" />
                                                        ) : (
                                                            <div className="h-16 w-24 shrink-0 rounded-md border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                                                        )}
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{prompt.title}</div>
                                                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{prompt.prompt}</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 flex min-w-0 flex-wrap gap-1">
                                                        {prompt.category ? (
                                                            <Tag className="m-0 max-w-full truncate text-[11px]" color="blue">
                                                                {prompt.category}
                                                            </Tag>
                                                        ) : null}
                                                        {prompt.tags.map((tag) => (
                                                            <Tag key={tag} className="m-0 max-w-full truncate text-[11px]">
                                                                {tag}
                                                            </Tag>
                                                        ))}
                                                    </div>
                                                    <div className="mt-3 flex justify-end">
                                                        <Popconfirm title="删除公共提示词？" okText="删除" cancelText="取消" onConfirm={() => deletePrompt(prompt.id)}>
                                                            <Button size="small" danger loading={deletingPromptId === prompt.id} icon={<Trash2 className="size-3.5" />}>
                                                                删除
                                                            </Button>
                                                        </Popconfirm>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {!prompts.length && !promptsLoading ? <div className="rounded-lg border border-dashed border-stone-300 py-12 text-center text-sm text-stone-500 dark:border-stone-700">暂无提示词</div> : null}
                                    {promptListTotal > PROMPT_PAGE_SIZE ? (
                                        <Pagination className="pt-1" current={promptPage} pageSize={PROMPT_PAGE_SIZE} total={promptListTotal} showSizeChanger={false} size="small" onChange={(page) => setPromptPage(page)} />
                                    ) : null}
                                </div>
                                <div className="hidden md:block">
                                    <Table
                                        rowKey="id"
                                        columns={promptColumns}
                                        dataSource={prompts}
                                        loading={promptsLoading}
                                        pagination={{
                                            current: promptPage,
                                            pageSize: PROMPT_PAGE_SIZE,
                                            total: promptListTotal,
                                            showSizeChanger: false,
                                            showTotal: (total, range) => `${range[0]}-${range[1]} / ${total} 条`,
                                            onChange: (page) => setPromptPage(page),
                                        }}
                                        size="middle"
                                        scroll={{ x: 760 }}
                                        rowSelection={{
                                            selectedRowKeys: selectedPromptIds,
                                            onChange: (keys) => setSelectedPromptIds(keys.map(String)),
                                        }}
                                    />
                                </div>
                            </section>
                        </div>
                    </Panel>
                ) : null}
            </div>

            <Modal
                title={creatingUser ? "新增用户" : editingUser ? `用户管理：${editingUser.displayName}` : "用户管理"}
                open={creatingUser || Boolean(editingUser)}
                okText={creatingUser ? "新增" : "保存"}
                cancelText="取消"
                confirmLoading={creatingUser ? updatingUserId === "__new__" : Boolean(editingUser && updatingUserId === editingUser.id)}
                onOk={() => userForm.submit()}
                onCancel={closeUserEditor}
            >
                <Form form={userForm} layout="vertical" requiredMark={false} onFinish={saveUserEditor}>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Form.Item label="用户名" name="username" rules={[{ required: creatingUser, message: "请输入用户名" }]}>
                            <Input disabled={!creatingUser} placeholder="用于登录的账号" />
                        </Form.Item>
                        <Form.Item label="显示昵称" name="displayName" rules={[{ required: true, message: "请输入显示昵称" }]}>
                            <Input placeholder="显示在顶部账号菜单" />
                        </Form.Item>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Form.Item label="绑定邮箱" name="email">
                            <Input placeholder="可留空" />
                        </Form.Item>
                        <Form.Item
                            label={creatingUser ? "登录密码" : "重置密码"}
                            name="password"
                            rules={[{ required: creatingUser, message: "请输入登录密码" }]}
                            extra={creatingUser ? "至少 8 位，创建后用户可自行修改。" : "留空则不修改密码；填写后该用户需要重新登录。"}
                        >
                            <Input.Password placeholder="至少 8 位" />
                        </Form.Item>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Form.Item label="角色" name="role" rules={[{ required: true, message: "请选择角色" }]}>
                            <Select
                                options={[
                                    { value: "user", label: "普通用户" },
                                    { value: "admin", label: "管理员" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item label="账号状态" name="status" rules={[{ required: true, message: "请选择状态" }]}>
                            <Select
                                disabled={editingUser?.id === currentUser.id}
                                options={[
                                    { value: "active", label: "可用" },
                                    { value: "disabled", label: "禁用" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <div className="mb-3 text-sm font-semibold text-stone-950 dark:text-stone-100">积分余额</div>
                    <Form.Item label="当前积分" name="pointsBalance" rules={[{ required: true, message: "请输入积分余额" }]}>
                        <InputNumber className="w-full" min={0} precision={2} />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal title="生成日志详情" open={Boolean(viewingGenerationLog)} footer={null} onCancel={() => setViewingGenerationLog(null)} width={860}>
                {viewingGenerationLog ? <GenerationLogDetail log={viewingGenerationLog} settings={settings.generationAssetStorage} /> : null}
            </Modal>
            <WebdavSyncModal open={webdavSyncOpen} syncing={webdavSyncing} progress={webdavSyncProgress} summary={webdavSyncSummary} onClose={() => setWebdavSyncOpen(false)} onSync={() => void startWebdavSync()} />
            <Modal title="CDK 明细" open={Boolean(viewingCdkCode)} footer={null} onCancel={() => setViewingCdkCode(null)} width={760}>
                {viewingCdkCode ? (
                    <div className="space-y-3">
                        <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/60">
                            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">兑换码</div>
                                <Button size="small" icon={<Copy className="size-3.5" />} disabled={!viewingCdkCode.code} onClick={() => void copyCdkPlainCode(viewingCdkCode)}>
                                    复制明文
                                </Button>
                            </div>
                            <div className="break-all rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
                                {viewingCdkCode.code || "CDK 明文不可用"}
                            </div>
                            {!viewingCdkCode.code ? <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">这个 CDK 没有可复制的明文。</div> : null}
                        </div>
                        <CdkRedemptionDetail code={viewingCdkCode} />
                    </div>
                ) : null}
            </Modal>
            <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(event) => {
                    uploadSiteLogo(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
        </div>
    );
}

function Panel({ children }: { children: ReactNode }) {
    return <section className="min-w-0 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">{children}</section>;
}

function GenerationLogAssetPreview({ log, settings }: { log: StoredGenerationLog; settings: AuthSettings["generationAssetStorage"] }) {
    const asset = log.assets[0];
    const assetUrl = asset ? generationLogAssetAccessUrl(asset, settings) : "";
    if (!assetUrl) {
        return (
            <div className="flex size-12 items-center justify-center rounded-lg border border-stone-200 bg-stone-100 text-stone-400 dark:border-stone-800 dark:bg-stone-900">
                {log.kind === "video" ? <Film className="size-4" /> : <ImageIcon className="size-4" />}
            </div>
        );
    }
    if (asset.type === "video") {
        return <video className="size-12 rounded-lg border border-stone-200 bg-stone-100 object-cover dark:border-stone-800 dark:bg-stone-900" src={assetUrl} muted playsInline preload="metadata" />;
    }
    return <img className="size-12 rounded-lg border border-stone-200 bg-stone-100 object-cover dark:border-stone-800 dark:bg-stone-900" src={assetUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />;
}

function GenerationLogMobileCard({
    log,
    selected,
    settings,
    onSelectedChange,
    onView,
    onDelete,
}: {
    log: StoredGenerationLog;
    selected: boolean;
    settings: AuthSettings["generationAssetStorage"];
    onSelectedChange: (checked: boolean) => void;
    onView: () => void;
    onDelete: () => void;
}) {
    return (
        <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3">
                <Checkbox checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Tag className="m-0" color={log.kind === "video" ? "purple" : "blue"}>
                            {generationKindLabel(log.kind)}
                        </Tag>
                        <span className={generationStatusClass(log.status)}>{generationStatusLabel(log.status)}</span>
                        <span className="text-xs text-stone-500">{generationSourceLabel(log.source)}</span>
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{log.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{log.prompt || log.summary}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                        <span>{formatAdminLogTime(log.createdAt)}</span>
                        <span>{log.displayName || log.username}</span>
                        <span>{formatAdminLogDuration(log.durationMs)}</span>
                    </div>
                </div>
                <GenerationLogAssetPreview log={log} settings={settings} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
                <Button size="small" icon={<Eye className="size-3.5" />} onClick={onView}>
                    详情
                </Button>
                <Popconfirm title="删除这条生成日志？" okText="删除" cancelText="取消" onConfirm={onDelete}>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />}>
                        删除
                    </Button>
                </Popconfirm>
            </div>
        </div>
    );
}

function GenerationLogDetail({ log, settings }: { log: StoredGenerationLog; settings: AuthSettings["generationAssetStorage"] }) {
    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <InfoBox label="用户" value={`${log.displayName || log.username} / ${log.username || "-"}`} />
                <InfoBox label="入口" value={generationSourceLabel(log.source)} />
                <InfoBox label="类型" value={generationKindLabel(log.kind)} />
                <InfoBox label="状态" value={generationStatusLabel(log.status)} />
                <InfoBox label="时间" value={formatAdminLogTime(log.createdAt)} />
                <InfoBox label="耗时" value={formatAdminLogDuration(log.durationMs)} />
                <InfoBox label="模型" value={log.model || "-"} />
                <InfoBox label="数量" value={`成功 ${log.successCount} / 失败 ${log.failCount} / 共 ${log.count}`} />
            </div>
            <GenerationLogResultSection log={log} settings={settings} />
            <div>
                <div className="mb-1 text-sm font-semibold text-stone-950 dark:text-stone-100">提示词</div>
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-6 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">{log.prompt || "-"}</div>
            </div>
            {log.error ? (
                <div>
                    <div className="mb-1 text-sm font-semibold text-red-600 dark:text-red-300">错误信息</div>
                    <div className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{log.error}</div>
                </div>
            ) : null}
        </div>
    );
}

function GenerationLogResultSection({ log, settings }: { log: StoredGenerationLog; settings: AuthSettings["generationAssetStorage"] }) {
    const assets = (log.assets || []).filter((asset) => Boolean(generationLogAssetAccessUrl(asset, settings)));
    if (!assets.length) {
        return (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-900/70">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                    {log.kind === "video" ? <Film className="size-4" /> : <ImageIcon className="size-4" />}
                    生成结果
                </div>
                <div className="text-sm leading-6 text-stone-500 dark:text-stone-400">
                    {log.status === "success" ? "这条日志没有记录可访问的远程结果地址或服务器副本。如果接口只返回 base64，且后台未开启保存服务器副本，刷新后后台无法还原结果图片。" : "这条日志没有成功结果，暂无可预览的图片或视频。"}
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">生成结果</div>
                <Tag className="m-0" color={log.kind === "video" ? "purple" : "blue"}>
                    {assets.length} 个结果
                </Tag>
            </div>
            <div className="space-y-3">
                {assets.map((asset, index) => {
                    const assetUrl = generationLogAssetAccessUrl(asset, settings);
                    return (
                        <div key={`${asset.url}-${index}`} className="grid min-w-0 items-start gap-3 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/60 sm:grid-cols-[156px_minmax(0,1fr)]">
                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                                    <span>{asset.type === "video" ? `视频 ${index + 1}` : `图片 ${index + 1}`}</span>
                                    {asset.width || asset.height ? <span className="shrink-0 tabular-nums">{[asset.width, asset.height].filter(Boolean).join("x")}</span> : null}
                                </div>
                                <div className="flex h-32 items-center justify-center overflow-hidden rounded-md bg-stone-100 p-2 dark:bg-stone-900 sm:h-36">
                                    {asset.type === "video" ? (
                                        <video className="h-full w-full rounded bg-black object-contain" src={assetUrl} controls playsInline preload="metadata" />
                                    ) : (
                                        <img className="h-full w-full object-contain" src={assetUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
                                    )}
                                </div>
                            </div>
                            <GenerationAssetAddressList asset={asset} assetUrl={assetUrl} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function GenerationAssetAddressList({ asset, assetUrl }: { asset: StoredGenerationLog["assets"][number]; assetUrl: string }) {
    const rows = [
        { key: "active", label: generationLogAssetAddressLabel(asset, assetUrl), url: assetUrl },
        asset.remoteUrl && asset.remoteUrl !== assetUrl ? { key: "remote", label: "远程结果地址", url: asset.remoteUrl } : null,
        asset.serverUrl && asset.serverUrl !== assetUrl ? { key: "server", label: "服务器兜底地址", url: asset.serverUrl } : null,
    ].filter((item): item is { key: string; label: string; url: string } => Boolean(item?.url));

    if (!rows.length) return null;
    return (
        <div className="min-w-0 self-start">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-stone-500 dark:text-stone-400">访问地址</div>
                <Tag className="m-0" color={asset.type === "video" ? "purple" : "blue"}>
                    {asset.type === "video" ? "视频" : "图片"}
                </Tag>
            </div>
            <div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                {rows.map((row) => {
                    const displayUrl = generationLogAssetDisplayUrl(row.url);
                    return (
                        <div key={row.key} className="grid min-w-0 gap-2 border-b border-stone-200 bg-stone-50/70 px-3 py-2 last:border-b-0 dark:border-stone-800 dark:bg-stone-900/50 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center">
                            <div className="text-xs font-medium text-stone-700 dark:text-stone-200">{row.label}</div>
                            <div className="min-w-0 truncate font-mono text-[11px] leading-5 text-stone-500 dark:text-stone-400" title={displayUrl}>
                                {displayUrl}
                            </div>
                            <Button className="justify-self-start sm:justify-self-end" size="small" href={row.url} target="_blank" icon={<ExternalLink className="size-3.5" />}>
                                打开
                            </Button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function generationLogAssetDisplayUrl(url: string) {
    const value = (url || "").trim();
    if (!value) return value;
    const decodedProxyUrl = decodeMediaProxyDisplayUrl(value);
    if (decodedProxyUrl) return decodedProxyUrl;
    try {
        return decodeURI(value);
    } catch {
        return value;
    }
}

function decodeMediaProxyDisplayUrl(value: string) {
    try {
        const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.origin;
        const parsed = new URL(value, baseUrl);
        const isMediaProxy = parsed.pathname === "/api/media-proxy" || /^\/api\/ai\/system\/[^/]+\/_media$/.test(parsed.pathname);
        const targetUrl = parsed.searchParams.get("url");
        if (!isMediaProxy || !targetUrl) return "";
        return `${parsed.pathname}?url=${targetUrl}`;
    } catch {
        return "";
    }
}

function generationLogAssetAddressLabel(asset: StoredGenerationLog["assets"][number], url: string) {
    if (asset.remoteUrl && asset.remoteUrl !== url) return "当前预览地址";
    return url.startsWith("/api/generation-log-assets/") ? "服务器兜底地址" : "远程结果地址";
}

function generationLogAssetAccessUrl(asset: StoredGenerationLog["assets"][number], settings: AuthSettings["generationAssetStorage"]) {
    const serverFallbackEnabled = asset.type === "video" ? settings.videoServerFallback : settings.imageServerFallback;
    const directUrl = asset.url && !asset.url.startsWith("/api/generation-log-assets/") ? asset.url : "";
    const serverUrl = serverFallbackEnabled ? asset.serverUrl || (asset.url?.startsWith("/api/generation-log-assets/") ? asset.url : "") : "";
    return browserReadableMediaUrl(asset.remoteUrl || directUrl || serverUrl || asset.serverUrl || (asset.url?.startsWith("/api/generation-log-assets/") ? asset.url : ""));
}

function InfoBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-1 truncate text-sm font-medium text-stone-900 dark:text-stone-100" title={value}>
                {value}
            </div>
        </div>
    );
}

function AdminSectionNav({ activeKey, onChange }: { activeKey: AdminSectionKey; onChange: (key: AdminSectionKey) => void }) {
    return (
        <aside className="admin-section-nav min-w-0 xl:sticky xl:top-20 xl:self-start">
            <div className="admin-section-nav-shell max-w-full overflow-x-auto rounded-lg border border-stone-200 bg-white p-2 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
                <div className="admin-section-nav-list flex gap-2 xl:flex-col">
                    {adminSections.map((section) => {
                        const active = section.key === activeKey;
                        return (
                            <button
                                key={section.key}
                                type="button"
                                className={`admin-section-nav-item flex min-w-36 items-center gap-3 rounded-md px-3 py-3 text-left transition xl:min-w-0 ${
                                    active
                                        ? "bg-stone-950 !text-white shadow-sm dark:bg-stone-900 dark:!text-white dark:ring-1 dark:ring-stone-700"
                                        : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-white"
                                }`}
                                onClick={() => onChange(section.key)}
                            >
                                <span className={`admin-section-nav-icon flex size-8 shrink-0 items-center justify-center rounded-md ${active ? "bg-white/15 !text-white dark:bg-stone-800" : "bg-stone-100 dark:bg-stone-900"}`}>{section.icon}</span>
                                <span className="min-w-0">
                                    <span className={`block text-sm font-semibold ${active ? "!text-white" : ""}`}>{section.label}</span>
                                    <span className={`mt-0.5 block truncate text-xs ${active ? "!text-white/75" : "text-stone-500 dark:text-stone-500"}`}>{section.shortDescription}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
}

function PanelHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
    return (
        <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between dark:border-stone-800">
            <div className="min-w-0">
                <h2 className="text-base font-semibold text-stone-950 dark:text-stone-100">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
            </div>
            {actions ? <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end lg:max-w-[58%]">{actions}</div> : null}
        </div>
    );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
    return (
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
            <span className="flex size-7 items-center justify-center rounded-md bg-white text-stone-700 ring-1 ring-stone-200 dark:bg-stone-950 dark:text-stone-200 dark:ring-stone-800">{icon}</span>
            <span>{title}</span>
        </div>
    );
}

function SettingToggle({ title, description, checked, checkedChildren, unCheckedChildren, onChange }: { title: string; description: string; checked: boolean; checkedChildren: string; unCheckedChildren: string; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <div className="text-sm font-medium text-stone-950 dark:text-stone-100">{title}</div>
                <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{description}</div>
            </div>
            <Switch className="shrink-0" checked={checked} checkedChildren={checkedChildren} unCheckedChildren={unCheckedChildren} onChange={onChange} />
        </div>
    );
}

function SettingInlineToggle({ title, checked, checkedChildren, unCheckedChildren, onChange }: { title: string; checked: boolean; checkedChildren: string; unCheckedChildren: string; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex w-full items-center justify-between gap-4 rounded-md bg-white px-4 py-2.5 ring-1 ring-stone-200 xl:w-auto dark:bg-stone-950 dark:ring-stone-800">
            <div className="text-sm font-medium text-stone-950 dark:text-stone-100">{title}</div>
            <Switch className="shrink-0" checked={checked} checkedChildren={checkedChildren} unCheckedChildren={unCheckedChildren} onChange={onChange} />
        </div>
    );
}

function GenerationConcurrencyPanel({ settings, onChange }: { settings: AuthSettings; onChange: (key: keyof AuthSettings["generationConcurrency"], value: number | null) => void }) {
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <SectionTitle icon={<Sparkles className="size-4" />} title="每用户并发上限" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <LabeledControl label="生图同时生成">
                    <InputNumber className="w-full" min={1} max={10} precision={0} value={settings.generationConcurrency.image} onChange={(value) => onChange("image", value)} />
                </LabeledControl>
                <LabeledControl label="视频同时生成">
                    <InputNumber className="w-full" min={1} max={5} precision={0} value={settings.generationConcurrency.video} onChange={(value) => onChange("video", value)} />
                </LabeledControl>
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">限制的是单个用户自己的并发任务，不是全站共享上限。</div>
        </div>
    );
}

function GenerationDefaultsPanel({ settings, onChange }: { settings: AuthSettings; onChange: (key: keyof AuthSettings["generationDefaults"], value: number | null) => void }) {
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <SectionTitle icon={<SlidersHorizontal className="size-4" />} title="生成默认值" />
            <div className="mt-4 max-w-xs">
                <LabeledControl label="画布默认生图张数">
                    <InputNumber className="w-full" min={1} max={10} precision={0} value={settings.generationDefaults.canvasImageCount} onChange={(value) => onChange("canvasImageCount", value)} />
                </LabeledControl>
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">新建画布生图节点和配置节点默认使用，单个节点仍可单独覆盖。</div>
        </div>
    );
}

function GenerationAssetStoragePanel({ settings, onChange }: { settings: AuthSettings; onChange: (key: keyof AuthSettings["generationAssetStorage"], value: boolean) => void }) {
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <SectionTitle icon={<Download className="size-4" />} title="生成结果服务器兜底" />
            <div className="mt-4 grid gap-4">
                <SettingToggle
                    title="图片服务器兜底"
                    description="本地缓存和远程结果地址不可用时，允许使用服务器保存的图片副本。"
                    checked={settings.generationAssetStorage.imageServerFallback}
                    checkedChildren="开启"
                    unCheckedChildren="关闭"
                    onChange={(checked) => onChange("imageServerFallback", checked)}
                />
                <SettingToggle
                    title="图片下载到服务器"
                    description="开启后，新生成图片会尝试保存服务器副本；关闭后优先只保留本地缓存和远程结果地址。"
                    checked={settings.generationAssetStorage.imageServerDownload}
                    checkedChildren="保存"
                    unCheckedChildren="不保存"
                    onChange={(checked) => onChange("imageServerDownload", checked)}
                />
                <SettingToggle
                    title="视频服务器兜底"
                    description="本地缓存和远程结果地址不可用时，允许使用服务器保存的视频副本。"
                    checked={settings.generationAssetStorage.videoServerFallback}
                    checkedChildren="开启"
                    unCheckedChildren="关闭"
                    onChange={(checked) => onChange("videoServerFallback", checked)}
                />
                <SettingToggle
                    title="视频下载到服务器"
                    description="开启后，新生成视频会在有远程地址时尝试保存服务器副本；大文件会自动跳过。"
                    checked={settings.generationAssetStorage.videoServerDownload}
                    checkedChildren="保存"
                    unCheckedChildren="不保存"
                    onChange={(checked) => onChange("videoServerDownload", checked)}
                />
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">用户端展示顺序为本地缓存、远程结果地址、服务器副本；后台日志没有用户本地缓存时，会按远程结果地址、服务器副本展示。</div>
        </div>
    );
}

function WebdavSettingsPanel({
    settings,
    testing,
    syncing,
    onChange,
    onTest,
    onOpenSync,
}: {
    settings: AuthSettings;
    testing: boolean;
    syncing: boolean;
    onChange: <K extends keyof AuthSettings["webdav"]>(key: K, value: AuthSettings["webdav"][K]) => void;
    onTest: () => void;
    onOpenSync: () => void;
}) {
    const webdavReady = settings.webdav.enabled && Boolean(settings.webdav.url.trim());
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="flex items-start justify-between gap-3">
                <SectionTitle icon={<Database className="size-4" />} title="WebDAV 同步" />
                <Switch checked={settings.webdav.enabled} checkedChildren="开启" unCheckedChildren="关闭" onChange={(checked) => onChange("enabled", checked)} />
            </div>
            <div className="mt-4 grid gap-3">
                <div className="rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                    <div className="text-xs font-semibold text-stone-500 dark:text-stone-400">连接方式</div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="inline-flex w-fit items-center rounded-md bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white dark:bg-white dark:text-stone-950">后台代理</div>
                        <div className="text-xs leading-5 text-stone-500 dark:text-stone-400">真实 WebDAV 地址、账号和密码只保存在后台，用户端只访问系统代理，不暴露上游信息。</div>
                    </div>
                </div>
                <div className="rounded-md border border-sky-200/70 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                    开启后，用户登录时会在浏览器空闲时自动同步本地画布、素材、工作台记录和媒体缓存，同一账号同一浏览器 6 小时内最多自动同步一次。后台按钮只同步当前浏览器的数据；服务器没有办法直接读取其他用户浏览器里的本地缓存。
                </div>
                <div className="rounded-md border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                    WebDAV 不会替代生成结果服务器副本。图片/视频是否下载到服务器，仍由上方“生成结果服务器兜底”的下载开关控制；用户端展示顺序仍是本地缓存、远程结果地址、服务器副本。
                </div>
                <LabeledControl label="WebDAV 地址">
                    <Input value={settings.webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => onChange("url", event.target.value)} />
                </LabeledControl>
                <div className="grid gap-3 sm:grid-cols-2">
                    <LabeledControl label="远程目录">
                        <Input value={settings.webdav.directory} placeholder="vozeb" onChange={(event) => onChange("directory", event.target.value)} />
                    </LabeledControl>
                    <LabeledControl label="账号">
                        <Input value={settings.webdav.username} autoComplete="username" onChange={(event) => onChange("username", event.target.value)} />
                    </LabeledControl>
                </div>
                <LabeledControl label="密码 / 应用密码">
                    <Input.Password value={settings.webdav.password} autoComplete="current-password" onChange={(event) => onChange("password", event.target.value)} />
                </LabeledControl>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-5 text-stone-500 dark:text-stone-400">WebDAV 由后台保存和代理，用户端不会看到真实地址、账号或密码。</div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <Button className="shrink-0" loading={testing} disabled={!webdavReady} icon={<PlugZap className="size-4" />} onClick={onTest}>
                            测试连接
                        </Button>
                        <Button className="shrink-0" loading={syncing} disabled={!webdavReady} icon={<RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />} onClick={onOpenSync}>
                            同步当前浏览器数据
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function WebdavSyncModal({ open, syncing, progress, summary, onClose, onSync }: { open: boolean; syncing: boolean; progress: WebdavSyncProgressLine[]; summary: string; onClose: () => void; onSync: () => void }) {
    return (
        <Modal
            title="WebDAV 数据同步"
            open={open}
            onCancel={onClose}
            footer={
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button onClick={onClose} disabled={syncing}>
                        关闭
                    </Button>
                    <Button type="primary" icon={<RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />} loading={syncing} onClick={onSync}>
                        立即同步
                    </Button>
                </div>
            }
            width={560}
            centered
            destroyOnHidden
        >
            <div className="space-y-3">
                <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900/50 dark:text-stone-300">
                    这里同步的是当前浏览器里的画布、我的素材、生成记录和本地媒体文件。WebDAV 通过后台代理访问，前端不会显示真实上游地址、账号或密码。
                </div>
                {summary ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">{summary}</div> : null}
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                    {progress.length ? (
                        progress.map((item) => (
                            <div key={item.id} className="flex min-w-0 items-start gap-2 text-sm leading-5">
                                <Tag className="m-0 shrink-0" color={item.status === "exception" ? "red" : item.status === "success" ? "green" : "blue"}>
                                    {item.status === "exception" ? "失败" : item.status === "success" ? "完成" : "同步"}
                                </Tag>
                                <span className="min-w-0 break-words text-stone-600 dark:text-stone-300">{item.text}</span>
                            </div>
                        ))
                    ) : (
                        <div className="py-6 text-center text-sm text-stone-500 dark:text-stone-400">点击“立即同步”开始。</div>
                    )}
                </div>
            </div>
        </Modal>
    );
}

function QuotaRuleTable({
    settings,
    customModel,
    onCustomModelChange,
    onAddCustomModel,
    onDefaultPointsChange,
    onCheckInRewardPointsChange,
    onModelPointCostChange,
    onModelPointCostDelete,
    onGenerationPointMultiplierChange,
    onGenerationPointMultiplierDelete,
}: {
    settings: AuthSettings;
    customModel: string;
    onCustomModelChange: (value: string) => void;
    onAddCustomModel: () => void;
    onDefaultPointsChange: (value: number | null) => void;
    onCheckInRewardPointsChange: (value: number | null) => void;
    onModelPointCostChange: (model: string, value: number | null) => void;
    onModelPointCostDelete: (model: string) => void;
    onGenerationPointMultiplierChange: (group: keyof AuthSettings["generationPointMultipliers"], key: string, value: number | null) => void;
    onGenerationPointMultiplierDelete: (group: keyof AuthSettings["generationPointMultipliers"], key: string) => void;
}) {
    const channelModels = uniqueList(settings.systemChannels.flatMap((channel) => channel.models));
    const models = uniqueList([...channelModels, ...Object.keys(settings.modelPointCosts || {}).filter((model) => model !== DEFAULT_MODEL_POINT_COST_KEY)]);
    const channelModelSet = new Set(channelModels);
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <SectionTitle icon={<Gift className="size-4" />} title="积分规则" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <LabeledControl label="新用户初始积分">
                    <InputNumber className="w-full" min={0} precision={0} value={settings.defaultPoints} onChange={(value) => onDefaultPointsChange(toNumberOrZero(value))} />
                </LabeledControl>
                <LabeledControl label="每日签到奖励积分">
                    <InputNumber className="w-full" min={0} precision={0} value={settings.checkInRewardPoints} onChange={(value) => onCheckInRewardPointsChange(toNumberOrZero(value))} />
                </LabeledControl>
            </div>
            <div className="mt-4 rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">模型消耗倍数</div>
                <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">用户生成统一使用管理员接口并扣积分；Grok 或其他未单独设置的模型会使用默认消耗。</div>
                <div className="mt-3 max-w-xs">
                    <LabeledControl label="未单独设置模型默认消耗">
                        <InputNumber className="w-full" min={0} precision={2} value={settings.modelPointCosts[DEFAULT_MODEL_POINT_COST_KEY] ?? 1} onChange={(value) => onModelPointCostChange(DEFAULT_MODEL_POINT_COST_KEY, toNumberOrOne(value))} />
                    </LabeledControl>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input value={customModel} placeholder="输入任意模型名，例如 grok-imagine-video" onChange={(event) => onCustomModelChange(event.target.value)} onPressEnter={onAddCustomModel} />
                    <Button icon={<Plus className="size-4" />} onClick={onAddCustomModel}>
                        添加模型
                    </Button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {models.length ? (
                        models.map((model) => (
                            <div key={model} className="grid min-w-0 grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-3">
                                <div className="min-w-0">
                                    <span className="block truncate text-sm text-stone-700 dark:text-stone-200" title={model}>
                                        {model}
                                    </span>
                                    {!channelModelSet.has(model) ? <span className="mt-0.5 block text-xs text-stone-400">手动添加</span> : null}
                                </div>
                                <InputNumber className="w-full" min={0} precision={2} value={settings.modelPointCosts[model] ?? 1} onChange={(value) => onModelPointCostChange(model, toNumberOrOne(value))} />
                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除消耗配置" title="删除消耗配置" onClick={() => onModelPointCostDelete(model)} />
                            </div>
                        ))
                    ) : (
                        <div className="rounded-md border border-dashed border-stone-200 px-3 py-6 text-center text-sm text-stone-500 md:col-span-2 dark:border-stone-800">添加模型名，或先在下方通用接口中拉取模型，再配置消耗倍数。</div>
                    )}
                </div>
            </div>
            <div className="mt-4 rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">生成参数倍率</div>
                <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">最终扣费 = 模型消耗 × 图片张数/视频任务 × 对应参数倍率。未命中的自定义参数按 1 倍计算。</div>
                <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(220px,0.8fr)_minmax(360px,1.4fr)]">
                    <MultiplierGroup title="图片清晰度" values={imageQualityMultiplierOptions} group="imageQuality" settings={settings.generationPointMultipliers.imageQuality} onChange={onGenerationPointMultiplierChange} />
                    <MultiplierGroup title="视频清晰度" values={videoQualityMultiplierOptions} group="videoQuality" settings={settings.generationPointMultipliers.videoQuality} onChange={onGenerationPointMultiplierChange} />
                    <VideoSecondsMultiplierGroup settings={settings.generationPointMultipliers.videoSeconds} onChange={onGenerationPointMultiplierChange} onDelete={onGenerationPointMultiplierDelete} />
                </div>
            </div>
        </div>
    );
}

function MultiplierGroup({
    title,
    values,
    group,
    settings,
    onChange,
}: {
    title: string;
    values: Array<{ key: string; label: string }>;
    group: keyof AuthSettings["generationPointMultipliers"];
    settings: Record<string, number>;
    onChange: (group: keyof AuthSettings["generationPointMultipliers"], key: string, value: number | null) => void;
}) {
    return (
        <div className="min-w-0 rounded-md border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
            <div className="mb-3 text-xs font-semibold text-stone-600 dark:text-stone-300">{title}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(104px,1fr))]">
                {values.map((item) => (
                    <div key={item.key} className="min-w-0 rounded-md border border-stone-200 bg-white px-2 py-2 dark:border-stone-800 dark:bg-stone-950/70">
                        <div className="mb-1 truncate text-xs font-medium text-stone-600 dark:text-stone-300">{item.label}</div>
                        <InputNumber className="w-full" size="small" min={0} precision={2} value={settings[item.key] ?? 1} onChange={(value) => onChange(group, item.key, toNumberOrOne(value))} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function VideoSecondsMultiplierGroup({
    settings,
    onChange,
    onDelete,
}: {
    settings: Record<string, number>;
    onChange: (group: keyof AuthSettings["generationPointMultipliers"], key: string, value: number | null) => void;
    onDelete: (group: keyof AuthSettings["generationPointMultipliers"], key: string) => void;
}) {
    const [customSeconds, setCustomSeconds] = useState<number | null>(null);
    const standardKeys = new Set(videoSecondsMultiplierOptions.map((item) => item.key));
    const customRows = Object.keys(settings || {})
        .filter((key) => !standardKeys.has(key))
        .filter((key) => !legacyDefaultVideoSecondKeys.has(key) || settings[key] !== 1)
        .filter((key) => {
            const value = Number(key);
            return Number.isFinite(value) && Number.isInteger(value) && value > 0;
        })
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => ({ key, label: `${key}s` }));
    const addCustomSeconds = () => {
        const seconds = Math.floor(Number(customSeconds));
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        onChange("videoSeconds", String(seconds), settings[String(seconds)] ?? 1);
        setCustomSeconds(null);
    };

    return (
        <div className="min-w-0 rounded-md border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
            <div className="mb-3 text-xs font-semibold text-stone-600 dark:text-stone-300">视频秒数</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(96px,1fr))]">
                {videoSecondsMultiplierOptions.map((item) => (
                    <VideoSecondMultiplierCell key={item.key} label={item.label} value={settings[item.key] ?? 1} onChange={(value) => onChange("videoSeconds", item.key, value)} />
                ))}
                {customRows.map((item) => (
                    <VideoSecondMultiplierCell key={item.key} label={item.label} value={settings[item.key] ?? 1} onChange={(value) => onChange("videoSeconds", item.key, value)} onDelete={() => onDelete("videoSeconds", item.key)} />
                ))}
                <div className="col-span-full flex flex-wrap gap-1.5">
                    {suggestedVideoSecondOptions.map((seconds) => (
                        <Button key={seconds} size="small" onClick={() => onChange("videoSeconds", String(seconds), settings[String(seconds)] ?? 1)}>
                            {seconds}s
                        </Button>
                    ))}
                </div>
                <div className="col-span-full mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <InputNumber className="w-full" min={1} max={20} precision={0} placeholder="自定义秒数" value={customSeconds} onChange={setCustomSeconds} />
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={addCustomSeconds}>
                        添加
                    </Button>
                </div>
            </div>
        </div>
    );
}

function VideoSecondMultiplierCell({ label, value, onChange, onDelete }: { label: string; value: number; onChange: (value: number | null) => void; onDelete?: () => void }) {
    return (
        <div className="relative min-w-0 rounded-md border border-stone-200 bg-white px-2 py-2 dark:border-stone-800 dark:bg-stone-950/70">
            <div className="mb-1 truncate pr-6 text-xs font-medium text-stone-600 dark:text-stone-300">{label}</div>
            {onDelete ? <Button className="!absolute right-1 top-1 !h-5 !w-5 !min-w-5 !p-0" size="small" danger icon={<Trash2 className="size-3" />} aria-label="删除自定义秒数" title="删除自定义秒数" onClick={onDelete} /> : null}
            <InputNumber className="w-full" size="small" min={0} precision={2} value={value} onChange={(nextValue) => onChange(toNumberOrOne(nextValue))} />
        </div>
    );
}

function SystemChannelEditor({
    channel,
    fetching,
    testingKey,
    healthResults,
    onChange,
    onDelete,
    onFetchModels,
    onTestHealth,
}: {
    channel: SystemModelChannel;
    fetching: boolean;
    testingKey: string;
    healthResults: Record<string, ChannelHealthResult>;
    onChange: (patch: Partial<SystemModelChannel>) => void;
    onDelete: () => void;
    onFetchModels: () => void;
    onTestHealth: (kind: ChannelHealthKind) => void;
}) {
    const healthKinds: ChannelHealthKind[] = ["text", "image", "video"];
    const visibleHealthResults = healthKinds.map((kind) => healthResults[`${channel.id}:${kind}`]).filter((item): item is ChannelHealthResult => Boolean(item));
    return (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                            <PlugZap className="size-4 text-stone-400" />
                            <span className="truncate">{channel.name || "未命名渠道"}</span>
                        </div>
                        <Tag color={channel.enabled ? "green" : "default"} className="m-0">
                            {channel.enabled ? "启用" : "停用"}
                        </Tag>
                        <Tag className="m-0">{channel.models.length} 个模型</Tag>
                    </div>
                    <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{channel.baseUrl || "未填写 Base URL"}</div>
                    <div className="mt-1 text-xs text-stone-400 dark:text-stone-500">拉取模型有 30 秒冷却；健康检测只测当前单个模型，避免连续探测。</div>
                </div>
                <Space wrap className="w-full justify-start sm:w-auto sm:justify-end">
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={fetching} onClick={onFetchModels}>
                        拉取模型
                    </Button>
                    {healthKinds.map((kind) => (
                        <Button key={kind} size="small" loading={testingKey === `${channel.id}:${kind}`} onClick={() => onTestHealth(kind)}>
                            测{healthKindLabel(kind)}
                        </Button>
                    ))}
                    <Switch checkedChildren="启用" unCheckedChildren="停用" checked={channel.enabled} onChange={(enabled) => onChange({ enabled })} />
                    <Popconfirm title="删除这个接口渠道？" okText="删除" cancelText="取消" onConfirm={onDelete}>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除渠道" title="删除渠道" />
                    </Popconfirm>
                </Space>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_minmax(220px,0.8fr)]">
                <LabeledControl label="渠道名称">
                    <Input value={channel.name} placeholder="默认渠道" onChange={(event) => onChange({ name: event.target.value })} />
                </LabeledControl>
                <LabeledControl label="Base URL">
                    <Input value={channel.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => onChange({ baseUrl: event.target.value })} />
                </LabeledControl>
                <LabeledControl label="API Key">
                    <Input.Password value={channel.apiKey} placeholder="sk-..." onChange={(event) => onChange({ apiKey: event.target.value })} />
                </LabeledControl>
                <div className="lg:col-span-3">
                    <LabeledControl label="模型列表">
                        <Select className="w-full" mode="tags" maxTagCount="responsive" value={channel.models} placeholder="输入或拉取模型名" onChange={(models) => onChange({ models })} />
                    </LabeledControl>
                </div>
            </div>
            {visibleHealthResults.length ? (
                <div className="mt-3 space-y-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                    {visibleHealthResults.map((result) => (
                        <ChannelHealthResultRow key={`${result.kind}:${result.model}`} result={result} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function ChannelHealthResultRow({ result }: { result: ChannelHealthResult }) {
    const detail = result.remoteUrl || result.taskId || result.error || "创建成功";
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <Tag color={result.ok ? "green" : "red"} className="m-0">
                {healthKindLabel(result.kind)}
                {result.ok ? "成功" : "失败"}
            </Tag>
            <span className="truncate">模型：{result.model}</span>
            <span>状态：{result.status || "-"}</span>
            <span>扣费：{typeof result.pointsCost === "number" ? formatCreditAmount(result.pointsCost) : "-"}</span>
            <span className="min-w-0 flex-1 truncate">
                {result.remoteUrl ? "远程地址：" : result.taskId ? "任务：" : result.error ? "原因：" : ""}
                {detail}
            </span>
        </div>
    );
}

function LabeledControl({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400">{label}</span>
            {children}
        </label>
    );
}

function Metric({ label, value, detail, icon, tone }: { label: string; value: number | string; detail: string; icon: ReactNode; tone: "slate" | "blue" | "emerald" | "amber" | "cyan" }) {
    const toneClass = metricToneClass[tone];
    return (
        <div className="flex min-h-28 items-center justify-between rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <div className="min-w-0">
                <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{label}</p>
                <p className="mt-2 text-3xl font-semibold leading-none text-stone-950 dark:text-stone-100">{value}</p>
                <p className="mt-2 truncate text-xs text-stone-500 dark:text-stone-400">{detail}</p>
            </div>
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-md ${toneClass}`}>{icon}</div>
        </div>
    );
}

function ResourceStat({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="text-xs font-medium text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-2 truncate text-xl font-semibold text-stone-950 dark:text-stone-100">{value}</div>
            <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{detail}</div>
        </div>
    );
}

function SiteLogoPreview({ logoUrl }: { logoUrl: string }) {
    if (logoUrl) return <img src={logoUrl} alt="" className="size-12 rounded-md bg-stone-100 object-contain p-1 dark:bg-white/10" referrerPolicy="no-referrer" />;
    return (
        <span
            className="size-12 rounded-md bg-stone-950 dark:bg-white"
            style={{
                mask: "url(/logo.svg) center / 78% no-repeat",
                WebkitMask: "url(/logo.svg) center / 78% no-repeat",
            }}
        />
    );
}

function SiteSettingStatus({ site }: { site: AuthSettings["site"] }) {
    const enabledSocialCount = siteSocialItems.filter((item) => site.socials[item.key]?.enabled && site.socials[item.key]?.url.trim()).length;
    const enabledFriendLinkCount = (site.friendLinks || []).filter((link) => link.enabled && link.label.trim() && link.url.trim()).length;
    const validShowcaseCount = (site.homeShowcaseItems || []).filter((item) => item.title.trim() && item.prompt.trim()).length;
    const isCustom = site.homeShowcaseMode === "custom";
    const seoReady = Boolean((site.seoTitle || site.title).trim() && site.seoDescription.trim());

    return (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <SectionTitle icon={<RefreshCw className="size-4" />} title="同步状态" />
            <div className="mt-4 grid grid-cols-2 gap-2">
                <SiteStatusChip label="Logo" value={site.logoUrl.trim() ? "已设置" : "默认"} active={Boolean(site.logoUrl.trim())} />
                <SiteStatusChip label="SEO" value={seoReady ? "完整" : "待补充"} active={seoReady} />
                <SiteStatusChip label="社交媒体" value={`${enabledSocialCount} 项`} active={enabledSocialCount > 0} />
                <SiteStatusChip label="友情链接" value={`${enabledFriendLinkCount} 条`} active={enabledFriendLinkCount > 0} />
            </div>
            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-stone-950 dark:text-stone-100">首页提示词</span>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-700 ring-1 ring-stone-200 dark:bg-stone-950 dark:text-stone-200 dark:ring-stone-800">
                        {isCustom ? `自定义 ${validShowcaseCount}/8` : "随机提示词库"}
                    </span>
                </div>
                <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">保存后会同步到首页导航、浏览器标题、Open Graph、favicon 和首页展示区域。</div>
            </div>
        </div>
    );
}

function SiteStatusChip({ label, value, active }: { label: string; value: string; active: boolean }) {
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/50">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className={`mt-1 truncate text-sm font-semibold ${active ? "text-stone-950 dark:text-stone-100" : "text-stone-500 dark:text-stone-400"}`}>{value}</div>
        </div>
    );
}

function SiteShowcasePreview({ site, onAdd }: { site: AuthSettings["site"]; onAdd: () => void }) {
    const items = site.homeShowcaseItems || [];
    const customItems = items.filter((item) => item.title.trim() && item.prompt.trim()).slice(0, 3);
    const isCustom = site.homeShowcaseMode === "custom";

    return (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <SectionTitle icon={<Sparkles className="size-4" />} title="首页展示预览" />
                    <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{isCustom ? `后台自定义：${items.length}/8 条` : "随机展示公共提示词库内容"}</div>
                </div>
                <Tag className="m-0" color={isCustom ? "geekblue" : "green"}>
                    {isCustom ? "自定义" : "随机"}
                </Tag>
            </div>

            {isCustom ? (
                customItems.length ? (
                    <div className="mt-4 space-y-2">
                        {customItems.map((item) => (
                            <div key={item.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-lg border border-stone-200 bg-stone-50/70 p-2 dark:border-stone-800 dark:bg-stone-900/60">
                                {item.coverUrl ? (
                                    <img src={item.coverUrl} alt="" className="aspect-square rounded-md object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                    <div className="aspect-square rounded-md bg-[linear-gradient(135deg,#f8fafc,#dff5ff_45%,#111827)] dark:bg-[linear-gradient(135deg,#0f172a,#164e63_45%,#020617)]" />
                                )}
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</div>
                                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{item.prompt}</div>
                                </div>
                            </div>
                        ))}
                        {items.length > customItems.length ? <div className="text-center text-xs text-stone-500 dark:text-stone-400">还有 {items.length - customItems.length} 条会在首页继续展示</div> : null}
                    </div>
                ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-stone-200 bg-stone-50/70 px-3 py-6 text-center dark:border-stone-800 dark:bg-stone-900/50">
                        <div className="text-sm font-medium text-stone-700 dark:text-stone-200">还没有可展示内容</div>
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">填写标题和提示词后会出现在首页。</div>
                        <Button className="mt-3" size="small" icon={<Plus className="size-3.5" />} onClick={onAdd}>
                            添加展示
                        </Button>
                    </div>
                )
            ) : (
                <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                                <div className="h-16 bg-[linear-gradient(145deg,#f8fafc,#e0f2fe_48%,#0f172a)] dark:bg-[linear-gradient(145deg,#0f172a,#164e63_48%,#020617)]" />
                                <div className="space-y-1 p-2">
                                    <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700" />
                                    <div className="h-1.5 w-2/3 rounded-full bg-stone-100 dark:bg-stone-800" />
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                        <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">从公共提示词库随机抽取</div>
                        <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">首页接近展示区时才加载，既能换内容，也不会拖慢首屏。</div>
                    </div>
                </div>
            )}

            <div className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">首页展示区会懒加载，保持首屏打开速度。</div>
        </div>
    );
}

function createSystemChannel(): SystemModelChannel {
    return { id: nanoid(), name: "默认渠道", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: true };
}

async function requestAdminModels(channel: SystemModelChannel) {
    const response = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: channel.baseUrl, apiKey: channel.apiKey }),
    });
    const payload = (await response.json()) as { models?: string[]; error?: string };
    if (!response.ok || !payload.models) throw new Error(payload.error || "拉取模型失败");
    return payload.models;
}

function selectChannelHealthModel(channel: SystemModelChannel, defaults: AuthSettings["defaultModels"], kind: ChannelHealthKind) {
    const defaultValue = kind === "image" ? defaults.imageModel : kind === "video" ? defaults.videoModel : defaults.textModel;
    const normalizedDefault = modelNameFromOption(defaultValue || "");
    if (normalizedDefault && (!channel.models.length || channel.models.includes(normalizedDefault))) return normalizedDefault;
    const matcher = kind === "image" ? /image|img|gpt-image|dall|flux|sd|midjourney/i : kind === "video" ? /video|vid|i2v|t2v|seedance|kling|sora|veo|grok-imagine/i : /gpt|chat|claude|deepseek|qwen|grok|text/i;
    return channel.models.find((model) => matcher.test(model)) || channel.models[0] || normalizedDefault;
}

function modelNameFromOption(value: string) {
    const normalized = value.trim();
    if (!normalized) return "";
    const parts = normalized.split("::");
    return parts[parts.length - 1] || normalized;
}

function healthKindLabel(kind: ChannelHealthKind) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : "文本";
}

function isCdkExpired(code: PublicCdkCode) {
    return Boolean(code.expiresAt && Date.parse(code.expiresAt) <= Date.now());
}

function cdkStatusLabel(code: PublicCdkCode) {
    if (!code.code) return "明文缺失";
    if (isCdkExpired(code)) return "已过期";
    if (code.status !== "active") return "不可用";
    if (code.redeemedCount >= code.maxRedemptions) return "已兑完";
    return code.redeemedCount > 0 ? "部分兑换" : "未兑换";
}

function cdkStatusTone(code: PublicCdkCode) {
    if (!code.code || isCdkExpired(code) || code.status !== "active") return "default";
    if (code.redeemedCount >= code.maxRedemptions) return "green";
    return code.redeemedCount > 0 ? "blue" : "gold";
}

function formatCreatedCdkExport(codes: CreatedCdkCode[]) {
    const lines = [
        "VOZEB CDK 导出",
        `导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        `数量：${codes.length}`,
        "",
        ...codes.map((code, index) =>
            [
                `${index + 1}. ${code.code}`,
                `积分：${formatCreditAmount(code.points)}`,
                `可兑换次数：${code.maxRedemptions}`,
                `有效期：${code.expiresAt ? new Date(code.expiresAt).toLocaleString("zh-CN", { hour12: false }) : "长期有效"}`,
                code.note ? `备注：${code.note}` : "",
            ]
                .filter(Boolean)
                .join(" | "),
        ),
        "",
        "说明：仅导出本次生成且可复制的明文 CDK。",
    ];
    return lines.join("\n");
}

function downloadTextFile(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function CdkRedemptionDetail({ code }: { code: PublicCdkCode }) {
    const redemptions = [...code.redemptions].sort((a, b) => Date.parse(b.redeemedAt) - Date.parse(a.redeemedAt));
    const visibleRedemptions = redemptions.slice(0, 20);

    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/60">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">兑换明细</div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                    共 {redemptions.length} 条{redemptions.length > visibleRedemptions.length ? "，展示最近 20 条" : ""}
                </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {visibleRedemptions.map((item) => (
                    <div key={`${item.userId}-${item.redeemedAt}`} className="min-w-0 rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
                        <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                            {item.displayName}
                            <span className="ml-1 font-normal text-stone-500 dark:text-stone-400">@{item.username}</span>
                        </div>
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{new Date(item.redeemedAt).toLocaleString("zh-CN")}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function splitTags(value?: string) {
    return (value || "")
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function uniqueList(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function toNumberOrZero(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Number(numberValue.toFixed(2)) : 0;
}

function toNumberOrOne(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Number(numberValue.toFixed(2)) : 1;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
    const numberValue = Math.floor(Number(value));
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(min, Math.min(max, numberValue));
}

function formatAdminLogTime(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "-";
    return date.toLocaleString("zh-CN", { hour12: false });
}

function formatAdminLogDuration(value: number) {
    if (!value) return "-";
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(2)}s`;
}

function formatBytes(value: number) {
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB"] as const;
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function generationKindLabel(value: string) {
    return value === "video" ? "视频" : "图片";
}

function generationSourceLabel(value: string) {
    if (value === "canvas") return "画布";
    if (value === "video-workbench") return "视频创作台";
    if (value === "image-workbench") return "生图工作台";
    return "未知入口";
}

function generationStatusLabel(value: string) {
    if (value === "success") return "成功";
    if (value === "failed") return "失败";
    if (value === "pending") return "生成中";
    return value || "-";
}

function generationStatusClass(value: string) {
    if (value === "success") return "inline-flex h-6 items-center rounded-md bg-emerald-50 px-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/25";
    if (value === "failed") return "inline-flex h-6 items-center rounded-md bg-rose-50 px-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/25";
    return "inline-flex h-6 items-center rounded-md bg-sky-50 px-2 text-xs font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/25";
}

const defaultModelKeys = [
    { key: "imageModel", label: "生图" },
    { key: "videoModel", label: "视频" },
    { key: "textModel", label: "文本" },
    { key: "audioModel", label: "音频" },
] as const;

const adminSections: Array<{ key: AdminSectionKey; label: string; description: string; shortDescription: string; icon: ReactNode }> = [
    { key: "overview", label: "概览", description: "快速查看用户、接口、模型和公共提示词状态。", shortDescription: "关键数据", icon: <Database className="size-4" /> },
    { key: "site", label: "网站设置", description: "管理前台网站标题、Logo、SEO 标题、描述和关键词。", shortDescription: "品牌与 SEO", icon: <Globe2 className="size-4" /> },
    { key: "settings", label: "系统设置", description: "管理注册策略、签到积分、通用接口和默认模型。", shortDescription: "账号与接口", icon: <SlidersHorizontal className="size-4" /> },
    { key: "cdk", label: "CDK 管理", description: "生成和管理用户积分兑换密钥。", shortDescription: "积分兑换", icon: <Gift className="size-4" /> },
    { key: "announcements", label: "网站公告", description: "发布公告记录，并设置首页或登录后弹窗提醒。", shortDescription: "通知弹窗", icon: <Megaphone className="size-4" /> },
    { key: "users", label: "用户管理", description: "调整用户角色、账号状态和积分余额。", shortDescription: "角色积分", icon: <UsersRound className="size-4" /> },
    { key: "logs", label: "生成日志", description: "查看用户生成的图片、视频、提示词、入口来源和调用状态。", shortDescription: "创作记录", icon: <Film className="size-4" /> },
    { key: "prompts", label: "提示词库", description: "维护会出现在用户端提示词库里的公共提示词。", shortDescription: "公共内容", icon: <KeyRound className="size-4" /> },
];

const metricToneClass = {
    slate: "bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300",
};
