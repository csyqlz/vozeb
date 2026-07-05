"use client";

import { ArrowLeft, ArrowRight, BookOpen, Check, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { requestCreditCost } from "@/constant/credits";
import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration, readImageMeta } from "@/lib/image-utils";
import { APP_STORAGE_NAME, LEGACY_APP_STORAGE_NAME } from "@/lib/storage-keys";
import { createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    remoteUrl?: string;
    storageKey?: string;
    slotIndex?: number;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

type PendingImageTask = {
    resultId: string;
    taskId: string;
    kind: "generation" | "edit";
    model: string;
    index: number;
    startedAt: number;
};

type GenerationFailure = {
    resultId: string;
    index: number;
    error: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
    task?: PendingImageTask;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "成功" | "失败" | "生成中";
    images: GeneratedImage[];
    thumbnails: string[];
    pendingCount?: number;
    error?: string;
    imageTasks?: PendingImageTask[];
    failures?: GenerationFailure[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;
type GenerationSnapshot = { text: string; config: AiConfig; references: ReferenceImage[] };

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: APP_STORAGE_NAME, storeName: "image_generation_logs" });
const legacyLogStore = localforage.createInstance({ name: LEGACY_APP_STORAGE_NAME, storeName: "image_generation_logs" });
const loadPromptSelectDialog = () => import("@/components/prompts/prompt-select-dialog").then((module) => module.PromptSelectDialog);
const loadAssetPickerModal = () => import("@/app/(user)/canvas/components/asset-picker-modal").then((module) => module.AssetPickerModal);
const PromptSelectDialog = dynamic(loadPromptSelectDialog, { ssr: false, loading: () => null });
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

export default function ImagePage() {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
    const [missingResultIds, setMissingResultIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const resultsByLogIdRef = useRef(new Map<string, GenerationResult[]>());
    const logsRef = useRef<GenerationLog[]>([]);
    const activeLogIdRef = useRef<string | null>(null);
    const taskControllersRef = useRef(new Map<string, AbortController>());
    const logWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
    const deletedResultIdsRef = useRef(new Set<string>());
    const activeImageTasksRef = useRef(0);
    const imageTaskQueueRef = useRef<Array<() => void>>([]);
    const imageConcurrencyLimitRef = useRef(4);
    const [activeImageTasks, setActiveImageTasks] = useState(0);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const imageConcurrencyLimit = Math.max(1, Math.min(10, Math.floor(Number(effectiveConfig.generationConcurrency?.image) || 4)));
    const previewPendingCount = results.filter((result) => result.status === "pending").length;
    const pointsCost = requestCreditCost({ apiSource: effectiveConfig.apiSource, modelPointCosts: effectiveConfig.modelPointCosts, model, count: generationCount });

    useEffect(() => {
        void refreshLogs();
    }, []);

    useEffect(() => {
        return preloadOnIdle(() => {
            void loadPromptSelectDialog();
            void loadAssetPickerModal();
        });
    }, []);

    useEffect(() => {
        imageConcurrencyLimitRef.current = imageConcurrencyLimit;
        startQueuedImageTasks();
    }, [imageConcurrencyLimit]);

    useEffect(() => {
        const visibleIds = new Set(results.map((result) => result.id));
        setMissingResultIds((ids) => ids.filter((id) => visibleIds.has(id)));
    }, [results]);

    useEffect(() => {
        return () => {
            taskControllersRef.current.forEach((controller) => controller.abort());
            taskControllersRef.current.clear();
            imageTaskQueueRef.current.splice(0);
        };
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
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
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    function replaceLogs(nextLogs: GenerationLog[]) {
        logsRef.current = nextLogs;
        setLogs(nextLogs);
        const activeLogId = activeLogIdRef.current;
        if (activeLogId) {
            const nextActiveLog = nextLogs.find((log) => log.id === activeLogId);
            if (nextActiveLog) setPreviewLog(nextActiveLog);
        }
        resumePendingLogs(nextLogs);
    }

    function upsertLog(log: GenerationLog) {
        replaceLogs([log, ...logsRef.current.filter((item) => item.id !== log.id)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        if (activeLogIdRef.current === log.id) setPreviewLog(log);
    }

    const saveLog = async (log: GenerationLog) => {
        upsertLog(log);
        const previousWrite = logWriteQueuesRef.current.get(log.id) || Promise.resolve();
        const nextWrite = previousWrite.catch(() => {}).then(() => logStore.setItem(log.id, serializeLog(log)));
        logWriteQueuesRef.current.set(log.id, nextWrite);
        await nextWrite;
        if (logWriteQueuesRef.current.get(log.id) === nextWrite) logWriteQueuesRef.current.delete(log.id);
    };

    function getLatestLog(logId: string) {
        return logsRef.current.find((log) => log.id === logId) || null;
    }

    function getLogResults(log: GenerationLog) {
        const cached = resultsByLogIdRef.current.get(log.id);
        if (cached) return cached;
        const nextResults = resultsFromLog(log);
        resultsByLogIdRef.current.set(log.id, nextResults);
        return nextResults;
    }

    function setLogResults(logId: string, nextResults: GenerationResult[]) {
        resultsByLogIdRef.current.set(logId, nextResults);
        if (activeLogIdRef.current === logId) setResults(nextResults);
    }

    function persistLogResults(logId: string, snapshot: GenerationSnapshot, nextResults: GenerationResult[], durationMs: number, error?: string) {
        const baseLog = getLatestLog(logId);
        if (!baseLog) return null;
        const nextLog = buildLogFromResults(baseLog, snapshot, nextResults, durationMs, String(Math.max(1, nextResults.length)), error);
        void saveLog(nextLog);
        return nextLog;
    }

    function patchLogResult(logId: string, resultId: string, patch: Partial<GenerationResult>, snapshot: GenerationSnapshot, durationMs: number, fallbackIndex = 0) {
        const log = getLatestLog(logId);
        if (!log) return [];
        if (deletedResultIdsRef.current.has(`${logId}:${resultId}`)) return getLogResults(log);
        const currentResults = getLogResults(log);
        let matched = false;
        const nextResults = currentResults.map((item) => {
            if (item.id !== resultId) return item;
            matched = true;
            return { ...item, ...patch, id: resultId };
        });
        if (!matched) {
            nextResults.push({ id: resultId, status: patch.status || "pending", ...patch });
        }
        setLogResults(logId, nextResults);
        persistLogResults(logId, snapshot, nextResults, durationMs);
        return nextResults;
    }

    function patchLogResultAt(logId: string, index: number, patch: Partial<GenerationResult>, snapshot: GenerationSnapshot, durationMs: number) {
        const log = getLatestLog(logId);
        if (!log) return [];
        const currentResults = getLogResults(log);
        const nextResults = updateResultAt(currentResults, index, patch);
        setLogResults(logId, nextResults);
        persistLogResults(logId, snapshot, nextResults, durationMs);
        return nextResults;
    }

    function reserveImageTaskSlot() {
        const nextActive = activeImageTasksRef.current + 1;
        activeImageTasksRef.current = nextActive;
        setActiveImageTasks(nextActive);
    }

    function startQueuedImageTasks() {
        while (activeImageTasksRef.current < imageConcurrencyLimitRef.current && imageTaskQueueRef.current.length) {
            const resolve = imageTaskQueueRef.current.shift();
            if (!resolve) return;
            reserveImageTaskSlot();
            resolve();
        }
    }

    async function waitForImageTaskSlot() {
        if (activeImageTasksRef.current < imageConcurrencyLimitRef.current) {
            reserveImageTaskSlot();
            return;
        }
        await new Promise<void>((resolve) => imageTaskQueueRef.current.push(resolve));
    }

    function releaseImageTaskSlot() {
        const nextActive = Math.max(0, activeImageTasksRef.current - 1);
        activeImageTasksRef.current = nextActive;
        setActiveImageTasks(nextActive);
        startQueuedImageTasks();
    }

    async function runQueuedImageTask<T>(logId: string, resultId: string, worker: () => Promise<T>) {
        if (deletedResultIdsRef.current.has(`${logId}:${resultId}`)) return undefined;
        await waitForImageTaskSlot();
        try {
            if (deletedResultIdsRef.current.has(`${logId}:${resultId}`)) return undefined;
            return await worker();
        } finally {
            releaseImageTaskSlot();
        }
    }

    function resumePendingLogs(nextLogs: GenerationLog[]) {
        nextLogs.forEach((log) => {
            const snapshot = snapshotFromLog(log, effectiveConfig);
            (log.imageTasks || []).forEach((pendingTask) => {
                const controllerKey = `${log.id}:${pendingTask.resultId}:${pendingTask.taskId}`;
                if (taskControllersRef.current.has(controllerKey)) return;
                const controller = new AbortController();
                taskControllersRef.current.set(controllerKey, controller);
                void runQueuedImageTask(log.id, pendingTask.resultId, () => completeGenerationTask(log.id, pendingTask.resultId, pendingTask.index, snapshot, pendingTask, controller))
                    .catch((error) => {
                        if (controller.signal.aborted) return;
                        const durationMs = Math.max(log.durationMs || 0, Date.now() - pendingTask.startedAt);
                        patchLogResult(log.id, pendingTask.resultId, { status: "failed", error: error instanceof Error ? error.message : "生成失败", image: undefined, task: undefined }, snapshot, durationMs, pendingTask.index);
                    })
                    .finally(() => taskControllersRef.current.delete(controllerKey));
            });
        });
    }

    async function completeGenerationTask(logId: string, resultId: string, index: number, snapshot: GenerationSnapshot, pendingTask: PendingImageTask, controller?: AbortController) {
        const result = await waitForImageGenerationTask(snapshot.config, { id: pendingTask.taskId, kind: pendingTask.kind, model: pendingTask.model }, { signal: controller?.signal });
        const imageMeta = await normalizeGeneratedImage(result.dataUrl);
        const durationMs = Date.now() - pendingTask.startedAt;
        const nextImage: GeneratedImage = {
            id: resultId,
            dataUrl: imageMeta.url,
            remoteUrl: imageMeta.remoteUrl,
            storageKey: imageMeta.storageKey,
            slotIndex: index,
            durationMs,
            width: imageMeta.width,
            height: imageMeta.height,
            bytes: imageMeta.bytes,
            mimeType: imageMeta.mimeType,
        };
        patchLogResult(logId, resultId, { status: "success", image: nextImage, error: undefined, task: undefined }, snapshot, durationMs, index);
        return nextImage;
    }

    const generate = async () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;

        const existingLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        const baseResults = existingLog ? getLogResults(existingLog) : [];
        const batchStartedAt = performance.now();
        const baseDurationMs = existingLog?.durationMs || 0;
        const startedResults = [
            ...baseResults,
            ...Array.from({ length: generationCount }, (_, offset) => ({
                id: nanoid(),
                status: "pending" as const,
                task: undefined,
                error: undefined,
                image: undefined,
                slotIndex: baseResults.length + offset,
            })),
        ];
        const pendingLog = buildLogFromResults(existingLog, snapshot, startedResults, baseDurationMs, String(startedResults.length));
        const logId = pendingLog.id;

        setSelectedResultIds([]);
        setMissingResultIds([]);
        activeLogIdRef.current = logId;
        setPreviewLog(pendingLog);
        setLogResults(logId, startedResults);
        await saveLog(pendingLog);

        startedResults.slice(baseResults.length).forEach((result, offset) => {
            void runQueuedImageTask(logId, result.id, () => runGenerationSlot(logId, result.id, baseResults.length + offset, snapshot, batchStartedAt, baseDurationMs))
                .then((image) => {
                    if (image) message.success("图片已生成");
                })
                .catch((error) => {
                    if (!deletedResultIdsRef.current.has(`${logId}:${result.id}`)) message.error(error instanceof Error ? error.message : "生成失败");
                });
        });
        message.success("已加入当前用户生成队列");
    };

    const downloadImage = (image: GeneratedImage, index: number) => {
        if (!image.dataUrl) {
            message.error("本地图片已丢失，无法下载");
            return;
        }
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        if (!image.dataUrl) {
            message.error("本地图片已丢失，无法加入参考图");
            return;
        }
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success("已加入参考图");
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        if (!image.dataUrl) {
            message.error("本地图片已丢失，无法加入素材");
            return;
        }
        const stored = await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: `生成结果 ${index + 1}`,
            coverUrl: stored.url,
            tags: [],
            source: "生图工作台",
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt },
        });
        message.success("已加入我的素材");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning("生图工作台只能使用文本或图片素材");
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setResults([]);
        setSelectedLogIds([]);
        setSelectedResultIds([]);
        setPreviewLog(null);
        activeLogIdRef.current = null;
    };

    const deleteSelectedLogs = () => {
        const imageKeys = logs.filter((log) => selectedLogIds.includes(log.id)).flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        void Promise.all([deleteStoredImages(imageKeys), ...selectedLogIds.flatMap((id) => [logStore.removeItem(id), legacyLogStore.removeItem(id)])]).then(refreshLogs);
        selectedLogIds.forEach((id) => resultsByLogIdRef.current.delete(id));
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
            setSelectedResultIds([]);
            activeLogIdRef.current = null;
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const refreshLogs = async () => replaceLogs(await readStoredLogs());

    const previewGenerationLog = async (log: GenerationLog) => {
        const currentLog = getLatestLog(log.id) || log;
        activeLogIdRef.current = currentLog.id;
        setPreviewLog(currentLog);
        setLogsOpen(false);
        setPrompt(currentLog.prompt);
        setSelectedResultIds([]);
        if (currentLog.config.imageModel || currentLog.model) updateConfig("imageModel", currentLog.config.imageModel || currentLog.model);
        if (currentLog.config.quality) updateConfig("quality", currentLog.config.quality);
        if (currentLog.config.size) updateConfig("size", currentLog.config.size);
        if (currentLog.config.count) updateConfig("count", currentLog.config.count);
        setLogResults(currentLog.id, getLogResults(currentLog));
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (logId: string, resultId: string, index: number, snapshot: GenerationSnapshot, batchStartedAt: number, baseDurationMs: number) => {
        const itemStartedAt = Date.now();
        try {
            const latestTitle = getLatestLog(logId)?.title || snapshot.text.slice(0, 36) || "生图工作台";
            const task = await createImageGenerationTask(snapshot.config, snapshot.text, snapshot.references, undefined, { logSource: "image-workbench", logTitle: latestTitle });
            const pendingTask: PendingImageTask = { resultId, taskId: task.id, kind: task.kind, model: task.model, index, startedAt: itemStartedAt };
            const controllerKey = `${logId}:${resultId}:${task.id}`;
            const controller = new AbortController();
            taskControllersRef.current.set(controllerKey, controller);
            patchLogResult(logId, resultId, { status: "pending", task: pendingTask, error: undefined, image: undefined }, snapshot, baseDurationMs + performance.now() - batchStartedAt, index);
            return await completeGenerationTask(logId, resultId, index, snapshot, pendingTask, controller).finally(() => taskControllersRef.current.delete(controllerKey));
        } catch (error) {
            patchLogResult(logId, resultId, { status: "failed", error: error instanceof Error ? error.message : "生成失败", image: undefined, task: undefined }, snapshot, baseDurationMs + performance.now() - batchStartedAt, index);
            throw error;
        }
    };

    const retryResult = (index: number) => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog) return;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        const currentResult = getLogResults(currentLog)[index];
        if (!currentResult) return;
        const batchStartedAt = performance.now();
        patchLogResultAt(currentLog.id, index, { status: "pending", error: undefined, image: undefined, task: undefined }, snapshot, currentLog.durationMs || 0);
        void runQueuedImageTask(currentLog.id, currentResult.id, () => runGenerationSlot(currentLog.id, currentResult.id, index, snapshot, batchStartedAt, currentLog.durationMs || 0))
            .then((image) => {
                if (image) message.success("图片已重新生成");
            })
            .catch((error) => {
                if (!deletedResultIdsRef.current.has(`${currentLog.id}:${currentResult.id}`)) message.error(error instanceof Error ? error.message : "生成失败");
            });
    };

    const currentResultIds = results.map((result) => result.id);
    const selectedVisibleResultIds = selectedResultIds.filter((id) => currentResultIds.includes(id));
    const allResultsSelected = Boolean(results.length) && selectedVisibleResultIds.length === results.length;
    const missingVisibleResultIds = results.filter((result) => result.status === "success" && result.image && (!result.image.dataUrl || missingResultIds.includes(result.id))).map((result) => result.id);

    const toggleAllResults = () => {
        setSelectedResultIds(allResultsSelected ? [] : currentResultIds);
    };

    const toggleResultSelected = (id: string, checked: boolean) => {
        setSelectedResultIds((value) => (checked ? Array.from(new Set([...value, id])) : value.filter((item) => item !== id)));
    };

    const markResultMissing = (id: string) => {
        setMissingResultIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    };

    const deleteResultsByIds = async (ids: string[], successText?: string) => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog || !ids.length) return;
        const selectedIds = new Set(ids);
        const currentResults = getLogResults(currentLog);
        const removedResults = currentResults.filter((result) => selectedIds.has(result.id));
        const nextResults = currentResults.filter((result) => !selectedIds.has(result.id));
        const storageKeys = removedResults.flatMap((result) => (result.image?.storageKey ? [result.image.storageKey] : []));
        removedResults.forEach((result) => {
            deletedResultIdsRef.current.add(`${currentLog.id}:${result.id}`);
            if (!result.task) return;
            const controllerKey = `${currentLog.id}:${result.id}:${result.task.taskId}`;
            taskControllersRef.current.get(controllerKey)?.abort();
            taskControllersRef.current.delete(controllerKey);
        });
        const snapshot = snapshotFromLog(currentLog, effectiveConfig);
        const nextLog = buildLogFromResults(currentLog, snapshot, nextResults, currentLog.durationMs || 0, String(nextResults.length));
        setLogResults(currentLog.id, nextResults);
        setSelectedResultIds((value) => value.filter((id) => !selectedIds.has(id)));
        setMissingResultIds((value) => value.filter((id) => !selectedIds.has(id)));
        await Promise.all([deleteStoredImages(storageKeys), saveLog(nextLog)]);
        message.success(successText || `已删除 ${removedResults.length} 个结果`);
    };

    const deleteSelectedResults = async () => {
        await deleteResultsByIds(selectedVisibleResultIds);
    };

    const deleteMissingResults = async () => {
        await deleteResultsByIds(missingVisibleResultIds, `已清理 ${missingVisibleResultIds.length} 个丢失图片`);
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
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">生图工作台</h1>
                                </div>
                                <div className="flex shrink-0 gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        记录
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        参数
                                    </Button>
                                </div>
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
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder="描述画面主体、风格、构图、光线和用途" />
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
                                <div
                                    className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
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
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {effectiveConfig.size} · {effectiveConfig.quality}
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
                            <Button type="primary" size="large" block disabled={!canGenerate || activeImageTasks >= imageConcurrencyLimit} onClick={() => void generate()}>
                                <span className="inline-flex items-center justify-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                                        <Sparkles className="size-[17px]" />
                                        <span className="text-sm font-semibold leading-none">{pointsCost.toLocaleString()}</span>
                                    </span>
                                    <span>开始生成</span>
                                </span>
                            </Button>
                            {activeImageTasks ? (
                                <div className="mt-2 text-center text-xs text-stone-500 dark:text-stone-400">
                                    当前用户运行 {activeImageTasks}/{imageConcurrencyLimit}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold">生成结果</h2>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {results.length ? (
                                    <>
                                        <Button size="small" icon={<CheckSquare className="size-3.5" />} onClick={toggleAllResults}>
                                            {allResultsSelected ? "取消" : "全选"}
                                        </Button>
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedVisibleResultIds.length} onClick={() => void deleteSelectedResults()}>
                                            删除{selectedVisibleResultIds.length ? ` ${selectedVisibleResultIds.length}` : ""}
                                        </Button>
                                        {missingVisibleResultIds.length ? (
                                            <Button size="small" icon={<Trash2 className="size-3.5" />} onClick={() => void deleteMissingResults()}>
                                                清理丢失 {missingVisibleResultIds.length}
                                            </Button>
                                        ) : null}
                                    </>
                                ) : null}
                                {previewPendingCount ? (
                                    <span className="inline-flex h-7 items-center rounded-md bg-sky-50 px-2 text-xs font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/25">生成中 {previewPendingCount}</span>
                                ) : null}
                                {activeImageTasks ? (
                                    <span className="inline-flex h-7 items-center rounded-md bg-stone-100 px-2 text-xs font-medium text-stone-700 ring-1 ring-stone-200 dark:bg-white/10 dark:text-stone-200 dark:ring-white/10">
                                        运行 {activeImageTasks}/{imageConcurrencyLimit}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        {results.length ? (
                            <div className={results.length === 1 ? "grid max-w-[360px] gap-4" : "grid w-full grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3"}>
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard
                                            key={result.id}
                                            image={result.image}
                                            index={index}
                                            large={results.length === 1}
                                            missing={missingResultIds.includes(result.id) || !result.image.dataUrl}
                                            selected={selectedResultIds.includes(result.id)}
                                            onSelectedChange={(checked) => toggleResultSelected(result.id, checked)}
                                            onMissing={() => markResultMissing(result.id)}
                                            onEdit={addResultToReferences}
                                            onDownload={downloadImage}
                                            onSaveAsset={saveResultToAssets}
                                        />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard
                                            key={result.id}
                                            error={result.error || "生成失败"}
                                            large={results.length === 1}
                                            selected={selectedResultIds.includes(result.id)}
                                            onSelectedChange={(checked) => toggleResultSelected(result.id, checked)}
                                            onRetry={() => retryResult(index)}
                                        />
                                    ) : (
                                        <PendingImageCard key={result.id} large={results.length === 1} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成图片" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title="生成记录" placement="bottom" height="min(86dvh, 720px)" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <div className="thin-scrollbar h-full overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
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
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(true)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />
            </div>
        </>
    );
}

function ResultImageCard({
    image,
    index,
    large,
    missing,
    selected,
    onSelectedChange,
    onMissing,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    large?: boolean;
    missing?: boolean;
    selected?: boolean;
    onSelectedChange?: (checked: boolean) => void;
    onMissing?: () => void;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const hasImage = Boolean(image.dataUrl) && !missing;
    return (
        <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className={`${large ? "h-[240px]" : "h-[220px]"} flex w-full items-center justify-center bg-stone-50 dark:bg-stone-950`}>
                {hasImage ? (
                    <Image rootClassName="!h-full !w-full" src={image.dataUrl} alt={`生成结果 ${index + 1}`} className="!h-full !w-full object-contain" style={{ objectFit: "contain" }} onError={onMissing} />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-stone-500 dark:text-stone-400">
                        <ImagePlus className="size-8 text-stone-400" />
                        <span>图片已丢失</span>
                    </div>
                )}
            </div>
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title="添加到素材">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" disabled={!hasImage} icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            添加到素材
                        </Button>
                    </Tooltip>
                    <Tooltip title="加入参考图">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" disabled={!hasImage} icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            加入参考图
                        </Button>
                    </Tooltip>
                    <Tooltip title="下载">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" disabled={!hasImage} icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            下载
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ large }: { large?: boolean }) {
    return (
        <div className={`relative overflow-hidden rounded-lg border border-sky-200 bg-sky-50/80 dark:border-sky-500/25 dark:bg-sky-950/20 ${large ? "h-[240px]" : "h-[220px]"}`}>
            <div
                className="absolute inset-0 opacity-70 dark:opacity-40"
                style={{
                    backgroundImage: "linear-gradient(135deg, rgba(14,165,233,0.16) 0, rgba(14,165,233,0.16) 1px, transparent 1px, transparent 12px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-200">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, large, selected, onSelectedChange, onRetry }: { error: string; large?: boolean; selected?: boolean; onSelectedChange?: (checked: boolean) => void; onRetry: () => void }) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className={`flex flex-col items-center justify-center gap-3 p-5 text-center ${large ? "h-[240px]" : "h-[220px]"}`}>
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
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

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
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
                <div>
                    <h2 className="text-base font-semibold">生成记录</h2>
                </div>
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
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);
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
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <img key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="ml-6 mt-1 min-h-[62px] rounded-md border border-stone-200/70 bg-white/65 px-2.5 py-2 shadow-sm shadow-stone-200/30 dark:border-stone-800 dark:bg-stone-950/45 dark:shadow-black/10">
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-blue-50 px-1.5 text-xs font-medium leading-none text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">成功 {log.successCount ?? log.imageCount}</span>
                        {log.failCount ? <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-rose-50 px-1.5 text-xs font-medium leading-none text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">失败 {log.failCount}</span> : null}
                        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-stone-100 px-1.5 text-xs font-medium leading-none text-stone-700 dark:bg-white/10 dark:text-stone-200">{log.imageCount} 张</span>
                        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-lime-50 px-1.5 text-xs font-medium leading-none text-lime-700 dark:bg-lime-500/15 dark:text-lime-200">{formatDuration(log.durationMs)}</span>
                    </div>
                    <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs leading-5 text-stone-500 dark:text-stone-400">{log.time}</span>
                        {log.pendingCount ? (
                            <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-sky-50 px-1.5 text-xs font-medium leading-none text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/25">
                                生成中 {log.pendingCount}
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        if (!values.length) {
            await legacyLogStore.iterate<GenerationLog, void>((value, key) => {
                values.push(value);
                void logStore.setItem(key, value);
            });
        }
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await hydrateGeneratedImageUrl(item.storageKey, item.dataUrl, item.remoteUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    const imageTasks = (log.imageTasks || []).filter((task): task is PendingImageTask => Boolean(task?.resultId && task.taskId));
    const failures = (log.failures || []).filter((failure): failure is GenerationFailure => Boolean(failure?.resultId));
    const pendingCount = log.pendingCount ?? imageTasks.length;
    const failCount = log.failCount ?? failures.length;
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount,
        pendingCount,
        imageCount: log.imageCount || log.successCount || images.length + failCount + pendingCount,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: pendingCount ? "生成中" : log.status || "成功",
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        imageTasks,
        failures,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: isStableImageUrl(image.dataUrl) ? image.dataUrl : "" })),
        thumbnails: [],
    };
}

async function hydrateGeneratedImageUrl(storageKey?: string, fallback = "", remoteFallback = "") {
    if (!storageKey && isStableImageUrl(fallback)) return fallback;
    return resolveImageUrl(storageKey, fallback || remoteFallback);
}

async function normalizeGeneratedImage(url: string) {
    if (isRemoteImageUrl(url)) {
        try {
            const stored = await uploadImage(url);
            return { url: stored.url, remoteUrl: url, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, storageKey: stored.storageKey };
        } catch {
            const meta = await readImageMeta(url);
            return { url, remoteUrl: url, width: meta.width, height: meta.height, bytes: 0, mimeType: meta.mimeType, storageKey: undefined };
        }
    }
    const stored = await uploadImage(url);
    return { url: stored.url, remoteUrl: undefined, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, storageKey: stored.storageKey };
}

function isStableImageUrl(value?: string) {
    return Boolean(value && (value.startsWith("data:") || /^https?:\/\//i.test(value)));
}

function isRemoteImageUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

function resultsFromLog(log: GenerationLog): GenerationResult[] {
    const usedResultIds = new Set<string>();
    const entries: Array<{ index: number; result: GenerationResult }> = [];
    log.images.forEach((image, fallbackIndex) => {
        usedResultIds.add(image.id);
        entries.push({ index: image.slotIndex ?? fallbackIndex, result: { id: image.id, status: "success", image } });
    });
    (log.imageTasks || []).forEach((task, fallbackIndex) => {
        if (usedResultIds.has(task.resultId)) return;
        usedResultIds.add(task.resultId);
        entries.push({ index: task.index ?? entries.length + fallbackIndex, result: { id: task.resultId, status: "pending", task } });
    });
    (log.failures || []).forEach((failure, fallbackIndex) => {
        if (usedResultIds.has(failure.resultId)) return;
        usedResultIds.add(failure.resultId);
        entries.push({ index: failure.index ?? entries.length + fallbackIndex, result: { id: failure.resultId, status: "failed", error: failure.error || log.error || "生成失败" } });
    });
    const knownPendingCount = entries.filter((entry) => entry.result.status === "pending").length;
    const missingPendingCount = Math.max(0, (log.pendingCount || 0) - knownPendingCount);
    for (let index = 0; index < missingPendingCount; index += 1) {
        entries.push({ index: entries.length, result: { id: `${log.id}-pending-${index}`, status: "pending" } });
    }
    const knownFailureCount = entries.filter((entry) => entry.result.status === "failed").length;
    const missingFailureCount = Math.max(0, (log.failCount || 0) - knownFailureCount);
    for (let index = 0; index < missingFailureCount; index += 1) {
        entries.push({ index: entries.length, result: { id: `${log.id}-failed-${index}`, status: "failed", error: log.error || "生成失败" } });
    }
    return entries.sort((a, b) => a.index - b.index).map((entry) => entry.result);
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
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

function buildLogFromResults(baseLog: GenerationLog | null, snapshot: GenerationSnapshot, results: GenerationResult[], durationMs: number, count: string, error?: string): GenerationLog {
    const images = results.flatMap((item, index) => (item.status === "success" && item.image ? [{ ...item.image, id: item.id, slotIndex: item.image.slotIndex ?? index }] : []));
    const imageTasks = results.flatMap((item, index) => (item.status === "pending" && item.task ? [{ ...item.task, resultId: item.id, index }] : []));
    const failures = results.flatMap((item, index) => (item.status === "failed" ? [{ resultId: item.id, index, error: item.error || error || "生成失败" }] : []));
    const pendingCount = results.filter((item) => item.status === "pending").length;
    const failCount = failures.length;
    const logConfig = buildLogConfig(snapshot.config, count);
    const status: GenerationLog["status"] = pendingCount ? "生成中" : images.length ? "成功" : "失败";
    const errorMessage = error || failures[0]?.error;
    return buildLog({
        baseLog,
        prompt: snapshot.text,
        model: snapshot.config.imageModel || snapshot.config.model,
        config: logConfig,
        references: snapshot.references,
        durationMs,
        successCount: images.length,
        failCount,
        pendingCount,
        imageCount: Math.max(Number(count) || 0, results.length, images.length + failCount + pendingCount),
        status,
        images,
        imageTasks,
        failures,
        error: errorMessage,
    });
}

function buildLog({
    baseLog,
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    pendingCount,
    imageCount,
    status,
    images,
    imageTasks,
    failures,
    error,
}: {
    baseLog?: GenerationLog | null;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    pendingCount: number;
    imageCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    imageTasks: PendingImageTask[];
    failures: GenerationFailure[];
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        id: baseLog?.id || nanoid(),
        createdAt: baseLog?.createdAt || Date.now(),
        title: baseLog?.title || prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        pendingCount,
        imageCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        imageTasks,
        failures,
        error,
    };
}

function buildLogConfig(config: AiConfig, count: string): GenerationLogConfig {
    return {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count,
    };
}

function snapshotFromLog(log: GenerationLog, fallbackConfig: AiConfig): GenerationSnapshot {
    const model = log.config.imageModel || log.model || fallbackConfig.imageModel || fallbackConfig.model;
    return {
        text: log.prompt,
        references: log.references || [],
        config: {
            ...fallbackConfig,
            ...log.config,
            model,
            imageModel: model,
            count: "1",
        },
    };
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
