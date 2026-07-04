import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { resolveServerDataPath } from "@/lib/server/data-dir";

export type GenerationLogKind = "image" | "video";
export type GenerationLogSource = "image-workbench" | "video-workbench" | "canvas" | "unknown";
export type GenerationLogStatus = "pending" | "success" | "failed";

export type GenerationLogAsset = {
    type: GenerationLogKind;
    url: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
};

export type StoredGenerationLog = {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    kind: GenerationLogKind;
    source: GenerationLogSource;
    status: GenerationLogStatus;
    title: string;
    prompt: string;
    model: string;
    summary: string;
    durationMs: number;
    count: number;
    successCount: number;
    failCount: number;
    assets: GenerationLogAsset[];
    taskId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
};

export type GenerationLogInput = Partial<Pick<StoredGenerationLog, "id" | "taskId" | "title" | "summary" | "error">> & {
    userId: string;
    username: string;
    displayName: string;
    kind: GenerationLogKind;
    source?: GenerationLogSource;
    status: GenerationLogStatus;
    prompt?: string;
    model?: string;
    durationMs?: number;
    count?: number;
    successCount?: number;
    failCount?: number;
    assets?: Array<Partial<GenerationLogAsset> & { url?: string }>;
    createdAt?: string | number;
    completedAt?: string | number;
};

export type GenerationLogListOptions = {
    page?: number;
    pageSize?: number;
    keyword?: string;
    kind?: string;
    source?: string;
    status?: string;
    userId?: string;
    start?: string;
    end?: string;
};

type GenerationLogDatabase = {
    version: 1;
    logs: StoredGenerationLog[];
};

const LOG_DATA_FILE = resolveServerDataPath("generation-logs.json");
const ASSET_ROOT = resolveServerDataPath("generation-assets");
const MAX_LOGS = 20000;

let mutationQueue = Promise.resolve();

export async function listGenerationLogs(options: GenerationLogListOptions = {}) {
    const db = await readGenerationLogDb();
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(options.pageSize) || 20)));
    const keyword = (options.keyword || "").trim().toLowerCase();
    const startMs = parseDateStart(options.start);
    const endMs = parseDateEnd(options.end);

    const filtered = db.logs
        .filter((log) => (isGenerationKind(options.kind) ? log.kind === options.kind : true))
        .filter((log) => (isGenerationSource(options.source) ? log.source === options.source : true))
        .filter((log) => (isGenerationStatus(options.status) ? log.status === options.status : true))
        .filter((log) => (options.userId ? log.userId === options.userId : true))
        .filter((log) => {
            const time = Date.parse(log.createdAt);
            if (startMs && time < startMs) return false;
            if (endMs && time > endMs) return false;
            return true;
        })
        .filter((log) => {
            if (!keyword) return true;
            return [log.displayName, log.username, log.prompt, log.model, log.title, log.summary, sourceLabel(log.source), kindLabel(log.kind)]
                .join(" ")
                .toLowerCase()
                .includes(keyword);
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    return { items: filtered.slice(startIndex, startIndex + pageSize), total, page, pageSize };
}

export async function recordGenerationLog(input: GenerationLogInput) {
    return mutateGenerationLogDb(async (db) => {
        const now = new Date().toISOString();
        const id = normalizeText(input.id, randomUUID(), 120);
        const existing = db.logs.find((log) => log.id === id);
        const assets = await normalizeAssets(input.assets || []);
        const createdAt = normalizeTime(input.createdAt, existing?.createdAt || now);
        const completedAt = input.status === "pending" ? undefined : normalizeTime(input.completedAt, now);
        const next: StoredGenerationLog = {
            id,
            userId: normalizeText(input.userId, existing?.userId || "", 120),
            username: normalizeText(input.username, existing?.username || "", 80),
            displayName: normalizeText(input.displayName, existing?.displayName || input.username || "未知用户", 80),
            kind: input.kind,
            source: input.source || existing?.source || "unknown",
            status: input.status,
            title: normalizeText(input.title, existing?.title || input.prompt || "未命名记录", 80),
            prompt: normalizeText(input.prompt, existing?.prompt || "", 5000),
            model: normalizeText(input.model, existing?.model || "", 160),
            summary: normalizeText(input.summary, existing?.summary || defaultSummary(input.kind, input.status), 160),
            durationMs: normalizeNonNegativeNumber(input.durationMs, existing?.durationMs || 0),
            count: normalizePositiveInteger(input.count, existing?.count || 1),
            successCount: normalizeNonNegativeInteger(input.successCount, existing?.successCount || (input.status === "success" ? 1 : 0)),
            failCount: normalizeNonNegativeInteger(input.failCount, existing?.failCount || (input.status === "failed" ? 1 : 0)),
            assets: assets.length ? assets : existing?.assets || [],
            taskId: normalizeOptionalText(input.taskId, existing?.taskId, 160),
            error: normalizeOptionalText(input.error, existing?.error, 1000),
            createdAt,
            updatedAt: now,
            completedAt,
        };

        db.logs = [next, ...db.logs.filter((log) => log.id !== id)].slice(0, MAX_LOGS);
        return next;
    });
}

export async function deleteGenerationLogs(ids: string[]) {
    const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!normalizedIds.length) return { deleted: 0 };
    return mutateGenerationLogDb(async (db) => {
        const idSet = new Set(normalizedIds);
        const removed = db.logs.filter((log) => idSet.has(log.id));
        db.logs = db.logs.filter((log) => !idSet.has(log.id));
        await Promise.all(removed.flatMap((log) => log.assets.map((asset) => deleteLocalAsset(asset.url))));
        return { deleted: removed.length };
    });
}

export function sourceLabel(source: GenerationLogSource) {
    if (source === "image-workbench") return "生图工作台";
    if (source === "video-workbench") return "视频创作台";
    if (source === "canvas") return "画布";
    return "未知入口";
}

export function kindLabel(kind: GenerationLogKind) {
    return kind === "video" ? "视频" : "图片";
}

export function isGenerationKind(value?: string): value is GenerationLogKind {
    return value === "image" || value === "video";
}

export function isGenerationSource(value?: string): value is GenerationLogSource {
    return value === "image-workbench" || value === "video-workbench" || value === "canvas" || value === "unknown";
}

export function isGenerationStatus(value?: string): value is GenerationLogStatus {
    return value === "pending" || value === "success" || value === "failed";
}

async function normalizeAssets(assets: Array<Partial<GenerationLogAsset> & { url?: string }>) {
    const normalized: GenerationLogAsset[] = [];
    for (const asset of assets.slice(0, 6)) {
        const type = asset.type === "video" ? "video" : "image";
        const url = (asset.url || "").trim();
        if (!url || url.startsWith("blob:")) continue;
        if (url.startsWith("data:")) {
            const stored = await writeDataUrlAsset(url, type);
            if (stored) normalized.push({ ...stored, width: toOptionalNumber(asset.width), height: toOptionalNumber(asset.height) });
            continue;
        }
        normalized.push({
            type,
            url: normalizeText(url, "", 4000),
            mimeType: normalizeOptionalText(asset.mimeType, undefined, 120),
            width: toOptionalNumber(asset.width),
            height: toOptionalNumber(asset.height),
            bytes: toOptionalNumber(asset.bytes),
        });
    }
    return normalized;
}

async function writeDataUrlAsset(dataUrl: string, type: GenerationLogKind): Promise<GenerationLogAsset | null> {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1] || (type === "video" ? "video/mp4" : "image/png");
    const bytes = Buffer.from(match[2], "base64");
    const folder = type === "video" ? "videos" : "images";
    const extension = extensionFromMime(mimeType, type);
    const fileName = `${randomUUID()}${extension}`;
    const filePath = resolve(ASSET_ROOT, folder, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    return { type, url: `/api/generation-log-assets/${folder}/${fileName}`, mimeType, bytes: bytes.length };
}

async function deleteLocalAsset(url: string) {
    if (!url.startsWith("/api/generation-log-assets/")) return;
    const relative = url.replace("/api/generation-log-assets/", "");
    const filePath = resolve(ASSET_ROOT, relative);
    const root = resolve(ASSET_ROOT);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return;
    await unlink(filePath).catch(() => undefined);
}

async function readGenerationLogDb(): Promise<GenerationLogDatabase> {
    try {
        const raw = await readFile(LOG_DATA_FILE, "utf8");
        return normalizeDb(JSON.parse(raw) as Partial<GenerationLogDatabase>);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
        throw error;
    }
}

async function mutateGenerationLogDb<T>(mutator: (db: GenerationLogDatabase) => T | Promise<T>) {
    const run = mutationQueue.then(async () => {
        const db = await readGenerationLogDb();
        const result = await mutator(db);
        await writeGenerationLogDb(db);
        return result;
    });
    mutationQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

async function writeGenerationLogDb(db: GenerationLogDatabase) {
    await mkdir(dirname(LOG_DATA_FILE), { recursive: true });
    await writeFile(LOG_DATA_FILE, `${JSON.stringify(normalizeDb(db), null, 2)}\n`, "utf8");
}

function normalizeDb(db: Partial<GenerationLogDatabase>): GenerationLogDatabase {
    return {
        version: 1,
        logs: Array.isArray(db.logs) ? db.logs.map(normalizeStoredLog).filter(Boolean).slice(0, MAX_LOGS) : [],
    };
}

function normalizeStoredLog(log: Partial<StoredGenerationLog>): StoredGenerationLog {
    const kind = isGenerationKind(log.kind) ? log.kind : "image";
    const status = isGenerationStatus(log.status) ? log.status : "success";
    return {
        id: normalizeText(log.id, randomUUID(), 120),
        userId: normalizeText(log.userId, "", 120),
        username: normalizeText(log.username, "", 80),
        displayName: normalizeText(log.displayName, log.username || "未知用户", 80),
        kind,
        source: isGenerationSource(log.source) ? log.source : "unknown",
        status,
        title: normalizeText(log.title, "未命名记录", 80),
        prompt: normalizeText(log.prompt, "", 5000),
        model: normalizeText(log.model, "", 160),
        summary: normalizeText(log.summary, defaultSummary(kind, status), 160),
        durationMs: normalizeNonNegativeNumber(log.durationMs, 0),
        count: normalizePositiveInteger(log.count, 1),
        successCount: normalizeNonNegativeInteger(log.successCount, status === "success" ? 1 : 0),
        failCount: normalizeNonNegativeInteger(log.failCount, status === "failed" ? 1 : 0),
        assets: Array.isArray(log.assets) ? log.assets.filter((asset) => asset?.url).slice(0, 6).map((asset) => ({ ...asset, type: asset.type === "video" ? "video" : "image" })) : [],
        taskId: normalizeOptionalText(log.taskId, undefined, 160),
        error: normalizeOptionalText(log.error, undefined, 1000),
        createdAt: normalizeTime(log.createdAt, new Date().toISOString()),
        updatedAt: normalizeTime(log.updatedAt, log.createdAt || new Date().toISOString()),
        completedAt: log.completedAt ? normalizeTime(log.completedAt, log.completedAt) : undefined,
    };
}

function emptyDb(): GenerationLogDatabase {
    return { version: 1, logs: [] };
}

function defaultSummary(kind: GenerationLogKind, status: GenerationLogStatus) {
    const type = kind === "video" ? "视频" : "图片";
    if (status === "failed") return `${type}生成失败`;
    if (status === "pending") return `${type}生成中`;
    return `${type}生成完成`;
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback).slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, fallback: string | undefined, maxLength: number) {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, maxLength) : fallback;
}

function normalizeTime(value: unknown, fallback: string | number) {
    const raw = typeof value === "number" ? value : typeof value === "string" ? value : fallback;
    const date = typeof raw === "number" ? new Date(raw) : new Date(raw);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function normalizeNonNegativeNumber(value: unknown, fallback: number) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Math.round(numberValue) : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number) {
    const numberValue = Math.floor(Number(value));
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
    const numberValue = Math.floor(Number(value));
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback;
}

function toOptionalNumber(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function parseDateStart(value?: string) {
    if (!value) return 0;
    const date = new Date(`${value}T00:00:00`);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function parseDateEnd(value?: string) {
    if (!value) return 0;
    const date = new Date(`${value}T23:59:59.999`);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function extensionFromMime(mimeType: string, type: GenerationLogKind) {
    const fromMime = mimeType.includes("/") ? `.${mimeType.split("/")[1].split(";")[0].replace("jpeg", "jpg")}` : "";
    const clean = fromMime && /^[a-z0-9.]+$/i.test(fromMime) ? fromMime : "";
    if (clean && clean.length > 1) return clean;
    return type === "video" ? ".mp4" : ".png";
}
