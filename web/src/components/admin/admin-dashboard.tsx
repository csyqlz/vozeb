"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { Database, Download, Gift, Globe2, Image as ImageIcon, KeyRound, Mail, PlugZap, Plus, RefreshCw, Save, Search, Send, ShieldCheck, SlidersHorizontal, Trash2, Upload, UserCog, UserRound, UsersRound } from "lucide-react";
import { nanoid } from "nanoid";

import { DEFAULT_MODEL_POINT_COST_KEY } from "@/constant/credits";
import type { AuthSettings, PublicUser, SiteFriendLink, SiteSocialKey, SystemModelChannel, UserRole, UserStatus } from "@/lib/auth/store";
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

type AdminSectionKey = "overview" | "site" | "settings" | "users" | "prompts";

const siteSocialItems: Array<{ key: SiteSocialKey; label: string; placeholder: string; icon: ReactNode }> = [
    { key: "email", label: "邮箱联系", placeholder: "mailto:contact@example.com", icon: <Mail className="size-4" /> },
    { key: "telegram", label: "Telegram", placeholder: "https://t.me/vozeb", icon: <Send className="size-4" /> },
    { key: "x", label: "X", placeholder: "https://x.com/vozeb", icon: <span className="text-xs font-bold">X</span> },
    { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/vozeb", icon: <span className="text-[11px] font-bold">IG</span> },
];

export function AdminDashboard({ initialUsers, initialSettings, initialPromptCount, currentUser }: AdminDashboardProps) {
    const { message } = App.useApp();
    const [promptForm] = Form.useForm<PromptFormValue>();
    const [userForm] = Form.useForm<UserEditorValue>();
    const logoInputRef = useRef<HTMLInputElement>(null);
    const [users, setUsers] = useState(initialUsers);
    const [settings, setSettings] = useState(initialSettings);
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [promptCount, setPromptCount] = useState(initialPromptCount);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [backupLoading, setBackupLoading] = useState(false);
    const [mailTestLoading, setMailTestLoading] = useState(false);
    const [mailTestTo, setMailTestTo] = useState("");
    const [fetchingModelId, setFetchingModelId] = useState("");
    const [promptSaving, setPromptSaving] = useState(false);
    const [promptsLoading, setPromptsLoading] = useState(false);
    const [promptsLoaded, setPromptsLoaded] = useState(false);
    const [deletingPromptId, setDeletingPromptId] = useState("");
    const [promptSearch, setPromptSearch] = useState("");
    const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
    const [bulkDeletingPrompts, setBulkDeletingPrompts] = useState(false);
    const [userSearch, setUserSearch] = useState("");
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkDeletingUsers, setBulkDeletingUsers] = useState(false);
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
    const filteredPrompts = useMemo(() => {
        const keyword = promptSearch.trim().toLowerCase();
        if (!keyword) return prompts;
        return prompts.filter((prompt) => [prompt.title, prompt.prompt, prompt.category, prompt.coverUrl || "", prompt.preview || "", ...prompt.tags].some((value) => value.toLowerCase().includes(keyword)));
    }, [promptSearch, prompts]);
    const selectedPrompts = useMemo(() => prompts.filter((prompt) => selectedPromptIds.includes(prompt.id)), [prompts, selectedPromptIds]);

    useEffect(() => {
        if (activeSection === "prompts" && !promptsLoaded && !promptsLoading) void loadPrompts();
    }, [activeSection, promptsLoaded, promptsLoading]);

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
            setPrompts((items) => [payload.prompt!, ...items]);
            setPromptCount((count) => count + 1);
            promptForm.resetFields();
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
            setPrompts((items) => items.filter((item) => item.id !== id));
            setSelectedPromptIds((ids) => ids.filter((item) => item !== id));
            setPromptCount((count) => Math.max(0, count - 1));
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
            setPrompts((items) => items.filter((item) => !ids.includes(item.id)));
            setSelectedPromptIds([]);
            setPromptCount((count) => Math.max(0, count - ids.length));
            message.success(`已删除 ${ids.length} 条公共提示词`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量删除提示词失败");
        } finally {
            setBulkDeletingPrompts(false);
        }
    };

    const loadPrompts = async () => {
        setPromptsLoading(true);
        try {
            const response = await fetch("/api/admin/prompts");
            const payload = (await response.json()) as { prompts?: Prompt[]; error?: string };
            if (!response.ok || !payload.prompts) throw new Error(payload.error || "加载提示词失败");
            setPrompts(payload.prompts);
            setPromptCount(payload.prompts.length);
            setPromptsLoaded(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载提示词失败");
        } finally {
            setPromptsLoading(false);
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

    const updateModelPointCost = (model: string, value: number | null) => {
        setSettings((current) => ({ ...current, modelPointCosts: { ...current.modelPointCosts, [model]: toNumberOrOne(value) } }));
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

    const updateSiteSetting = (key: keyof Omit<AuthSettings["site"], "socials">, value: string) => {
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
            const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await requestAdminModels(channel)] as const));
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
            render: (pointsBalance: number) => <Tag className="m-0">{Number(pointsBalance || 0).toLocaleString()} 积分</Tag>,
        },
        {
            title: "操作",
            width: 150,
            render: (_, record) => (
                <Space size={6}>
                    <Button size="small" icon={<SlidersHorizontal className="size-3.5" />} loading={updatingUserId === record.id} onClick={() => openUserEditor(record)}>
                        管理
                    </Button>
                    <Popconfirm title="删除该用户？" description="会同时清理该用户会话、签到和额度记录。" okText="删除" cancelText="取消" onConfirm={() => void deleteUser(record.id)}>
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
    const activeSectionInfo = adminSections.find((section) => section.key === activeSection) || adminSections[0];

    return (
        <div className="admin-mobile-safe grid min-w-0 gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
            <AdminSectionNav activeKey={activeSection} onChange={setActiveSection} />
            <div className="min-w-0 space-y-5">
                <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                        {activeSectionInfo.icon}
                        <span>{activeSectionInfo.label}</span>
                    </div>
                    <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">{activeSectionInfo.description}</p>
                </div>

                {activeSection === "overview" ? (
                    <div className="space-y-5">
                        <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                            <Metric label="用户总数" value={stats.total} detail={`${stats.active} 个可用账号`} icon={<UsersRound className="size-5" />} tone="slate" />
                            <Metric label="管理员" value={stats.admins} detail={`${stats.disabled} 个账号禁用`} icon={<ShieldCheck className="size-5" />} tone="blue" />
                            <Metric label="通用接口" value={settingsSummary.enabledChannels} detail={`共 ${settingsSummary.totalChannels} 个渠道`} icon={<PlugZap className="size-5" />} tone="emerald" />
                            <Metric label="公共提示词" value={promptCount} detail={`${settingsSummary.models} 个模型已录入`} icon={<KeyRound className="size-5" />} tone="amber" />
                        </section>
                        <Panel>
                            <PanelHeader
                                title="数据备份"
                                description="下载服务端用户数据库与公共提示词备份，适合升级镜像、迁移服务器前留底。"
                                actions={
                                    <Button loading={backupLoading} icon={<Download className="size-4" />} onClick={() => void downloadBackup()}>
                                        备份用户数据库
                                    </Button>
                                }
                            />
                            <div className="grid gap-3 p-4 text-sm leading-6 text-stone-500 sm:grid-cols-2 sm:p-5 dark:text-stone-400">
                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">备份包含 `.data/auth.json`，也就是账号、密码哈希、角色、额度、签到和网站设置。</div>
                                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">备份同时包含 `.data/prompts.json`，用于保留管理员公共提示词库。</div>
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

                            <div className="space-y-4">
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
                                <div className="rounded-lg border border-cyan-200/60 bg-cyan-50 p-4 text-sm leading-6 text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-100">
                                    保存后首页、顶部导航、浏览器标题、Open Graph 和 favicon 会同步读取这里的配置。
                                </div>
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
                                <div className="flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-400">
                                    <Tag className="m-0">
                                        接口 {settingsSummary.enabledChannels}/{settingsSummary.totalChannels}
                                    </Tag>
                                    <Tag className="m-0">模型 {settingsSummary.models}</Tag>
                                    <Tag className="m-0">{settings.registrationEnabled ? "注册开放" : "注册关闭"}</Tag>
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
                                <QuotaRuleTable
                                    settings={settings}
                                    customModel={customPointModel}
                                    onCustomModelChange={setCustomPointModel}
                                    onAddCustomModel={addCustomPointModel}
                                    onDefaultPointsChange={updateDefaultPoints}
                                    onCheckInRewardPointsChange={updateCheckInRewardPoints}
                                    onModelPointCostChange={updateModelPointCost}
                                    onModelPointCostDelete={deleteModelPointCost}
                                />
                            </div>
                            <div className="flex justify-stretch border-b border-stone-200 pb-5 sm:justify-end dark:border-stone-800">
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
                                            },
                                            "账号、邮箱与积分设置已保存",
                                        )
                                    }
                                >
                                    保存账号、邮箱与积分
                                </Button>
                            </div>

                            <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50/70 p-3 xl:flex-row xl:items-center xl:justify-between dark:border-stone-800 dark:bg-stone-900/40">
                                <SettingInlineToggle
                                    title="允许用户自配接口"
                                    checked={settings.allowUserApiConfig}
                                    checkedChildren="允许"
                                    unCheckedChildren="禁止"
                                    onChange={(allowUserApiConfig) => setSettings((current) => ({ ...current, allowUserApiConfig }))}
                                />
                                <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
                                    <Button icon={<RefreshCw className="size-4" />} loading={fetchingModelId === "all"} onClick={() => void fetchAllModels()}>
                                        拉取全部模型
                                    </Button>
                                    <Button icon={<Plus className="size-4" />} onClick={addChannel}>
                                        新增渠道
                                    </Button>
                                    <Button
                                        type="primary"
                                        loading={settingsLoading}
                                        icon={<Save className="size-4" />}
                                        onClick={() => saveSettings({ systemChannels: settings.systemChannels, defaultModels: settings.defaultModels, allowUserApiConfig: settings.allowUserApiConfig }, "通用接口已保存")}
                                    >
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
                                            onChange={(patch) => updateChannel(channel.id, patch)}
                                            onDelete={() => deleteChannel(channel.id)}
                                            onFetchModels={() => void fetchModelsForChannel(channel)}
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
                        <div className="flex flex-col gap-3 border-b border-stone-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-stone-800">
                            <Input
                                allowClear
                                className="w-full sm:max-w-xl"
                                prefix={<Search className="size-4 text-stone-400" />}
                                placeholder="搜索昵称、用户名、邮箱、角色或状态"
                                value={userSearch}
                                onChange={(event) => setUserSearch(event.target.value)}
                            />
                            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
                                <span className="text-sm text-stone-500 dark:text-stone-400">
                                    已选 {selectedUserIds.length} / 显示 {filteredUsers.length}
                                </span>
                                <Popconfirm title="批量删除选中用户？" description="会逐个清理用户会话、签到和额度记录；当前账号和最后一个管理员会被系统阻止删除。" okText="删除" cancelText="取消" onConfirm={() => void bulkDeleteUsers()}>
                                    <Button danger icon={<Trash2 className="size-4" />} disabled={!selectedUserIds.length} loading={bulkDeletingUsers}>
                                        批量删除
                                    </Button>
                                </Popconfirm>
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
                                        {filteredPrompts.length === promptCount ? `${promptCount} 条` : `${filteredPrompts.length} / ${promptCount} 条`}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-3 border-t border-stone-200/70 px-4 py-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                    <Input
                                        className="w-full sm:max-w-md"
                                        prefix={<Search className="size-4 text-stone-400" />}
                                        allowClear
                                        placeholder="搜索标题、分类、标签或提示词内容"
                                        value={promptSearch}
                                        onChange={(event) => setPromptSearch(event.target.value)}
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
                                <Table
                                    rowKey="id"
                                    columns={promptColumns}
                                    dataSource={filteredPrompts}
                                    loading={promptsLoading}
                                    pagination={{ pageSize: 6, hideOnSinglePage: true }}
                                    size="middle"
                                    scroll={{ x: 760 }}
                                    rowSelection={{
                                        selectedRowKeys: selectedPromptIds,
                                        onChange: (keys) => setSelectedPromptIds(keys.map(String)),
                                    }}
                                />
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
                        <Form.Item label={creatingUser ? "登录密码" : "重置密码"} name="password" rules={[{ required: creatingUser, message: "请输入登录密码" }]} extra={creatingUser ? "至少 8 位，创建后用户可自行修改。" : "留空则不修改密码；填写后该用户需要重新登录。"}>
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
                        <InputNumber className="w-full" min={0} precision={0} />
                    </Form.Item>
                </Form>
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

function QuotaRuleTable({
    settings,
    customModel,
    onCustomModelChange,
    onAddCustomModel,
    onDefaultPointsChange,
    onCheckInRewardPointsChange,
    onModelPointCostChange,
    onModelPointCostDelete,
}: {
    settings: AuthSettings;
    customModel: string;
    onCustomModelChange: (value: string) => void;
    onAddCustomModel: () => void;
    onDefaultPointsChange: (value: number | null) => void;
    onCheckInRewardPointsChange: (value: number | null) => void;
    onModelPointCostChange: (model: string, value: number | null) => void;
    onModelPointCostDelete: (model: string) => void;
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
                <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">使用管理员默认接口时扣积分；自定义接口不扣平台积分。Grok 或其他未单独设置的模型会使用默认消耗。</div>
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
        </div>
    );
}

function SystemChannelEditor({ channel, fetching, onChange, onDelete, onFetchModels }: { channel: SystemModelChannel; fetching: boolean; onChange: (patch: Partial<SystemModelChannel>) => void; onDelete: () => void; onFetchModels: () => void }) {
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
                </div>
                <Space wrap className="w-full justify-start sm:w-auto sm:justify-end">
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={fetching} onClick={onFetchModels}>
                        拉取模型
                    </Button>
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

function Metric({ label, value, detail, icon, tone }: { label: string; value: number; detail: string; icon: ReactNode; tone: "slate" | "blue" | "emerald" | "amber" }) {
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
    const numberValue = Math.floor(Number(value));
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function toNumberOrOne(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Number(numberValue.toFixed(2)) : 1;
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
    { key: "users", label: "用户管理", description: "调整用户角色、账号状态和积分余额。", shortDescription: "角色积分", icon: <UsersRound className="size-4" /> },
    { key: "prompts", label: "提示词库", description: "维护会出现在用户端提示词库里的公共提示词。", shortDescription: "公共内容", icon: <KeyRound className="size-4" /> },
];

const metricToneClass = {
    slate: "bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
};
