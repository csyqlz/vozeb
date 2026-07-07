"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { appStorageKey, legacyAppStorageKey, migrateLocalStorageKey } from "@/lib/storage-keys";

export type ApiCallFormat = "openai" | "gemini";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type AiConfig = {
    apiSource: "system" | "custom";
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
    modelPointCosts: Record<string, number>;
    generationPointMultipliers: GenerationPointMultipliers;
    generationConcurrency: GenerationConcurrencySettings;
};

export type GenerationPointMultipliers = {
    imageQuality: Record<string, number>;
    videoQuality: Record<string, number>;
    videoSeconds: Record<string, number>;
};

export type GenerationConcurrencySettings = {
    image: number;
    video: number;
};

export type WebdavSyncConfig = {
    proxyMode: "direct" | "nextjs";
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};

export type PublicSystemSettings = {
    modelPointCosts?: Record<string, number>;
    generationPointMultipliers?: GenerationPointMultipliers;
    generationConcurrency?: GenerationConcurrencySettings;
    generationDefaults?: {
        canvasImageCount?: number;
    };
    webdav?: {
        enabled?: boolean;
    };
    defaultModels?: {
        imageModel?: string;
        videoModel?: string;
        textModel?: string;
        audioModel?: string;
    };
    systemChannels?: Array<ModelChannel & { enabled?: boolean; hasApiKey?: boolean }>;
};

export const CONFIG_STORE_KEY = appStorageKey("ai_config_store");
migrateLocalStorageKey(CONFIG_STORE_KEY, legacyAppStorageKey("ai_config_store"));
export type ModelCapability = "image" | "video" | "text" | "audio";
const CHANNEL_MODEL_SEPARATOR = "::";
const DEFAULT_SYSTEM_BASE_URL = "";
const CONFIG_STORE_VERSION = 3;

export const defaultConfig: AiConfig = {
    apiSource: "system",
    channelMode: "local",
    baseUrl: DEFAULT_SYSTEM_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "5",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "1",
    modelPointCosts: {},
    generationPointMultipliers: {
        imageQuality: { auto: 1, low: 1, medium: 1, high: 1 },
        videoQuality: { "480": 1, "720": 1, "1080": 1 },
        videoSeconds: { "-1": 1, "5": 1, "10": 1 },
    },
    generationConcurrency: { image: 4, video: 1 },
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    proxyMode: "direct",
    url: "",
    username: "",
    password: "",
    directory: "vozeb",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    setConfig: (config: AiConfig) => void;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("image") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("flux") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney"))
    );
}

function isAudioModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    if (config.apiSource === "system") return Boolean(model.trim() && channel.baseUrl.trim().startsWith("/api/ai/system/"));
    return false;
}

export function applyPublicSystemSettings(config: AiConfig, settings?: PublicSystemSettings | null): AiConfig {
    const channels = (settings?.systemChannels || [])
        .filter((channel) => channel.enabled !== false && channel.models?.length)
        .map((channel) => ({
            id: channel.id,
            name: channel.name,
            baseUrl: channel.baseUrl?.startsWith("/api/ai/system/") ? channel.baseUrl : `/api/ai/system/${channel.id}`,
            apiKey: "system",
            apiFormat: channel.apiFormat === "gemini" ? ("gemini" as const) : ("openai" as const),
            models: uniqueRawModels(channel.models || []),
        }));
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image");
    const videoModels = filterModelsByCapability(models, "video");
    const textModels = filterModelsByCapability(models, "text");
    const audioModels = filterModelsByCapability(models, "audio");
    const defaultModels = settings?.defaultModels || {};
    const imageModel = chooseSystemModel(config.imageModel, defaultModels.imageModel, channels, imageModels);
    const videoModel = chooseSystemModel(config.videoModel, defaultModels.videoModel, channels, videoModels);
    const textModel = chooseSystemModel(config.textModel, defaultModels.textModel, channels, textModels);
    const audioModel = chooseSystemModel(config.audioModel, defaultModels.audioModel, channels, audioModels);
    return {
        ...config,
        apiSource: "system",
        channelMode: "local",
        channels,
        baseUrl: channels[0]?.baseUrl || "",
        apiKey: "system",
        apiFormat: "openai",
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel,
        videoModel,
        textModel,
        audioModel,
        model: imageModel || textModel || videoModel || audioModel || "",
        systemPrompt: "",
        audioInstructions: "",
        modelPointCosts: settings?.modelPointCosts || {},
        generationPointMultipliers: normalizeGenerationPointMultipliers(settings?.generationPointMultipliers),
        generationConcurrency: normalizeGenerationConcurrency(settings?.generationConcurrency),
        canvasImageCount: normalizeCanvasImageCount(settings?.generationDefaults?.canvasImageCount),
    };
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            isConfigOpen: false,
            shouldPromptContinue: false,
            setConfig: (config) => set({ config }),
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => {
                if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("vozeb-system-config-missing", { detail: { shouldPromptContinue } }));
                set({ isConfigOpen: false, shouldPromptContinue: false });
            },
            setConfigDialogOpen: () => set({ isConfigOpen: false, shouldPromptContinue: false }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: CONFIG_STORE_VERSION,
            partialize: (state) => ({ config: state.config }),
            migrate: (persisted, version) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (version < 2 && persistedConfig.canvasImageCount === "3") {
                    config.canvasImageCount = defaultConfig.canvasImageCount;
                }
                if (version < 3) {
                    config.systemPrompt = "";
                    config.audioInstructions = "";
                }
                return { config };
            },
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                const imageModel = normalizeModelOptionValue(config.imageModel || config.model, channels);
                const videoModel = normalizeModelOptionValue(config.videoModel || config.model, channels);
                const textModel = normalizeModelOptionValue(config.textModel || config.model, channels);
                const audioModel = normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels);
                const model = normalizeModelOptionValue(config.model, channels) || imageModel || textModel || videoModel || audioModel;
                return {
                    ...current,
                    config: {
                        ...config,
                        apiSource: "system",
                        channelMode: "local",
                        baseUrl: channels[0]?.baseUrl || "",
                        apiKey: "system",
                        apiFormat: "openai",
                        channels,
                        models,
                        model,
                        imageModel,
                        videoModel,
                        textModel,
                        audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: "",
                        videoSeconds: config.videoSeconds || "5",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        systemPrompt: "",
                        canvasImageCount: config.canvasImageCount || "1",
                        modelPointCosts: isRecord(persistedConfig.modelPointCosts) ? normalizeModelPointCosts(persistedConfig.modelPointCosts) : {},
                        generationPointMultipliers: normalizeGenerationPointMultipliers(persistedConfig.generationPointMultipliers),
                        generationConcurrency: normalizeGenerationConcurrency(persistedConfig.generationConcurrency),
                        imageModels: Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels, channels) : filterModelsByCapability(models, "image"),
                        videoModels: Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels, channels) : filterModelsByCapability(models, "video"),
                        textModels: Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels, channels) : filterModelsByCapability(models, "text"),
                        audioModels: Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels, channels) : filterModelsByCapability(models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[], channels: ModelChannel[]) {
    if (!channels.length) return [];
    const allModelOptions = channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model)));
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)))
        .map((model) => normalizeModelOptionValue(model, channels))
        .filter((model) => !allModelOptions.length || allModelOptions.includes(model) || !isChannelModelValue(model));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeModelPointCosts(costs: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(costs)
            .map(([model, value]) => [model.trim(), normalizePointCost(value)] as const)
            .filter(([model]) => Boolean(model)),
    );
}

function normalizePointCost(value: unknown) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return 0;
    return Number(numberValue.toFixed(2));
}

export function normalizeGenerationPointMultipliers(settings?: Partial<GenerationPointMultipliers>) {
    return {
        imageQuality: normalizeMultiplierMap(settings?.imageQuality, defaultConfig.generationPointMultipliers.imageQuality),
        videoQuality: normalizeMultiplierMap(settings?.videoQuality, defaultConfig.generationPointMultipliers.videoQuality),
        videoSeconds: normalizeMultiplierMap(settings?.videoSeconds, defaultConfig.generationPointMultipliers.videoSeconds),
    };
}

function normalizeMultiplierMap(settings: Record<string, unknown> | undefined, defaults: Record<string, number>) {
    return {
        ...defaults,
        ...Object.fromEntries(
            Object.entries(settings || {})
                .map(([key, value]) => [key.trim(), normalizePointCost(value)] as const)
                .filter(([key]) => Boolean(key)),
        ),
    };
}

export function normalizeGenerationConcurrency(settings?: Partial<GenerationConcurrencySettings>) {
    return {
        image: clampInteger(settings?.image, 1, 10, defaultConfig.generationConcurrency.image),
        video: clampInteger(settings?.video, 1, 5, defaultConfig.generationConcurrency.video),
    };
}

function normalizeCanvasImageCount(value: unknown) {
    return String(clampInteger(value, 1, 10, Number(defaultConfig.canvasImageCount) || 1));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
    const numberValue = Math.floor(Number(value));
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(min, Math.min(max, numberValue));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || DEFAULT_SYSTEM_BASE_URL,
        apiKey: channel?.apiKey || "",
        apiFormat: channel?.apiFormat === "gemini" ? "gemini" : "openai",
        models: uniqueRawModels(channel?.models || []),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model))));
}

function chooseSystemModel(currentValue: string, adminDefault: string | undefined, channels: ModelChannel[], options: string[]) {
    const current = normalizeModelOptionValue(currentValue, channels);
    if (current && options.includes(current)) return current;
    const matchedByName = encodeSystemModelByName(modelOptionName(currentValue), channels);
    if (matchedByName && options.includes(matchedByName)) return matchedByName;
    const defaultModel = encodeSystemModelByName(adminDefault || "", channels);
    if (defaultModel && options.includes(defaultModel)) return defaultModel;
    return options[0] || "";
}

function encodeSystemModelByName(model: string, channels: ModelChannel[]) {
    const name = model.trim();
    if (!name) return "";
    const channel = channels.find((item) => item.models.includes(name));
    return channel ? encodeChannelModel(channel.id, name) : "";
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    if (!channels.length) return "";
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.includes(decoded.model) ? model : "";
    }
    const legacyModel = model;
    const channel = channels.find((item) => item.models.includes(legacyModel)) || channels[0];
    return channel && channel.models.includes(legacyModel) ? encodeChannelModel(channel.id, legacyModel) : "";
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        systemPrompt: "",
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels
        .filter((channel) => channel.baseUrl?.trim().startsWith("/api/ai/system/"))
        .map((channel, index) =>
            createModelChannel({
                ...channel,
                id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
                name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
                apiKey: "system",
                models: uniqueRawModels(channel.models || []),
            }),
        );
    return channels.map((channel) => ({ ...channel, models: uniqueRawModels(channel.models) }));
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map((model) => modelOptionName(model).trim()).filter(Boolean)));
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
