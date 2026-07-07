import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve, sep } from "node:path";

import { getAuthSettings, type GenerationAssetStorageSettings, type UserRole } from "@/lib/auth/store";
import { resolveServerDataPath } from "@/lib/server/data-dir";

export type GenerationLogKind = "image" | "video";
export type GenerationLogSource = "image-workbench" | "video-workbench" | "canvas" | "unknown";
export type GenerationLogStatus = "pending" | "success" | "failed";

export type GenerationLogAsset = {
    type: GenerationLogKind;
    url: string;
    remoteUrl?: string;
    serverUrl?: string;
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

export type GenerationAssetStats = {
    totalFiles: number;
    totalBytes: number;
    referencedFiles: number;
    referencedBytes: number;
    unreferencedFiles: number;
    unreferencedBytes: number;
    missingReferences: number;
};

type GenerationLogDatabase = {
    version: 1;
    logs: StoredGenerationLog[];
};

const LOG_DATA_FILE = resolveServerDataPath("generation-logs.json");
const ASSET_ROOT = resolveServerDataPath("generation-assets");
const MAX_LOGS = 20000;
const MAX_SERVER_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SERVER_VIDEO_BYTES = 300 * 1024 * 1024;
const SERVER_ASSET_DOWNLOAD_TIMEOUT_MS = 15000;

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
            return [log.displayName, log.username, log.prompt, log.model, log.title, log.summary, sourceLabel(log.source), kindLabel(log.kind)].join(" ").toLowerCase().includes(keyword);
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    return { items: filtered.slice(startIndex, startIndex + pageSize), total, page, pageSize };
}

export async function listUserGenerationLogsForDelete(userId: string, ids: string[]) {
    const targetUserId = userId.trim();
    const idSet = new Set(ids.map((id) => id.trim()).filter(Boolean));
    if (!targetUserId || !idSet.size) return [];

    const db = await readGenerationLogDb();
    const userLogs = db.logs.filter((log) => log.userId === targetUserId);
    const requestedLogs = userLogs.filter((log) => idSet.has(log.id));
    const assetUrls = new Set(requestedLogs.flatMap((log) => log.assets.map(stableAssetUrl).filter(Boolean)));

    return userLogs.filter((log) => idSet.has(log.id) || log.assets.some((asset) => assetUrls.has(stableAssetUrl(asset))));
}

export async function recordGenerationLog(input: GenerationLogInput) {
    return mutateGenerationLogDb(async (db) => {
        const now = new Date().toISOString();
        const id = normalizeText(input.id, randomUUID(), 120);
        const existing = db.logs.find((log) => log.id === id);
        if (existing && existing.userId !== input.userId) {
            throw new Error("generation log id belongs to another user");
        }
        const settings = await getAuthSettings().catch(() => null);
        const assets = await normalizeAssets(input.assets || [], settings?.generationAssetStorage);
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
        await Promise.all(removed.flatMap((log) => log.assets.flatMap(localAssetUrls).map(deleteLocalAsset)));
        return { deleted: removed.length };
    });
}

export async function deleteGenerationLogsByUserId(userId: string) {
    const targetUserId = userId.trim();
    if (!targetUserId) return { deleted: 0 };
    return mutateGenerationLogDb(async (db) => {
        const removed = db.logs.filter((log) => log.userId === targetUserId);
        db.logs = db.logs.filter((log) => log.userId !== targetUserId);
        await Promise.all(removed.flatMap((log) => log.assets.flatMap(localAssetUrls).map(deleteLocalAsset)));
        return { deleted: removed.length };
    });
}

export async function getGenerationAssetStats(): Promise<GenerationAssetStats> {
    const db = await readGenerationLogDb();
    const referenced = collectReferencedLocalAssetPaths(db);
    const files = await listLocalAssetFiles();
    const fileMap = new Map(files.map((file) => [file.path, file.bytes]));
    const referencedExisting = Array.from(referenced).filter((filePath) => fileMap.has(filePath));
    const referencedBytes = referencedExisting.reduce((total, filePath) => total + (fileMap.get(filePath) || 0), 0);
    const unreferencedFiles = files.filter((file) => !referenced.has(file.path));

    return {
        totalFiles: files.length,
        totalBytes: files.reduce((total, file) => total + file.bytes, 0),
        referencedFiles: referencedExisting.length,
        referencedBytes,
        unreferencedFiles: unreferencedFiles.length,
        unreferencedBytes: unreferencedFiles.reduce((total, file) => total + file.bytes, 0),
        missingReferences: Array.from(referenced).filter((filePath) => !fileMap.has(filePath)).length,
    };
}

export async function cleanupUnreferencedGenerationAssets() {
    const db = await readGenerationLogDb();
    const referenced = collectReferencedLocalAssetPaths(db);
    const files = await listLocalAssetFiles();
    const removable = files.filter((file) => !referenced.has(file.path));

    await Promise.all(removable.map((file) => unlink(file.path).catch(() => undefined)));

    return {
        deletedFiles: removable.length,
        deletedBytes: removable.reduce((total, file) => total + file.bytes, 0),
        stats: await getGenerationAssetStats(),
    };
}

export async function canAccessGenerationAsset(userId: string, role: UserRole, url: string) {
    if (role === "admin") return true;
    const [db, settings] = await Promise.all([readGenerationLogDb(), getAuthSettings().catch(() => null)]);
    return db.logs.some(
        (log) =>
            log.userId === userId &&
            log.assets.some((asset) => {
                const fallbackEnabled = shouldUseServerFallback(asset.type, settings?.generationAssetStorage);
                return fallbackEnabled && localAssetUrls(asset).includes(url);
            }),
    );
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

async function normalizeAssets(assets: Array<Partial<GenerationLogAsset> & { url?: string }>, settings?: GenerationAssetStorageSettings) {
    const normalized: GenerationLogAsset[] = [];
    for (const asset of assets.slice(0, 6)) {
        const type = asset.type === "video" ? "video" : "image";
        const sourceUrl = (asset.url || "").trim();
        const remoteUrl = normalizeRemoteUrl(asset.remoteUrl || (isRemoteAssetUrl(sourceUrl) ? sourceUrl : ""));
        const existingServerUrl = normalizeServerAssetUrl(asset.serverUrl || (isServerAssetUrl(sourceUrl) ? sourceUrl : ""));
        const shouldSaveServer = shouldDownloadAssetToServer(type, settings);
        const serverFallbackEnabled = shouldUseServerFallback(type, settings);
        let serverUrl = existingServerUrl;
        let stored: GenerationLogAsset | null = null;

        if (!sourceUrl || sourceUrl.startsWith("blob:")) {
            if (!remoteUrl && !serverUrl) continue;
        } else if (sourceUrl.startsWith("data:")) {
            if (shouldSaveServer) stored = await writeDataUrlAsset(sourceUrl, type);
        } else if (isRemoteAssetUrl(sourceUrl) && shouldSaveServer) {
            stored = await writeRemoteAsset(sourceUrl, type);
        }

        if (stored) serverUrl = stored.serverUrl || stored.url;
        const accessUrl = remoteUrl || (serverFallbackEnabled ? serverUrl : "") || serverUrl || sourceUrl;
        if (!accessUrl || accessUrl.startsWith("blob:") || accessUrl.startsWith("data:")) continue;

        normalized.push({
            type,
            url: normalizeText(accessUrl, "", 4000),
            remoteUrl: normalizeOptionalText(remoteUrl, undefined, 4000),
            serverUrl: normalizeOptionalText(serverUrl, undefined, 4000),
            mimeType: normalizeOptionalText(stored?.mimeType || asset.mimeType, undefined, 120),
            width: toOptionalNumber(asset.width),
            height: toOptionalNumber(asset.height),
            bytes: toOptionalNumber(stored?.bytes || asset.bytes),
        });
    }
    return normalized;
}

async function writeDataUrlAsset(dataUrl: string, type: GenerationLogKind): Promise<GenerationLogAsset | null> {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1] || (type === "video" ? "video/mp4" : "image/png");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > maxServerAssetBytes(type)) return null;
    return writeAssetBytes(bytes, mimeType, type);
}

async function writeRemoteAsset(url: string, type: GenerationLogKind): Promise<GenerationLogAsset | null> {
    if (!(await isSafeRemoteAssetUrl(url))) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_ASSET_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(url, { cache: "no-store", redirect: "manual", signal: controller.signal });
        if (!response.ok || !response.body) return null;
        const contentLength = Number(response.headers.get("content-length") || 0);
        const maxBytes = maxServerAssetBytes(type);
        if (contentLength > maxBytes) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maxBytes) return null;
        const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || (type === "video" ? "video/mp4" : "image/png");
        return writeAssetBytes(bytes, mimeType, type);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function isSafeRemoteAssetUrl(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        if (url.username || url.password) return false;
        const addresses = await lookup(url.hostname, { all: true, verbatim: true });
        return addresses.length > 0 && addresses.every((item) => isPublicIpAddress(item.address));
    } catch {
        return false;
    }
}

function isPublicIpAddress(address: string) {
    const version = isIP(address);
    if (version === 4) {
        const parts = address.split(".").map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
        const [a, b] = parts;
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && (b === 0 || b === 168)) return false;
        if (a === 198 && (b === 18 || b === 19)) return false;
        return true;
    }
    if (version === 6) {
        const normalized = address.toLowerCase();
        if (normalized === "::" || normalized === "::1") return false;
        if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return false;
        if (normalized.startsWith("::ffff:")) return isPublicIpAddress(normalized.slice("::ffff:".length));
        return true;
    }
    return false;
}

async function writeAssetBytes(bytes: Buffer, mimeType: string, type: GenerationLogKind): Promise<GenerationLogAsset> {
    const folder = type === "video" ? "videos" : "images";
    const extension = extensionFromMime(mimeType, type);
    const fileName = `${randomUUID()}${extension}`;
    const filePath = resolve(ASSET_ROOT, folder, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    const serverUrl = `/api/generation-log-assets/${folder}/${fileName}`;
    return { type, url: serverUrl, serverUrl, mimeType, bytes: bytes.length };
}

function shouldDownloadAssetToServer(type: GenerationLogKind, settings?: GenerationAssetStorageSettings) {
    return type === "video" ? settings?.videoServerDownload === true : settings?.imageServerDownload === true;
}

function shouldUseServerFallback(type: GenerationLogKind, settings?: GenerationAssetStorageSettings) {
    return type === "video" ? settings?.videoServerFallback !== false : settings?.imageServerFallback !== false;
}

function maxServerAssetBytes(type: GenerationLogKind) {
    return type === "video" ? MAX_SERVER_VIDEO_BYTES : MAX_SERVER_IMAGE_BYTES;
}

function isRemoteAssetUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

function isServerAssetUrl(value: string) {
    return value.startsWith("/api/generation-log-assets/");
}

function normalizeRemoteUrl(value: unknown) {
    const text = normalizeOptionalText(value, undefined, 4000) || "";
    return isRemoteAssetUrl(text) ? text : "";
}

function normalizeServerAssetUrl(value: unknown) {
    const text = normalizeOptionalText(value, undefined, 4000) || "";
    return isServerAssetUrl(text) ? text : "";
}

async function deleteLocalAsset(url: string) {
    if (!url.startsWith("/api/generation-log-assets/")) return;
    const relative = url.replace("/api/generation-log-assets/", "");
    const filePath = resolve(ASSET_ROOT, relative);
    const root = resolve(ASSET_ROOT);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return;
    await unlink(filePath).catch(() => undefined);
}

function collectReferencedLocalAssetPaths(db: GenerationLogDatabase) {
    const root = resolve(ASSET_ROOT);
    const paths = new Set<string>();
    for (const log of db.logs) {
        for (const asset of log.assets) {
            for (const url of localAssetUrls(asset)) {
                const filePath = localAssetUrlToPath(url);
                if (filePath && filePath !== root && filePath.startsWith(`${root}${sep}`)) paths.add(filePath);
            }
        }
    }
    return paths;
}

function localAssetUrls(asset: GenerationLogAsset) {
    return [asset.url, asset.serverUrl].filter((url): url is string => Boolean(url && isServerAssetUrl(url)));
}

function stableAssetUrl(asset: GenerationLogAsset) {
    return asset.remoteUrl || asset.serverUrl || asset.url || "";
}

function localAssetUrlToPath(url: string) {
    if (!url.startsWith("/api/generation-log-assets/")) return "";
    const relative = url.replace("/api/generation-log-assets/", "");
    const filePath = resolve(ASSET_ROOT, relative);
    const root = resolve(ASSET_ROOT);
    return filePath !== root && filePath.startsWith(`${root}${sep}`) ? filePath : "";
}

async function listLocalAssetFiles() {
    const root = resolve(ASSET_ROOT);
    const files: Array<{ path: string; bytes: number }> = [];
    await walkAssetDir(root, files);
    return files;
}

async function walkAssetDir(dir: string, files: Array<{ path: string; bytes: number }>) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }

    await Promise.all(
        entries.map(async (entry) => {
            const entryPath = resolve(dir, entry.name);
            const root = resolve(ASSET_ROOT);
            if (entryPath !== root && !entryPath.startsWith(`${root}${sep}`)) return;
            if (entry.isDirectory()) {
                await walkAssetDir(entryPath, files);
                return;
            }
            if (!entry.isFile()) return;
            const info = await stat(entryPath).catch(() => null);
            if (info?.isFile()) files.push({ path: entryPath, bytes: info.size });
        }),
    );
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
        assets: Array.isArray(log.assets)
            ? log.assets
                  .map(normalizeStoredAsset)
                  .filter((asset): asset is GenerationLogAsset => Boolean(asset?.url))
                  .slice(0, 6)
            : [],
        taskId: normalizeOptionalText(log.taskId, undefined, 160),
        error: normalizeOptionalText(log.error, undefined, 1000),
        createdAt: normalizeTime(log.createdAt, new Date().toISOString()),
        updatedAt: normalizeTime(log.updatedAt, log.createdAt || new Date().toISOString()),
        completedAt: log.completedAt ? normalizeTime(log.completedAt, log.completedAt) : undefined,
    };
}

function normalizeStoredAsset(asset: Partial<GenerationLogAsset> | undefined): GenerationLogAsset | null {
    if (!asset) return null;
    const type = asset.type === "video" ? "video" : "image";
    const url = normalizeOptionalText(asset.url, undefined, 4000) || "";
    const remoteUrl = normalizeRemoteUrl(asset.remoteUrl || (isRemoteAssetUrl(url) ? url : ""));
    const serverUrl = normalizeServerAssetUrl(asset.serverUrl || (isServerAssetUrl(url) ? url : ""));
    const accessUrl = remoteUrl || serverUrl || url;
    if (!accessUrl) return null;
    return {
        type,
        url: normalizeText(accessUrl, "", 4000),
        remoteUrl: normalizeOptionalText(remoteUrl, undefined, 4000),
        serverUrl: normalizeOptionalText(serverUrl, undefined, 4000),
        mimeType: normalizeOptionalText(asset.mimeType, undefined, 120),
        width: toOptionalNumber(asset.width),
        height: toOptionalNumber(asset.height),
        bytes: toOptionalNumber(asset.bytes),
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
