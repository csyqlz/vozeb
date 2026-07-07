"use client";

import { ArrowLeft, ArrowRight, BookOpen, Check, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { formatCreditAmount, requestCreditCost } from "@/constant/credits";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { APP_STORAGE_NAME, LEGACY_APP_STORAGE_NAME } from "@/lib/storage-keys";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { deleteStoredMedia, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { deleteGenerationLogs as deleteServerGenerationLogs, listGenerationLogs, recordGenerationLog, type StoredGenerationLogRecord } from "@/services/api/generation-logs";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type GeneratedVideo = {
    id: string;
    url: string;
    remoteUrl?: string;
    serverUrl?: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    ownerUserId?: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
    resultDeleted?: boolean;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const globalLogStore = localforage.createInstance({ name: APP_STORAGE_NAME, storeName: "video_generation_logs" });
const legacyLogStore = localforage.createInstance({ name: LEGACY_APP_STORAGE_NAME, storeName: "video_generation_logs" });
const loadPromptSelectDialog = () => import("@/components/prompts/prompt-select-dialog").then((module) => module.PromptSelectDialog);
const loadAssetPickerModal = () => import("@/app/(user)/canvas/components/asset-picker-modal").then((module) => module.AssetPickerModal);
const PromptSelectDialog = dynamic(loadPromptSelectDialog, { ssr: false, loading: () => null });
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

export default function VideoPage() {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const startingVideoTasksRef = useRef(0);
    const queuedVideoLogsRef = useRef<Array<{ log: GenerationLog; configOverride?: AiConfig }>>([]);
    const queuedVideoLogIdsRef = useRef<Set<string>>(new Set());
    const videoConcurrencyLimitRef = useRef(1);
    const activeLogIdRef = useRef<string | null>(null);
    const logsRef = useRef<GenerationLog[]>([]);
    const deletedResultLogIdsRef = useRef(new Set<string>());
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [activeVideoCount, setActiveVideoCount] = useState(0);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const userIdRef = useRef("");

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const pointsCost = requestCreditCost({
        apiSource: effectiveConfig.apiSource,
        modelPointCosts: effectiveConfig.modelPointCosts,
        generationPointMultipliers: effectiveConfig.generationPointMultipliers,
        kind: "video",
        model,
        videoQuality: effectiveConfig.vquality,
        videoSeconds: effectiveConfig.videoSeconds,
    });
    const canGenerate = Boolean(prompt.trim());
    const videoConcurrencyLimit = Math.max(1, Math.min(5, Math.floor(Number(effectiveConfig.generationConcurrency?.video) || 1)));
    const previewPendingCount = results.filter((result) => result.status === "pending").length;

    useEffect(() => {
        userIdRef.current = userId;
        activeLogIdsRef.current.clear();
        queuedVideoLogsRef.current = [];
        queuedVideoLogIdsRef.current.clear();
        deletedResultLogIdsRef.current.clear();
        activeLogIdRef.current = null;
        setPreviewLog(null);
        setResults([]);
        setSelectedLogIds([]);
        setSelectedResultIds([]);
        syncActiveVideoCount();
        if (userId) void refreshLogs(userId);
        else {
            logsRef.current = [];
            setLogs([]);
        }
    }, [userId]);

    useEffect(() => {
        return preloadOnIdle(() => {
            void loadPromptSelectDialog();
            void loadAssetPickerModal();
        });
    }, []);

    useEffect(() => {
        videoConcurrencyLimitRef.current = videoConcurrencyLimit;
        startQueuedVideoLogs();
    }, [videoConcurrencyLimit]);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning("已忽略不支持的参考素材，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length);
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length);
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 30MB 的参考图");
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning("已忽略超过 50MB 的参考视频");
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadMediaFile(file, "video-reference");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio-reference");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                }),
            ),
            message.warning,
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.audios));
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    function currentVideoTaskCount() {
        return activeLogIdsRef.current.size + startingVideoTasksRef.current;
    }

    function syncActiveVideoCount() {
        const count = currentVideoTaskCount();
        setActiveVideoCount(count);
    }

    function beginStartingVideoTask() {
        startingVideoTasksRef.current += 1;
        syncActiveVideoCount();
    }

    function finishStartingVideoTask() {
        startingVideoTasksRef.current = Math.max(0, startingVideoTasksRef.current - 1);
        syncActiveVideoCount();
    }

    function enqueueVideoLog(log: GenerationLog, configOverride?: AiConfig) {
        if (!log.task || activeLogIdsRef.current.has(log.id) || queuedVideoLogIdsRef.current.has(log.id) || deletedResultLogIdsRef.current.has(log.id)) return;
        queuedVideoLogIdsRef.current.add(log.id);
        queuedVideoLogsRef.current.push({ log, configOverride });
    }

    function removeQueuedVideoLog(logId: string) {
        queuedVideoLogIdsRef.current.delete(logId);
        queuedVideoLogsRef.current = queuedVideoLogsRef.current.filter((item) => item.log.id !== logId);
    }

    function startQueuedVideoLogs() {
        while (currentVideoTaskCount() < videoConcurrencyLimitRef.current && queuedVideoLogsRef.current.length) {
            const item = queuedVideoLogsRef.current.shift();
            if (!item) return;
            queuedVideoLogIdsRef.current.delete(item.log.id);
            if (deletedResultLogIdsRef.current.has(item.log.id)) continue;
            void pollGenerationLog(item.log, item.configOverride);
        }
        syncActiveVideoCount();
    }

    function scheduleVideoLog(log: GenerationLog, configOverride?: AiConfig) {
        if (!log.task || activeLogIdsRef.current.has(log.id) || deletedResultLogIdsRef.current.has(log.id)) return;
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            enqueueVideoLog(log, configOverride);
            syncActiveVideoCount();
            return;
        }
        void pollGenerationLog(log, configOverride);
    }

    const generate = async () => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            message.warning("当前用户视频生成已达到并发上限，请稍后再试");
            return;
        }
        beginStartingVideoTask();
        setPreviewLog(null);
        setSelectedResultIds([]);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences);
            const log = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, durationMs: 0, status: "生成中", task });
            activeLogIdRef.current = log.id;
            setPreviewLog(log);
            setResults([{ id: log.id, status: "pending" }]);
            await saveLog(log, { refresh: false });
            finishStartingVideoTask();
            scheduleVideoLog(log, snapshot.config);
        } catch (error) {
            finishStartingVideoTask();
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const failedLog = buildLog({
                prompt: snapshot.text,
                model,
                config: snapshot.config,
                references: snapshot.references,
                videoReferences: snapshot.videoReferences,
                audioReferences: snapshot.audioReferences,
                durationMs: performance.now() - batchStartedAt,
                status: "失败",
                error: errorMessage,
            });
            activeLogIdRef.current = failedLog.id;
            setPreviewLog(failedLog);
            setResults([{ id: failedLog.id, status: "failed", error: errorMessage }]);
            await saveLog(failedLog);
            void recordVideoGenerationLog(failedLog);
            message.error(errorMessage);
            startQueuedVideoLogs();
        }
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入视频提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请联系管理员在后台配置可用视频模型");
            openConfigDialog(true);
            return null;
        }
        const videoReferenceError = seedanceVideoReferenceError(videoReferences);
        if (videoReferenceError) {
            message.error(`${videoReferenceError}。${seedanceVideoReferenceHint}`);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = async () => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog) {
            await generate();
            return;
        }
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            message.warning("当前用户视频生成已达到并发上限，请稍后再试");
            return;
        }

        const retryConfig = buildVideoConfig({ ...effectiveConfig, ...currentLog.config }, currentLog.config.videoModel || currentLog.model || model);
        const retryStartedAt = Date.now();
        const pendingLog: GenerationLog = {
            ...currentLog,
            createdAt: retryStartedAt,
            time: new Date(retryStartedAt).toLocaleString("zh-CN", { hour12: false }),
            config: normalizeLogConfig({ ...currentLog, config: retryConfig }),
            size: retryConfig.size,
            resolution: normalizeResolution(retryConfig.vquality),
            seconds: retryConfig.videoSeconds,
            status: "生成中",
            task: undefined,
            video: undefined,
            error: undefined,
            durationMs: 0,
            resultDeleted: false,
        };

        beginStartingVideoTask();
        deletedResultLogIdsRef.current.delete(currentLog.id);
        removeQueuedVideoLog(currentLog.id);
        activeLogIdRef.current = currentLog.id;
        setPreviewLog(pendingLog);
        setResults([{ id: currentLog.id, status: "pending" }]);
        setSelectedResultIds([]);

        try {
            const task = await createVideoGenerationTask(retryConfig, currentLog.prompt, currentLog.references || [], currentLog.videoReferences || [], currentLog.audioReferences || []);
            const nextLog = { ...pendingLog, task };
            await saveLog(nextLog, { refresh: false });
            finishStartingVideoTask();
            scheduleVideoLog(nextLog, retryConfig);
        } catch (error) {
            finishStartingVideoTask();
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const failedLog: GenerationLog = { ...pendingLog, status: "失败", task: undefined, error: errorMessage, durationMs: Date.now() - retryStartedAt };
            setPreviewLog(failedLog);
            setResults([{ id: currentLog.id, status: "failed", error: errorMessage }]);
            await saveLog(failedLog);
            void recordVideoGenerationLog(failedLog);
            message.error(errorMessage);
            startQueuedVideoLogs();
        }
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: "生成视频",
            coverUrl: "",
            tags: [],
            source: "视频创作台",
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success("已加入我的素材");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        } else if (payload.kind === "video") {
            setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height }].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setResults([]);
        setSelectedLogIds([]);
        setSelectedResultIds([]);
        setPreviewLog(null);
        activeLogIdRef.current = null;
    };

    const deleteSelectedLogs = async () => {
        const deleteIds = selectedLogIds.filter((id) => logsRef.current.some((log) => log.id === id));
        if (!deleteIds.length) {
            setDeleteConfirmOpen(false);
            return;
        }
        const deleteIdSet = new Set(deleteIds);
        const mediaKeys = logs
            .filter((log) => deleteIdSet.has(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        deleteIds.forEach((id) => {
            deletedResultLogIdsRef.current.add(id);
            removeQueuedVideoLog(id);
            activeLogIdsRef.current.delete(id);
        });
        syncActiveVideoCount();
        startQueuedVideoLogs();
        logsRef.current = logsRef.current.filter((log) => !deleteIdSet.has(log.id));
        setLogs(logsRef.current);
        if (previewLog && deleteIdSet.has(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
            setSelectedResultIds([]);
            activeLogIdRef.current = null;
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        const results = await Promise.allSettled([deleteStoredMedia(mediaKeys), deleteServerGenerationLogs(deleteIds.map((id) => `video-workbench:${id}`)), ...deleteIds.flatMap((id) => [globalLogStore.removeItem(id), legacyLogStore.removeItem(id)])]);
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length) {
            message.warning("记录已从本地列表移除，部分远程或本地缓存删除失败，请稍后刷新重试");
        } else {
            message.success(`已删除 ${deleteIds.length} 条生成记录`);
        }
        await refreshLogs();
    };

    const saveLog = async (log: GenerationLog, options?: { refresh?: boolean }) => {
        const ownedLog = withLogOwner(log, userIdRef.current);
        const nextLogs = [ownedLog, ...logsRef.current.filter((item) => item.id !== ownedLog.id)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        logsRef.current = nextLogs;
        setLogs(nextLogs);
        if (activeLogIdRef.current === ownedLog.id) setPreviewLog(ownedLog);
        await globalLogStore.setItem(ownedLog.id, serializeLog(ownedLog));
        if (options?.refresh !== false) await refreshLogs();
    };

    const refreshLogs = async (ownerUserId = userIdRef.current) => {
        const nextLogs = ownerUserId ? await readStoredLogs(ownerUserId) : [];
        const visibleLogs = nextLogs.filter((log) => !deletedResultLogIdsRef.current.has(log.id));
        logsRef.current = visibleLogs;
        setLogs(visibleLogs);
        const activeLog = activeLogIdRef.current ? visibleLogs.find((log) => log.id === activeLogIdRef.current) : null;
        if (activeLog) setPreviewLog(activeLog);
        resumePendingLogs(visibleLogs);
        return visibleLogs;
    };

    const getLatestLog = (logId: string) => logsRef.current.find((log) => log.id === logId) || null;

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "生成中" && log.task) scheduleVideoLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            enqueueVideoLog(log, configOverride);
            syncActiveVideoCount();
            return;
        }
        activeLogIdsRef.current.add(log.id);
        syncActiveVideoCount();
        if (!activeLogIdRef.current) activeLogIdRef.current = log.id;
        if (activeLogIdRef.current === log.id) {
            setPreviewLog(log);
            setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        }
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
                if (deletedResultLogIdsRef.current.has(log.id)) return;
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                if (state.status === "completed") {
                    if (deletedResultLogIdsRef.current.has(log.id)) return;
                    const stored = await storeGeneratedVideo(state.result);
                    if (deletedResultLogIdsRef.current.has(log.id)) {
                        await deleteStoredMedia([stored.storageKey]);
                        return;
                    }
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        remoteUrl: stored.remoteUrl,
                        serverUrl: stored.serverUrl,
                        storageKey: stored.storageKey,
                        durationMs: Date.now() - log.createdAt,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    const nextLog = { ...(getLatestLog(log.id) || log), status: "成功" as const, durationMs: nextVideo.durationMs, video: nextVideo, task: undefined, error: undefined, resultDeleted: false };
                    if (activeLogIdRef.current === log.id) setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                    await saveLog(nextLog);
                    void recordVideoGenerationLog(nextLog).then((asset) => {
                        if (!asset || deletedResultLogIdsRef.current.has(log.id)) return;
                        const latest = getLatestLog(log.id) || nextLog;
                        if (!latest.video) return;
                        void saveLog({ ...latest, video: { ...latest.video, remoteUrl: asset.remoteUrl || latest.video.remoteUrl, serverUrl: asset.serverUrl || latest.video.serverUrl } }, { refresh: false });
                    });
                    message.success("视频已生成");
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
                await delay(log.task.provider === "seedance" ? 5000 : 2500);
            }
        } catch (error) {
            if (deletedResultLogIdsRef.current.has(log.id)) return;
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const nextLog = { ...(getLatestLog(log.id) || log), status: "失败" as const, durationMs: Date.now() - log.createdAt, task: undefined, error: errorMessage, resultDeleted: false };
            if (activeLogIdRef.current === log.id) setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            await saveLog(nextLog);
            void recordVideoGenerationLog(nextLog);
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            syncActiveVideoCount();
            startQueuedVideoLogs();
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        activeLogIdRef.current = log.id;
        setPreviewLog(log);
        setLogsOpen(false);
        setSelectedResultIds([]);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        setResults(resultsFromLog(log));
    };

    const currentResultIds = results.map((result) => result.id);
    const selectedVisibleResultIds = selectedResultIds.filter((id) => currentResultIds.includes(id));
    const allResultsSelected = Boolean(results.length) && selectedVisibleResultIds.length === results.length;

    const toggleAllResults = () => {
        setSelectedResultIds(allResultsSelected ? [] : currentResultIds);
    };

    const toggleResultSelected = (id: string, checked: boolean) => {
        setSelectedResultIds((value) => (checked ? Array.from(new Set([...value, id])) : value.filter((item) => item !== id)));
    };

    const deleteSelectedResults = async () => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog || !selectedVisibleResultIds.length) return;
        const selectedIds = new Set(selectedVisibleResultIds);
        const removedResults = results.filter((result) => selectedIds.has(result.id));
        const nextResults = results.filter((result) => !selectedIds.has(result.id));
        const mediaKeys = removedResults.flatMap((result) => (result.video?.storageKey ? [result.video.storageKey] : []));
        deletedResultLogIdsRef.current.add(currentLog.id);
        removeQueuedVideoLog(currentLog.id);
        activeLogIdsRef.current.delete(currentLog.id);
        const keptVideo = nextResults.find((result) => result.status === "success" && result.video)?.video;
        const failedResult = nextResults.find((result) => result.status === "failed");
        const pendingResult = nextResults.find((result) => result.status === "pending");
        const nextLog: GenerationLog = {
            ...currentLog,
            status: pendingResult ? "生成中" : keptVideo ? "成功" : failedResult ? "失败" : currentLog.status === "生成中" ? "失败" : currentLog.status,
            task: pendingResult ? currentLog.task : undefined,
            video: keptVideo,
            error: failedResult?.error,
            resultDeleted: !nextResults.length,
        };
        setResults(nextResults);
        setSelectedResultIds([]);
        setPreviewLog(nextLog);
        syncActiveVideoCount();
        startQueuedVideoLogs();
        await Promise.all([deleteStoredMedia(mediaKeys), saveLog(nextLog)]);
        message.success(`已删除 ${removedResults.length} 个结果`);
    };

    const renameGenerationLog = async (log: GenerationLog, title: string) => {
        const nextTitle = title.trim();
        if (!nextTitle || nextTitle === log.title) return;
        const latestLog = getLatestLog(log.id) || log;
        await saveLog({ ...latestLog, title: nextTitle });
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">视频创作台</h1>
                            <div className="flex shrink-0 gap-2 lg:hidden">
                                <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    记录
                                </Button>
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    参数
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">提示词</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            查看提示词库
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            查看我的素材
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder="描述镜头运动、主体动作、场景氛围和画面风格" />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考图</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            剪切板
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            上传
                                        </Button>
                                    </div>
                                </div>
                                <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700">
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("image", index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图，最多 9 张</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考视频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700">
                                    {videoReferences.map((item, index) => (
                                        <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800">
                                            <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                                            <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考视频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!videoReferences.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考视频，最多 3 个</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考音频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700">
                                    {audioReferences.map((item, index) => (
                                        <div key={item.id} className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900">
                                            <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                <Music2 className="size-4 shrink-0" />
                                                <span className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">{seedanceReferenceLabel("audio", index)}</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                            <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考音频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!audioReferences.length ? <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">暂无参考音频，最多 3 个，mp3/wav，单个 15MB 内</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {normalizeResolution(effectiveConfig.vquality)}p · {videoSizeLabel(effectiveConfig.size)} · {normalizeVideoSeconds(effectiveConfig.videoSeconds)}s
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    调整
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block disabled={!canGenerate || activeVideoCount >= videoConcurrencyLimit} onClick={() => void generate()}>
                                <span className="inline-flex items-center justify-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                                        <Sparkles className="size-[17px]" />
                                        <span className="text-sm font-semibold leading-none">{formatCreditAmount(pointsCost)}</span>
                                    </span>
                                    <span>开始生成</span>
                                </span>
                            </Button>
                            {activeVideoCount ? (
                                <div className="mt-2 text-center text-xs text-stone-500 dark:text-stone-400">
                                    当前用户运行 {activeVideoCount}/{videoConcurrencyLimit}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">生成结果</h2>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {results.length ? (
                                    <>
                                        <Button size="small" icon={<CheckSquare className="size-3.5" />} onClick={toggleAllResults}>
                                            {allResultsSelected ? "取消" : "全选"}
                                        </Button>
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedVisibleResultIds.length} onClick={() => void deleteSelectedResults()}>
                                            删除{selectedVisibleResultIds.length ? ` ${selectedVisibleResultIds.length}` : ""}
                                        </Button>
                                    </>
                                ) : null}
                                {previewPendingCount ? (
                                    <Tag className="m-0 px-2 py-1" color="processing">
                                        生成中 {previewPendingCount}
                                    </Tag>
                                ) : null}
                                {activeVideoCount ? (
                                    <Tag className="m-0 px-2 py-1">
                                        运行 {activeVideoCount}/{videoConcurrencyLimit}
                                    </Tag>
                                ) : null}
                            </div>
                        </div>
                        {results.length ? (
                            <div className={results.length === 1 ? "grid max-w-[360px] gap-4" : "grid w-full grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3"}>
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard
                                            key={result.id}
                                            video={result.video}
                                            large={results.length === 1}
                                            selected={selectedResultIds.includes(result.id)}
                                            onSelectedChange={(checked) => toggleResultSelected(result.id, checked)}
                                            onDownload={downloadVideo}
                                            onSaveAsset={saveResultToAssets}
                                        />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || "生成失败"} selected={selectedResultIds.includes(result.id)} onSelectedChange={(checked) => toggleResultSelected(result.id, checked)} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成视频" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title="生成记录" placement="bottom" size="min(86dvh, 720px)" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <div className="thin-scrollbar h-full overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                    />
                </div>
            </Drawer>
            <Drawer title="参数" placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            {promptDialogOpen ? <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} /> : null}
            {assetPickerOpen ? <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} /> : null}
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(true)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
            </div>
        </>
    );
}

function ResultVideoCard({
    video,
    large,
    selected,
    onSelectedChange,
    onDownload,
    onSaveAsset,
}: {
    video: GeneratedVideo;
    large?: boolean;
    selected?: boolean;
    onSelectedChange?: (checked: boolean) => void;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => void;
}) {
    const source = videoFallbackSource(video);
    return (
        <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className={`${large ? "h-[240px]" : "h-[220px]"} flex w-full items-center justify-center bg-black`}>
                <video src={video.url} controls className="h-full w-full object-contain" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <Tag color={source.color} className="m-0">
                        {source.label}
                    </Tag>
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        添加到素材
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

function videoFallbackSource(video: GeneratedVideo): { label: string; color: string } {
    const value = video.url || "";
    if (value.startsWith("data:") || value.startsWith("blob:")) return { label: "本地缓存", color: "green" };
    if (isRemoteMediaUrl(video.remoteUrl || "") || isRemoteMediaUrl(value)) return { label: "远程地址", color: "blue" };
    if (isServerMediaUrl(video.serverUrl || "") || isServerMediaUrl(value)) return { label: "服务器副本", color: "purple" };
    if (video.storageKey) return { label: "本地缓存", color: "green" };
    return { label: "未知来源", color: "default" };
}

function PendingVideoCard() {
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, selected, onSelectedChange, onRetry }: { error: string; selected?: boolean; onSelectedChange?: (checked: boolean) => void; onRetry: () => void }) {
    const failure = videoFailureDisplay(error);
    return (
        <div className="relative overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{failure.title}</div>
                <div className="text-xs text-red-500/80 dark:text-red-300/80">{failure.hint}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    重试
                </Button>
            </div>
        </div>
    );
}

function videoFailureDisplay(error: string) {
    if (error.startsWith("上游生成阶段失败")) return { title: "上游生成失败", hint: "任务已创建，但上游生成阶段失败。" };
    if (error.startsWith("视频任务创建失败") || error.startsWith("Seedance 任务创建失败")) return { title: "任务创建失败", hint: "本地请求未能成功创建上游任务。" };
    if (error.startsWith("视频任务查询失败") || error.startsWith("Seedance 任务查询失败")) return { title: "任务查询失败", hint: "任务已提交后，轮询上游状态失败。" };
    return { title: "生成失败", hint: "请检查模型、额度和接口返回。" };
}

function ResultSelectCheckbox({ selected, onSelectedChange }: { selected?: boolean; onSelectedChange?: (checked: boolean) => void }) {
    if (!onSelectedChange) return null;
    return (
        <button
            type="button"
            aria-label="选择生成结果"
            aria-pressed={Boolean(selected)}
            className={`absolute left-2 top-2 z-10 inline-flex size-6 items-center justify-center rounded-lg border shadow-sm backdrop-blur transition ${selected ? "border-stone-400 bg-white text-stone-950 shadow-stone-950/15 dark:border-white/70 dark:bg-black/45 dark:text-white dark:shadow-black/45" : "border-stone-300 bg-white/70 hover:border-stone-500 dark:border-white/55 dark:bg-black/45 dark:hover:border-white"}`}
            onClick={(event) => {
                event.stopPropagation();
                onSelectedChange(!selected);
            }}
        >
            {selected ? <Check className="size-3.5 stroke-[3]" /> : null}
        </button>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
    onRenameLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
    onRenameLog: (log: GenerationLog, title: string) => void;
}) {
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">生成记录</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    新建
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? "取消" : "全选"}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    删除
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                        onRename={(title) => onRenameLog(log, title)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick, onRename }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void; onRename: (title: string) => void }) {
    const [editingTitle, setEditingTitle] = useState(false);
    const [draftTitle, setDraftTitle] = useState(log.title);

    useEffect(() => {
        if (!editingTitle) setDraftTitle(log.title);
    }, [editingTitle, log.title]);

    const commitTitle = () => {
        const nextTitle = draftTitle.trim();
        setEditingTitle(false);
        if (!nextTitle) {
            setDraftTitle(log.title);
            return;
        }
        if (nextTitle !== log.title) onRename(nextTitle);
    };

    return (
        <div
            role="button"
            tabIndex={0}
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick();
            }}
        >
            <div className="grid min-w-0 gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        {editingTitle ? (
                            <Input
                                size="small"
                                autoFocus
                                value={draftTitle}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                onBlur={commitTitle}
                                onPressEnter={commitTitle}
                                onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === "Escape") {
                                        setDraftTitle(log.title);
                                        setEditingTitle(false);
                                    }
                                }}
                            />
                        ) : (
                            <div className="flex min-w-0 items-center gap-1">
                                <div className="truncate text-sm font-semibold leading-5" title={log.title}>
                                    {log.title}
                                </div>
                                <Button
                                    aria-label="编辑记录标题"
                                    type="text"
                                    size="small"
                                    className="!h-6 !w-6 !min-w-6 shrink-0 !p-0"
                                    icon={<PenLine className="size-3.5" />}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setDraftTitle(log.title);
                                        setEditingTitle(true);
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
                <div className="grid min-w-0 gap-2 pl-7">
                    <div className="flex min-w-0 flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "成功" ? "blue" : log.status === "生成中" ? "processing" : "red"}>
                            {log.status}
                        </Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                </div>
            </div>
        </div>
    );
}

async function readStoredLogs(userId: string) {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        const orphanKeys: string[] = [];
        await globalLogStore.iterate<GenerationLog, void>((value, key) => {
            if (!value?.ownerUserId) {
                orphanKeys.push(key);
                return;
            }
            logs.push(value);
        });
        await Promise.all(orphanKeys.map((key) => globalLogStore.removeItem(key).catch(() => undefined)));
        const ownedLogs = logs.filter((log) => log.ownerUserId === userId);
        const [localLogs, remoteLogs] = await Promise.all([Promise.all(ownedLogs.map(normalizeLog)), readServerVideoLogs()]);
        const ownedRemoteLogs = remoteLogs.map((log) => withLogOwner(log, userId));
        const merged = new Map<string, GenerationLog>();
        ownedRemoteLogs.forEach((log) => merged.set(log.id, log));
        localLogs.forEach((log) => merged.set(log.id, log));
        const nextLogs = Array.from(merged.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        await Promise.all(nextLogs.filter((log) => !ownedLogs.some((item) => item.id === log.id)).map((log) => globalLogStore.setItem(log.id, serializeLog(log)).catch(() => undefined)));
        return nextLogs;
    } catch {
        return [];
    }
}

function withLogOwner(log: GenerationLog, userId: string): GenerationLog {
    return userId ? { ...log, ownerUserId: userId } : log;
}

async function readServerVideoLogs() {
    try {
        const payload = await listGenerationLogs({ kind: "video", source: "video-workbench", pageSize: 100 });
        return Promise.all(payload.items.filter((item) => item.id.startsWith("video-workbench:")).map(serverVideoLogToWorkbenchLog));
    } catch {
        return [];
    }
}

async function serverVideoLogToWorkbenchLog(record: StoredGenerationLogRecord): Promise<GenerationLog> {
    const createdAt = Date.parse(record.createdAt) || Date.now();
    const asset = record.assets[0];
    const url = asset ? browserReadableMediaUrl(asset.remoteUrl || asset.serverUrl || asset.url || "") : "";
    const video: GeneratedVideo | undefined =
        asset && url
            ? {
                  id: serverVideoLogId(record),
                  url,
                  remoteUrl: asset.remoteUrl,
                  serverUrl: asset.serverUrl,
                  storageKey: "",
                  durationMs: record.durationMs || 0,
                  width: asset.width || 0,
                  height: asset.height || 0,
                  bytes: asset.bytes || 0,
                  mimeType: asset.mimeType || "video/mp4",
              }
            : undefined;
    return normalizeLog({
        id: serverVideoLogId(record),
        createdAt,
        title: record.title || record.prompt || record.model,
        prompt: record.prompt,
        time: new Date(createdAt).toLocaleString("zh-CN", { hour12: false }),
        model: record.model,
        config: { model: record.model, videoModel: record.model, size: "", vquality: "", videoSeconds: "", videoGenerateAudio: "true", videoWatermark: "false" },
        references: [],
        videoReferences: [],
        audioReferences: [],
        durationMs: record.durationMs || 0,
        size: "",
        resolution: "",
        seconds: "",
        status: record.status === "pending" ? "生成中" : record.status === "failed" ? "失败" : "成功",
        video,
        error: record.error,
        resultDeleted: !video && record.status === "success",
    });
}

function serverVideoLogId(record: StoredGenerationLogRecord) {
    return record.id.replace(/^video-workbench:/, "");
}

async function recordVideoGenerationLog(log: GenerationLog) {
    const video = log.video;
    const assetUrl = video?.remoteUrl || video?.serverUrl || (video?.url && !video.url.startsWith("blob:") ? video.url : "");
    return recordGenerationLog({
        id: `video-workbench:${log.id}`,
        kind: "video",
        source: "video-workbench",
        status: log.status === "成功" ? "success" : log.status === "失败" ? "failed" : "pending",
        title: log.title,
        prompt: log.prompt,
        model: log.model || log.config.videoModel || log.config.model,
        summary: log.status === "成功" ? "视频生成完成" : log.status === "失败" ? "视频生成失败" : "视频生成中",
        durationMs: log.durationMs,
        count: 1,
        successCount: log.status === "成功" ? 1 : 0,
        failCount: log.status === "失败" ? 1 : 0,
        assets: assetUrl
            ? [
                  {
                      type: "video",
                      url: assetUrl,
                      remoteUrl: video?.remoteUrl,
                      serverUrl: video?.serverUrl,
                      mimeType: video?.mimeType,
                      width: video?.width,
                      height: video?.height,
                      bytes: video?.bytes,
                  },
              ]
            : [],
        error: log.error,
        createdAt: log.createdAt,
        completedAt: Date.now(),
    })
        .then((log) => log.assets[0])
        .catch(() => undefined);
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const videoFallback = generatedVideoFallback(log.video);
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, videoFallback) } : log.video ? { ...log.video, url: browserReadableMediaUrl(videoFallback || log.video.url || "") } : undefined;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : browserReadableMediaUrl(item.url),
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : browserReadableMediaUrl(item.url),
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        ownerUserId: log.ownerUserId,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task,
        video,
        error: log.error,
        resultDeleted: Boolean(log.resultDeleted),
    };
}

function generatedVideoFallback(video?: Partial<GeneratedVideo>) {
    const value = video?.url || "";
    const localValue = value.startsWith("data:") ? value : "";
    const remoteUrl = isRemoteMediaUrl(video?.remoteUrl || "") ? video?.remoteUrl || "" : isRemoteMediaUrl(value) ? value : "";
    const serverUrl = isServerMediaUrl(video?.serverUrl || "") ? video?.serverUrl || "" : isServerMediaUrl(value) ? value : "";
    return localValue || remoteUrl || serverUrl || (value && !value.startsWith("blob:") ? value : "");
}

function isRemoteMediaUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

function isServerMediaUrl(value: string) {
    return value.startsWith("/api/generation-log-assets/");
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function resultsFromLog(log: GenerationLog): GenerationResult[] {
    if (log.resultDeleted) return [];
    if (log.status === "生成中" && log.task) return [{ id: log.id, status: "pending" }];
    if (log.video) return [{ id: log.video.id, status: "success", video: log.video }];
    if (log.error) return [{ id: log.id, status: "failed", error: log.error }];
    return [];
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考音频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !text-stone-900 !shadow-sm disabled:!text-stone-400 dark:!text-stone-900"
                icon={<ArrowLeft className="size-3" />}
                disabled={index <= 0}
                onClick={() => onMove(-1)}
            />
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !text-stone-900 !shadow-sm disabled:!text-stone-400 dark:!text-stone-900"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={() => onMove(1)}
            />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const seedance = isSeedanceVideoConfig({ ...config, model });
    return {
        ...config,
        model,
        videoModel: model,
        size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 5);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
