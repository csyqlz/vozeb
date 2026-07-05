"use client";

import { App, Button, Form, Input, Modal, Progress, Segmented, Select, Tabs } from "antd";
import { CircleAlert, Cloud, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { fetchChannelModels } from "@/services/api/image";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import {
    encodeChannelModel,
    filterModelsByCapability,
    modelOptionLabel,
    modelOptionsFromChannels,
    normalizeGenerationConcurrency,
    normalizeModelOptionValue,
    useConfigStore,
    type AiConfig,
    type GenerationConcurrencySettings,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

type PublicSystemSettings = {
    allowUserApiConfig: boolean;
    modelPointCosts: Record<string, number>;
    generationConcurrency: GenerationConcurrencySettings;
    defaultModels: {
        imageModel: string;
        videoModel: string;
        textModel: string;
        audioModel: string;
    };
    systemChannels: Array<ModelChannel & { enabled: boolean; hasApiKey: boolean }>;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的素材",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigModal() {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState("channels");
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const [systemSettings, setSystemSettings] = useState<PublicSystemSettings | null>(null);
    const customConfigRef = useRef<AiConfig | null>(null);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const setConfig = useConfigStore((state) => state.setConfig);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model }));
    const webdavReady = Boolean(webdav.url.trim());
    const systemChannels = (systemSettings?.systemChannels || []).filter((channel) => channel.enabled && channel.models.length);

    useEffect(() => {
        if (!isConfigOpen) return;
        void fetch("/api/auth/session")
            .then((response) => response.json())
            .then((payload: { settings?: PublicSystemSettings }) => {
                setSystemSettings(payload.settings || null);
                updateConfig("modelPointCosts", payload.settings?.modelPointCosts || {});
                if (payload.settings?.generationConcurrency) updateConfig("generationConcurrency", normalizeGenerationConcurrency(payload.settings.generationConcurrency));
            })
            .catch(() => setSystemSettings(null));
    }, [isConfigOpen, updateConfig]);

    useEffect(() => {
        if (systemSettings?.allowUserApiConfig === false && config.apiSource === "custom") updateConfig("apiSource", "system");
    }, [config.apiSource, systemSettings?.allowUserApiConfig, updateConfig]);

    const saveConfig = (nextConfig: AiConfig) => {
        setConfig(nextConfig);
    };

    useEffect(() => {
        if (!isConfigOpen || config.apiSource !== "custom" || !isSystemProxyConfig(config)) return;
        saveConfig(createBlankCustomConfig(config));
    }, [config, isConfigOpen, setConfig]);

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => {
        const nextConfig = withChannels(config, channels);
        saveConfig(nextConfig);
    };

    const applySystemChannels = () => {
        if (!systemChannels.length) {
            message.warning("平台默认接口暂未配置可用模型");
            return;
        }
        if (!isSystemProxyConfig(config)) customConfigRef.current = { ...config, apiSource: "custom" };
        const nextConfig = withChannels({ ...config, apiSource: "system" }, systemChannels);
        const defaults = systemSettings?.defaultModels;
        saveConfig({
            ...nextConfig,
            apiSource: "system",
            imageModel: resolveSystemModel(nextConfig, systemChannels, config.imageModel, defaults?.imageModel, "image"),
            videoModel: resolveSystemModel(nextConfig, systemChannels, config.videoModel, defaults?.videoModel, "video"),
            textModel: resolveSystemModel(nextConfig, systemChannels, config.textModel, defaults?.textModel, "text"),
            audioModel: resolveSystemModel(nextConfig, systemChannels, config.audioModel, defaults?.audioModel, "audio"),
        });
        message.success("已使用平台默认接口");
    };

    const changeApiSource = (value: AiConfig["apiSource"]) => {
        if (value === "system") {
            applySystemChannels();
            return;
        }
        const customConfig = customConfigRef.current || (isSystemProxyConfig(config) ? createBlankCustomConfig(config) : { ...config, apiSource: "custom" });
        saveConfig({ ...customConfig, apiSource: "custom" });
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, apiFormat: "openai", models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const addChannel = () => {
        updateChannels([...config.channels, createBlankModelChannel(`渠道 ${config.channels.length + 1}`)]);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const models = await fetchChannelModels(channel);
            updateChannels(config.channels.map((item) => (item.id === channel.id ? { ...item, models } : item)));
            message.success(`${channel.name} 模型列表已更新`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshAllModels = async () => {
        const runnable = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
        if (!runnable.length) {
            message.error("请先填写至少一个渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId("all");
        try {
            const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await fetchChannelModels(channel)] as const));
            const modelMap = new Map(entries);
            updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)));
            message.success("模型列表已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个素材，${result.imageLogs + result.videoLogs} 条记录，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、模型选择和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width="min(980px, calc(100vw - 24px))"
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "min(72vh, calc(100dvh - 190px))", overflowX: "hidden", overflowY: "auto", paddingRight: 4 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    完成
                </Button>
            }
        >
            {shouldPromptContinue ? (
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2">
                        <CircleAlert className="mt-0.5 size-4 shrink-0" />
                        <div className="leading-6">
                            <span className="font-semibold">需要先配置可用模型。</span>
                            <span className="ml-1">先选择接口来源；自定义接口需要填写渠道并拉取模型，然后到「模型」Tab 选择可选项。</span>
                        </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button size="small" onClick={() => setActiveTab("channels")}>
                            配置渠道
                        </Button>
                        <Button size="small" type="primary" onClick={() => setActiveTab("models")}>
                            去模型设置
                        </Button>
                    </div>
                </div>
            ) : null}
            <Tabs
                className="max-w-full overflow-hidden"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 text-sm font-semibold">接口来源</div>
                                    <Segmented
                                        block
                                        className="w-full sm:w-auto"
                                        value={config.apiSource}
                                        onChange={(value) => changeApiSource(value as AiConfig["apiSource"])}
                                        options={[
                                            { label: "平台默认接口", value: "system" },
                                            { label: "自行配置接口", value: "custom", disabled: systemSettings?.allowUserApiConfig === false },
                                        ]}
                                    />
                                    {config.apiSource === "system" ? (
                                        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <div className="text-xs leading-5 text-stone-500">平台默认接口通过服务端代理调用，当前可用渠道 {systemChannels.length} 个。</div>
                                            <Button type="primary" onClick={applySystemChannels}>
                                                使用平台默认接口
                                            </Button>
                                        </div>
                                    ) : null}
                                </div>
                                {config.apiSource === "system" ? (
                                    <SystemChannelSummary channels={systemChannels} />
                                ) : (
                                    <>
                                        <div className="mb-4 space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                            <div className="flex flex-col gap-2.5 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                    <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
                                                        <CircleAlert className="size-3.5" />
                                                    </span>
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-semibold leading-5">模型显示提醒</div>
                                                        <div className="mt-0.5 text-xs leading-5 text-amber-900/80 dark:text-amber-100/75">新增或拉取模型后，需要到“模型”Tab 选择可选项才会显示。</div>
                                                    </div>
                                                </div>
                                                <Button
                                                    size="small"
                                                    className="shrink-0 border-amber-300 bg-white/75 text-amber-900 hover:!border-amber-400 hover:!text-amber-950 dark:border-amber-400/35 dark:bg-white/10 dark:text-amber-100 dark:hover:!border-amber-300 dark:hover:!text-amber-50"
                                                    onClick={() => setActiveTab("models")}
                                                >
                                                    去模型设置
                                                </Button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                                                <Button className="min-w-0" icon={<RefreshCw className="size-4" />} loading={Boolean(loadingChannelId)} onClick={() => void refreshAllModels()}>
                                                    拉取全部
                                                </Button>
                                                <Button className="min-w-0" type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                                    新增渠道
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            {config.channels.map((channel) => (
                                                <section key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                            <div className="mt-1 text-xs text-stone-500">已保存 {channel.models.length} 个模型</div>
                                                        </div>
                                                        <div className="flex shrink-0 justify-end gap-2">
                                                            <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannelModels(channel)}>
                                                                拉取模型
                                                            </Button>
                                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <Form.Item label="渠道名称" className="mb-0">
                                                            <Input value={channel.name} placeholder="例如：OpenAI、Grok、SiliconFlow" onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                                        </Form.Item>
                                                        <Form.Item label="Base URL" className="mb-0">
                                                            <Input value={channel.baseUrl} placeholder="例如：https://api.openai.com/v1" onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                                        </Form.Item>
                                                        <Form.Item label="API Key" className="mb-0">
                                                            <Input.Password value={channel.apiKey} placeholder="例如：sk-..." onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} />
                                                        </Form.Item>
                                                        <Form.Item label="模型列表" className="mb-0 md:col-span-2">
                                                            <Select mode="tags" showSearch allowClear maxTagCount="responsive" placeholder="输入模型名，或点击拉取模型" value={channel.models} onChange={(models) => updateChannel(channel.id, { models })} />
                                                        </Form.Item>
                                                    </div>
                                                </section>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </Form>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="text-sm font-semibold">默认模型和可选项</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">可选项决定各处下拉框展示哪些模型；同名模型会以括号里的渠道名区分。</div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                            <Select
                                                mode="tags"
                                                showSearch
                                                allowClear
                                                maxTagCount="responsive"
                                                placeholder={config.models.length ? `请选择或输入${group.optionsLabel}` : "先到渠道里填写或拉取模型"}
                                                value={config[group.modelsKey]}
                                                options={modelOptions}
                                                onChange={(models) => updateCapabilityModels(group, models)}
                                            />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "生成偏好",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令" className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">同步画布、我的素材、生成记录和本地媒体文件，不包含 AI API Key 和服务器兜底副本；服务不支持 CORS 时可走 Next.js 转发。</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="连接方式" className="mb-4 md:col-span-2">
                                            <Segmented
                                                block
                                                value={webdav.proxyMode}
                                                onChange={(value) => updateWebdavConfig("proxyMode", value as typeof webdav.proxyMode)}
                                                options={[
                                                    { label: "前端直连", value: "direct" },
                                                    { label: "Next.js 转发", value: "nextjs" },
                                                ]}
                                            />
                                        </Form.Item>
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                            <Input value={webdav.directory} placeholder="vozeb" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
        </Modal>
    );
}

function isSystemProxyConfig(config: AiConfig) {
    return config.channels.length > 0 && config.channels.every((channel) => channel.baseUrl.trim().startsWith("/api/ai/system/") && channel.apiKey === "system");
}

function createBlankCustomConfig(config: AiConfig) {
    return {
        ...withChannels({ ...config, apiSource: "custom" }, [createBlankModelChannel("自定义渠道", "custom-default")]),
        baseUrl: "",
        apiKey: "",
        models: [],
        imageModels: [],
        videoModels: [],
        textModels: [],
        audioModels: [],
        imageModel: "",
        videoModel: "",
        textModel: "",
        audioModel: "",
    };
}

function createBlankModelChannel(name: string, id?: string): ModelChannel {
    return { id: id || nanoid(), name, baseUrl: "", apiKey: "", apiFormat: "openai", models: [] };
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const normalizedChannels = channels.map((channel) => ({ ...channel, apiFormat: "openai" as const }));
    const models = modelOptionsFromChannels(normalizedChannels);
    const imageModels = keepOrSuggest(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggest(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggest(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggest(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channels: normalizedChannels,
        models,
        baseUrl: normalizedChannels[0]?.baseUrl || config.baseUrl,
        apiKey: normalizedChannels[0]?.apiKey || config.apiKey,
        apiFormat: "openai",
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggest(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModels(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || value;
}

function resolveSystemDefault(channels: ModelChannel[], model?: string) {
    const name = (model || "").trim();
    if (!name) return "";
    const channel = channels.find((item) => item.models.includes(name));
    return channel ? encodeChannelModel(channel.id, name) : "";
}

function resolveSystemModel(config: AiConfig, channels: ModelChannel[], currentModel: string, defaultModel: string | undefined, capability: ModelCapability) {
    const currentName = normalizeModelOptionValue(currentModel, channels);
    if (currentName && config[`${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels"].includes(currentName)) return currentName;
    const matchedByName = resolveSystemDefault(channels, modelName(currentModel));
    if (matchedByName && config[`${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels"].includes(matchedByName)) return matchedByName;
    const adminDefault = resolveSystemDefault(channels, defaultModel);
    if (adminDefault && config[`${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels"].includes(adminDefault)) return adminDefault;
    return config[`${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels"][0] || "";
}

function modelName(value: string) {
    const index = value.indexOf("::");
    return index >= 0 ? value.slice(index + 2) : value;
}

function SystemChannelSummary({ channels }: { channels: PublicSystemSettings["systemChannels"] }) {
    if (!channels.length) {
        return <div className="rounded-lg border border-dashed border-stone-200 p-6 text-center text-sm text-stone-500 dark:border-stone-800">平台默认接口暂未配置可用模型。</div>;
    }

    return (
        <div className="space-y-3">
            {channels.map((channel) => (
                <section key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{channel.name || "默认渠道"}</div>
                            <div className="mt-1 text-xs text-stone-500">连接信息不会显示给用户端，这里只展示可用模型。</div>
                        </div>
                        <div className="shrink-0 text-xs text-stone-500">{channel.models.length} 个模型</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {channel.models.map((model) => (
                            <span key={model} className="rounded border border-stone-200 bg-stone-100 px-2 py-1 text-xs text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
                                {model}
                            </span>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
