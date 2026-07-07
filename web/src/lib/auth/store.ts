import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveServerDataPath } from "@/lib/server/data-dir";
import { hashPassword, verifyPassword } from "./password";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";
export type ApiCallFormat = "openai" | "gemini";

type LegacyUserQuota = {
    imageDaily: number;
    videoDaily: number;
    textDaily: number;
    audioDaily: number;
};

export type ModelPointCosts = Record<string, number>;
export type PointUsageKind = "api" | "image" | "video" | "audio" | "text";

export type SystemModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
    enabled: boolean;
};

export type SystemDefaultModels = {
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
};

export type GenerationConcurrencySettings = {
    image: number;
    video: number;
};

export type GenerationDefaultSettings = {
    canvasImageCount: number;
};

export type GenerationPointMultipliers = {
    imageQuality: Record<string, number>;
    videoQuality: Record<string, number>;
    videoSeconds: Record<string, number>;
};

export type GenerationAssetStorageSettings = {
    imageServerFallback: boolean;
    videoServerFallback: boolean;
    imageServerDownload: boolean;
    videoServerDownload: boolean;
};

export type WebdavSettings = {
    enabled: boolean;
    url: string;
    username: string;
    password: string;
    directory: string;
};

export type CdkStatus = "active" | "disabled";

export type PublicCdkRedemption = {
    userId: string;
    username: string;
    displayName: string;
    redeemedAt: string;
};

export type PublicCdkCode = {
    id: string;
    codePreview: string;
    code?: string;
    points: number;
    maxRedemptions: number;
    redeemedCount: number;
    redemptions: PublicCdkRedemption[];
    status: CdkStatus;
    note: string;
    expiresAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type CreatedCdkCode = PublicCdkCode & {
    code: string;
};

type StoredCdkRedemption = {
    userId: string;
    redeemedAt: string;
};

type StoredCdkCode = Omit<PublicCdkCode, "redemptions"> & {
    codeHash: string;
    redemptions: StoredCdkRedemption[];
};

export type PublicAnnouncement = {
    id: string;
    title: string;
    content: string;
    enabled: boolean;
    popupHome: boolean;
    popupAfterLogin: boolean;
    startsAt?: string;
    endsAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type SiteSettings = {
    title: string;
    logoUrl: string;
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    termsUrl: string;
    privacyUrl: string;
    homeShowcaseMode: SiteShowcaseMode;
    homeShowcaseItems: SiteShowcaseItem[];
    friendLinks: SiteFriendLink[];
    socials: SiteSocialSettings;
};

export type SiteShowcaseMode = "random" | "custom";

export type SiteShowcaseItem = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
};

export type SiteFriendLink = {
    id: string;
    label: string;
    url: string;
    enabled: boolean;
};

export type SiteSocialKey = "email" | "telegram" | "x" | "instagram";

export type SiteSocialSettings = Record<
    SiteSocialKey,
    {
        enabled: boolean;
        label: string;
        url: string;
    }
>;

const DEFAULT_SITE_SOCIALS: SiteSocialSettings = {
    email: { enabled: true, label: "邮箱联系", url: "mailto:contact@example.com" },
    telegram: { enabled: true, label: "Telegram", url: "https://t.me/vozeb" },
    x: { enabled: true, label: "X", url: "https://x.com/vozeb" },
    instagram: { enabled: true, label: "Instagram", url: "https://instagram.com/vozeb" },
};

const DEFAULT_SITE_FRIEND_LINKS: SiteFriendLink[] = [
    { id: "vozeb-home", label: "VOZEB", url: "https://www.vozeb.com/", enabled: true },
    { id: "linux-do", label: "Linux.do", url: "https://linux.do/", enabled: true },
];

export type MailSettings = {
    provider: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
};

export type PublicUser = {
    id: string;
    username: string;
    email?: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
    pointsBalance: number;
    checkedInToday: boolean;
    lastCheckInDate?: string;
    createdAt: string;
    updatedAt: string;
    lastLoginAt?: string;
};

type StoredUser = Omit<PublicUser, "checkedInToday" | "lastCheckInDate"> & {
    passwordHash: string;
};

type StoredSession = {
    id: string;
    userId: string;
    tokenHash: string;
    createdAt: string;
    expiresAt: string;
};

export type PublicPointRecord = {
    id: string;
    userId: string;
    type: "check-in" | "consume" | "admin-adjust";
    amount: number;
    balanceAfter: number;
    description: string;
    model?: string;
    createdAt: string;
};

type StoredPointRecord = PublicPointRecord;

type StoredCheckIn = {
    userId: string;
    date: string;
    rewardPoints: number;
    createdAt: string;
};

export type EmailCodePurpose = "register" | "email-change" | "password-reset";

type StoredEmailCode = {
    id: string;
    purpose: EmailCodePurpose;
    email: string;
    userId?: string;
    codeHash: string;
    createdAt: string;
    expiresAt: string;
    consumedAt?: string;
};

export type AuthSettings = {
    site: SiteSettings;
    registrationEnabled: boolean;
    emailRegistrationEnabled: boolean;
    mail: MailSettings;
    allowUserApiConfig: boolean;
    defaultPoints: number;
    checkInRewardPoints: number;
    modelPointCosts: ModelPointCosts;
    generationPointMultipliers: GenerationPointMultipliers;
    generationConcurrency: GenerationConcurrencySettings;
    generationDefaults: GenerationDefaultSettings;
    generationAssetStorage: GenerationAssetStorageSettings;
    webdav: WebdavSettings;
    systemChannels: SystemModelChannel[];
    defaultModels: SystemDefaultModels;
};

type AuthDatabase = {
    version: 1;
    users: StoredUser[];
    sessions: StoredSession[];
    quotaUsage: unknown[];
    pointRecords: StoredPointRecord[];
    checkIns: StoredCheckIn[];
    emailCodes: StoredEmailCode[];
    cdkCodes: StoredCdkCode[];
    announcements: PublicAnnouncement[];
    settings: AuthSettings;
};

export class AuthInputError extends Error {
    status = 400;
}

export class QuotaExceededError extends Error {
    status = 429;
}

export function isAuthInputError(error: unknown): error is AuthInputError {
    return Boolean(error && typeof error === "object" && (error as { status?: unknown }).status === 400);
}

export function isQuotaExceededError(error: unknown): error is QuotaExceededError {
    return Boolean(error && typeof error === "object" && (error as { status?: unknown }).status === 429);
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const EMAIL_CODE_MAX_AGE_MS = 1000 * 60 * 10;
const EMAIL_CODE_RESEND_COOLDOWN_MS = 1000 * 60;
export const DEFAULT_USER_POINTS = 100;
export const DEFAULT_CHECK_IN_REWARD_POINTS = 5;
const DEFAULT_MODEL_POINT_COST_KEY = "__default__";
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
    title: "VOZEB",
    logoUrl: "/logo.svg",
    seoTitle: "VOZEB",
    seoDescription: "面向 AI 图片创作与管理的 VOZEB 工作台",
    seoKeywords: "VOZEB,AI 绘图,无限画布,提示词库,素材管理",
    footerCopyright: "© 2026 VOZEB. All rights reserved.",
    termsUrl: "/terms",
    privacyUrl: "/privacy",
    homeShowcaseMode: "random",
    homeShowcaseItems: [],
    friendLinks: DEFAULT_SITE_FRIEND_LINKS,
    socials: DEFAULT_SITE_SOCIALS,
};
export const DEFAULT_MAIL_SETTINGS: MailSettings = {
    provider: "QQ 邮箱",
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "VOZEB",
};
const DEFAULT_GENERATION_POINT_MULTIPLIERS: GenerationPointMultipliers = {
    imageQuality: { auto: 1, low: 1, medium: 1, high: 1 },
    videoQuality: { "480": 1, "720": 1, "1080": 1 },
    videoSeconds: { "-1": 1, "5": 1, "10": 1 },
};
const DEFAULT_WEBDAV_SETTINGS: WebdavSettings = {
    enabled: false,
    url: "",
    username: "",
    password: "",
    directory: "vozeb",
};
const DEFAULT_SETTINGS: AuthSettings = {
    site: DEFAULT_SITE_SETTINGS,
    registrationEnabled: true,
    emailRegistrationEnabled: false,
    mail: DEFAULT_MAIL_SETTINGS,
    allowUserApiConfig: false,
    defaultPoints: DEFAULT_USER_POINTS,
    checkInRewardPoints: DEFAULT_CHECK_IN_REWARD_POINTS,
    modelPointCosts: {},
    generationPointMultipliers: DEFAULT_GENERATION_POINT_MULTIPLIERS,
    generationConcurrency: { image: 4, video: 1 },
    generationDefaults: { canvasImageCount: 1 },
    generationAssetStorage: {
        imageServerFallback: true,
        videoServerFallback: true,
        imageServerDownload: false,
        videoServerDownload: false,
    },
    webdav: DEFAULT_WEBDAV_SETTINGS,
    systemChannels: [],
    defaultModels: { imageModel: "", videoModel: "", textModel: "", audioModel: "" },
};
const AUTH_DATA_FILE = resolveServerDataPath("auth.json");
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

let mutationQueue = Promise.resolve();

export function sessionMaxAgeSeconds() {
    return SESSION_MAX_AGE_SECONDS;
}

export async function getAuthSettings() {
    return (await readAuthDb()).settings;
}

export async function setAuthSettings(patch: Partial<AuthSettings>) {
    return mutateAuthDb((db) => {
        db.settings = normalizeSettings({ ...db.settings, ...patch });
        return db.settings;
    });
}

export async function listPublicUsers() {
    const db = await readAuthDb();
    return db.users.map((user) => toPublicUser(user, db)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export type PointRecordListResult = {
    records: PublicPointRecord[];
    total: number;
    page: number;
    pageSize: number;
};

export async function listPointRecordsPage(userId: string, input?: { page?: number; pageSize?: number }): Promise<PointRecordListResult> {
    const db = await readAuthDb();
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input?.pageSize) || 10)));
    const page = Math.max(1, Math.floor(Number(input?.page) || 1));
    const records = (db.pointRecords || [])
        .filter((record) => record.userId === userId)
        .map(toPublicPointRecord)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const total = records.length;
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const start = (safePage - 1) * pageSize;
    return {
        records: records.slice(start, start + pageSize),
        total,
        page: safePage,
        pageSize,
    };
}

export async function listPointRecords(userId: string, limit = 50) {
    const result = await listPointRecordsPage(userId, { page: 1, pageSize: Math.max(1, Math.min(200, Math.floor(Number(limit) || 50))) });
    return result.records;
}

export type CdkListFilter = "all" | "redeemed" | "unused" | "expired";

export type CdkListResult = {
    codes: PublicCdkCode[];
    total: number;
    page: number;
    pageSize: number;
    stats: {
        total: number;
        redeemed: number;
        unused: number;
        expired: number;
    };
};

export async function listCdkCodes(input?: { page?: number; pageSize?: number; keyword?: string; filter?: CdkListFilter }): Promise<CdkListResult> {
    const db = await readAuthDb();
    const keyword = normalizeText(input?.keyword, "", 120).toLowerCase();
    const filter = input?.filter === "redeemed" || input?.filter === "unused" || input?.filter === "expired" ? input.filter : "all";
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input?.pageSize) || 20)));
    const page = Math.max(1, Math.floor(Number(input?.page) || 1));
    const allCodes = db.cdkCodes
        .filter((code) => code.status === "active" && Boolean(code.code))
        .map((code) => toPublicCdkCode(code, db, { includePlain: true }))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const stats = {
        total: allCodes.length,
        redeemed: allCodes.filter((code) => code.redeemedCount > 0).length,
        unused: allCodes.filter((code) => !isCdkCodeExpired(code) && code.redeemedCount <= 0).length,
        expired: allCodes.filter(isCdkCodeExpired).length,
    };
    const filtered = allCodes.filter((code) => {
        const matchedFilter = filter === "all" || (filter === "redeemed" && code.redeemedCount > 0) || (filter === "unused" && !isCdkCodeExpired(code) && code.redeemedCount <= 0) || (filter === "expired" && isCdkCodeExpired(code));
        if (!matchedFilter) return false;
        if (!keyword) return true;
        const redemptionsText = code.redemptions.map((item) => `${item.username} ${item.displayName}`).join(" ");
        return [code.code || "", code.note, redemptionsText].some((value) => value.toLowerCase().includes(keyword));
    });
    const total = filtered.length;
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const start = (safePage - 1) * pageSize;
    return {
        codes: filtered.slice(start, start + pageSize),
        total,
        page: safePage,
        pageSize,
        stats,
    };
}

export async function createCdkCodes(input: { count?: number; points?: number; maxRedemptions?: number; expiresAt?: string; expiresInDays?: number; note?: string }) {
    return mutateAuthDb((db) => {
        const count = Math.max(1, Math.min(100, Math.floor(Number(input.count) || 1)));
        const points = normalizePoints(input.points, 10);
        const maxRedemptions = Math.max(1, Math.min(10000, Math.floor(Number(input.maxRedemptions) || 1)));
        const expiresAt = resolveCdkExpiresAt(input.expiresAt, input.expiresInDays);
        const note = normalizeText(input.note, "", 120);
        const now = new Date().toISOString();
        const created: CreatedCdkCode[] = [];
        for (let index = 0; index < count; index += 1) {
            let code = generateCdkPlainCode();
            let attempts = 0;
            while (db.cdkCodes.some((item) => item.codeHash === hashToken(normalizeCdkCode(code))) && attempts < 8) {
                code = generateCdkPlainCode();
                attempts += 1;
            }
            const publicCode: PublicCdkCode = {
                id: randomUUID(),
                codePreview: previewCdkCode(code),
                code,
                points,
                maxRedemptions,
                redeemedCount: 0,
                redemptions: [],
                status: "active",
                note,
                ...(expiresAt ? { expiresAt } : {}),
                createdAt: now,
                updatedAt: now,
            };
            db.cdkCodes.push({
                ...publicCode,
                codeHash: hashToken(normalizeCdkCode(code)),
                redemptions: [],
            });
            created.push({ ...publicCode, code });
        }
        return created;
    });
}

export async function updateCdkCode(id: string, patch: Partial<Pick<PublicCdkCode, "status" | "note" | "expiresAt" | "points" | "maxRedemptions">>) {
    return mutateAuthDb((db) => {
        const item = db.cdkCodes.find((code) => code.id === id);
        if (!item) throw new AuthInputError("CDK 不存在");
        if (patch.status) item.status = patch.status === "active" ? "active" : "disabled";
        if (patch.note !== undefined) item.note = normalizeText(patch.note, "", 120);
        if (patch.expiresAt !== undefined) {
            const expiresAt = normalizeOptionalIsoDate(patch.expiresAt);
            if (expiresAt) item.expiresAt = expiresAt;
            else delete item.expiresAt;
        }
        if (patch.points !== undefined) item.points = normalizePoints(patch.points, item.points);
        if (patch.maxRedemptions !== undefined) item.maxRedemptions = Math.max(item.redeemedCount, Math.min(10000, Math.max(1, Math.floor(Number(patch.maxRedemptions) || item.maxRedemptions))));
        item.updatedAt = new Date().toISOString();
        return toPublicCdkCode(item, db, { includePlain: true });
    });
}

export async function deleteCdkCode(id: string) {
    return mutateAuthDb((db) => {
        const index = db.cdkCodes.findIndex((code) => code.id === id);
        if (index < 0) throw new AuthInputError("CDK 不存在");
        db.cdkCodes.splice(index, 1);
        return { ok: true, deleted: 1 };
    });
}

export async function deleteCdkCodes(ids: string[]) {
    return mutateAuthDb((db) => {
        const deletingIds = Array.from(new Set(ids.map((id) => normalizeText(id, "", 80)).filter(Boolean)));
        if (!deletingIds.length) throw new AuthInputError("请选择要删除的 CDK");
        const before = db.cdkCodes.length;
        db.cdkCodes = db.cdkCodes.filter((code) => !deletingIds.includes(code.id));
        return { ok: true, deleted: before - db.cdkCodes.length };
    });
}

export async function redeemCdkCode(userId: string, rawCode: string) {
    return mutateAuthDb((db) => {
        const code = normalizeCdkCode(rawCode);
        if (!code) throw new AuthInputError("请输入 CDK 密钥");
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        const item = db.cdkCodes.find((entry) => entry.codeHash === hashToken(code));
        if (!item || item.status !== "active") throw new AuthInputError("CDK 无效或已停用");
        if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) throw new AuthInputError("CDK 已过期");
        if (item.redeemedCount >= item.maxRedemptions) throw new AuthInputError("CDK 已兑换完");
        if (item.redemptions.some((entry) => entry.userId === userId)) throw new AuthInputError("该 CDK 已被当前账号兑换");

        const points = normalizePoints(item.points, 0);
        const now = new Date().toISOString();
        user.pointsBalance = normalizePointAmount(normalizePoints(user.pointsBalance, db.settings.defaultPoints) + points, db.settings.defaultPoints);
        user.updatedAt = now;
        item.redemptions.push({ userId, redeemedAt: now });
        item.redeemedCount = item.redemptions.length;
        item.updatedAt = now;
        addPointRecord(db, {
            userId,
            type: "admin-adjust",
            amount: points,
            balanceAfter: user.pointsBalance,
            description: `CDK 兑换：${item.codePreview}`,
            createdAt: now,
        });
        return { user: toPublicUser(user, db), points, cdk: toPublicCdkCode(item, db) };
    });
}

export async function listAnnouncements(includeDisabled = false) {
    const db = await readAuthDb();
    return db.announcements.filter((announcement) => includeDisabled || isAnnouncementVisible(announcement)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function createAnnouncement(input: Partial<PublicAnnouncement>) {
    return mutateAuthDb((db) => {
        const now = new Date().toISOString();
        const announcement = normalizeAnnouncement({
            id: randomUUID(),
            title: input.title || "",
            content: input.content || "",
            enabled: input.enabled !== false,
            popupHome: input.popupHome === true,
            popupAfterLogin: input.popupAfterLogin === true,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            createdAt: now,
            updatedAt: now,
        });
        if (!announcement.title || !announcement.content) throw new AuthInputError("请填写公告标题和内容");
        db.announcements.push(announcement);
        return announcement;
    });
}

export async function updateAnnouncement(id: string, patch: Partial<PublicAnnouncement>) {
    return mutateAuthDb((db) => {
        const index = db.announcements.findIndex((announcement) => announcement.id === id);
        if (index < 0) throw new AuthInputError("公告不存在");
        const next = normalizeAnnouncement({
            ...db.announcements[index],
            ...patch,
            id,
            updatedAt: new Date().toISOString(),
        });
        if (!next.title || !next.content) throw new AuthInputError("请填写公告标题和内容");
        db.announcements[index] = next;
        return next;
    });
}

export async function deleteAnnouncement(id: string) {
    return mutateAuthDb((db) => {
        const before = db.announcements.length;
        db.announcements = db.announcements.filter((announcement) => announcement.id !== id);
        if (before === db.announcements.length) throw new AuthInputError("公告不存在");
        return { ok: true };
    });
}

function toPublicPointRecord(record: StoredPointRecord): PublicPointRecord {
    return { ...record, description: displayPointRecordDescription(record) };
}

function displayPointRecordDescription(record: StoredPointRecord) {
    const description = record.description.trim();
    const model = (record.model || "").trim();
    if (!model) return description;
    if (record.type === "consume") {
        return buildPointRecordDescription(model, legacyPointUsageKindFromModel(model), "consume");
    }
    if (record.type === "admin-adjust" && record.amount > 0) {
        return buildPointRecordDescription(model, legacyPointUsageKindFromModel(model), "refund");
    }
    return description;
}

function legacyPointUsageKindFromModel(model: string): PointUsageKind {
    const lower = model.toLowerCase();
    if (/(video|seedance|sora|veo|kling|wan|hailuo|runway|luma)/.test(lower)) return "video";
    if (/(image|imagen|gpt-image|dall|flux|midjourney|sdxl|stable-diffusion)/.test(lower)) return "image";
    return "api";
}

export async function checkInUser(userId: string) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");

        const today = currentQuotaDate();
        if (db.checkIns.some((item) => item.userId === userId && item.date === today)) throw new AuthInputError("今天已经签到过了");

        const rewardPoints = normalizePoints(db.settings.checkInRewardPoints, DEFAULT_CHECK_IN_REWARD_POINTS);
        user.pointsBalance = normalizePointAmount(normalizePoints(user.pointsBalance, db.settings.defaultPoints) + rewardPoints, db.settings.defaultPoints);
        user.updatedAt = new Date().toISOString();
        db.checkIns.push({ userId, date: today, rewardPoints, createdAt: user.updatedAt });
        addPointRecord(db, {
            userId,
            type: "check-in",
            amount: rewardPoints,
            balanceAfter: user.pointsBalance,
            description: "每日签到",
            createdAt: user.updatedAt,
        });
        return { user: toPublicUser(user, db), rewardPoints, date: today };
    });
}

export async function consumeUserPoints(userId: string, model: string, amount = 1, usageKind: PointUsageKind = "api") {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");

        const multiplier = resolveModelPointCost(db.settings.modelPointCosts, model);
        const units = Math.min(1000, normalizePointAmount(amount, 1));
        const cost = normalizePointAmount(units * multiplier, 0);
        const balance = normalizePoints(user.pointsBalance, db.settings.defaultPoints);

        if (cost > balance) {
            throw new QuotaExceededError(`积分不足，当前余额 ${balance}，需要 ${cost}`);
        }

        user.pointsBalance = normalizePointAmount(balance - cost, 0);
        user.updatedAt = new Date().toISOString();
        addPointRecord(db, {
            userId,
            type: "consume",
            amount: -cost,
            balanceAfter: user.pointsBalance,
            description: buildPointRecordDescription(model, usageKind, "consume"),
            model: model.trim(),
            createdAt: user.updatedAt,
        });
        return { model: model.trim(), units, multiplier, cost, remaining: user.pointsBalance, usageKind };
    });
}

export async function refundUserPoints(userId: string, model: string, amount: number, usageKind: PointUsageKind = "api") {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user) return null;

        const refund = normalizePointAmount(amount, 0);
        if (!refund) return toPublicUser(user, db);

        user.pointsBalance = normalizePointAmount(normalizePoints(user.pointsBalance, db.settings.defaultPoints) + refund, db.settings.defaultPoints);
        user.updatedAt = new Date().toISOString();
        addPointRecord(db, {
            userId,
            type: "admin-adjust",
            amount: refund,
            balanceAfter: user.pointsBalance,
            description: buildPointRecordDescription(model, usageKind, "refund"),
            model: model.trim(),
            createdAt: user.updatedAt,
        });
        return toPublicUser(user, db);
    });
}

export async function createUser(input: { username: string; email?: string; emailCode?: string; displayName?: string; password: string }) {
    return mutateAuthDb((db) => {
        const username = normalizeUsername(input.username);
        const email = normalizeEmail(input.email);
        const displayName = normalizeDisplayName(input.displayName || username);
        validateUsername(username);
        validatePassword(input.password);

        const firstUser = db.users.length === 0;
        if (!firstUser && !db.settings.registrationEnabled) throw new AuthInputError("注册已关闭");
        if (!firstUser && db.settings.emailRegistrationEnabled && !email) throw new AuthInputError("请填写邮箱地址");
        if (email) validateEmail(email);
        if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new AuthInputError("用户名已存在");
        if (email && db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");
        if (!firstUser && db.settings.emailRegistrationEnabled) consumeEmailCode(db, { purpose: "register", email, code: input.emailCode });

        const now = new Date().toISOString();
        const user: StoredUser = {
            id: randomUUID(),
            username,
            email: email || undefined,
            displayName,
            role: firstUser ? "admin" : "user",
            status: "active",
            pointsBalance: db.settings.defaultPoints,
            passwordHash: hashPassword(input.password),
            createdAt: now,
            updatedAt: now,
        };
        db.users.push(user);
        return toPublicUser(user, db);
    });
}

export async function createUserByAdmin(input: { username: string; email?: string; displayName?: string; password: string; role?: UserRole; status?: UserStatus; pointsBalance?: number }) {
    return mutateAuthDb((db) => {
        const username = normalizeUsername(input.username);
        const email = normalizeEmail(input.email);
        const displayName = normalizeDisplayName(input.displayName || username);
        validateUsername(username);
        validatePassword(input.password);
        if (email) validateEmail(email);
        if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new AuthInputError("用户名已存在");
        if (email && db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");

        const now = new Date().toISOString();
        const pointsBalance = normalizePoints(input.pointsBalance, db.settings.defaultPoints);
        const user: StoredUser = {
            id: randomUUID(),
            username,
            email: email || undefined,
            displayName,
            role: input.role === "admin" ? "admin" : "user",
            status: input.status === "disabled" ? "disabled" : "active",
            pointsBalance,
            passwordHash: hashPassword(input.password),
            createdAt: now,
            updatedAt: now,
        };
        db.users.push(user);
        addPointRecord(db, {
            userId: user.id,
            type: "admin-adjust",
            amount: pointsBalance,
            balanceAfter: pointsBalance,
            description: "管理员创建用户",
            createdAt: now,
        });
        return toPublicUser(user, db);
    });
}

export async function authenticateUser(input: { username: string; password: string }) {
    const account = normalizeUsername(input.username);
    const accountEmail = normalizeEmail(input.username);
    const db = await readAuthDb();
    const user = db.users.find((item) => item.username.toLowerCase() === account.toLowerCase() || (accountEmail && item.email?.toLowerCase() === accountEmail));
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new AuthInputError("用户名或密码不正确");
    if (user.status !== "active") throw new AuthInputError("账号已被禁用");

    await mutateAuthDb((nextDb) => {
        const nextUser = nextDb.users.find((item) => item.id === user.id);
        if (nextUser) {
            nextUser.lastLoginAt = new Date().toISOString();
            nextUser.updatedAt = nextUser.lastLoginAt;
        }
    });

    return toPublicUser({ ...user, lastLoginAt: new Date().toISOString() }, db);
}

export async function createEmailVerificationCode(input: { purpose: EmailCodePurpose; email: string; userId?: string }) {
    return mutateAuthDb((db) => {
        const email = normalizeEmail(input.email);
        validateEmail(email);
        const now = new Date();

        if (input.purpose === "register") {
            if (!db.settings.emailRegistrationEnabled) throw new AuthInputError("当前未开启邮箱注册");
            if (db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");
        }

        if (input.purpose === "email-change") {
            if (!input.userId) throw new AuthInputError("请先登录");
            if (db.users.some((user) => user.id !== input.userId && user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");
        }

        if (input.purpose === "password-reset" && !db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) {
            throw new AuthInputError("没有找到绑定该邮箱的账号");
        }

        const code = randomNumericCode();
        const activeCode = db.emailCodes.find((item) => item.purpose === input.purpose && item.email === email && item.userId === input.userId && !item.consumedAt && Date.parse(item.expiresAt) > now.getTime());
        if (activeCode && now.getTime() - Date.parse(activeCode.createdAt) < EMAIL_CODE_RESEND_COOLDOWN_MS) {
            throw new AuthInputError("验证码发送过于频繁，请 60 秒后再试");
        }
        db.emailCodes = db.emailCodes.filter((item) => !(item.purpose === input.purpose && item.email === email && item.userId === input.userId && !item.consumedAt));
        db.emailCodes.push({
            id: randomUUID(),
            purpose: input.purpose,
            email,
            userId: input.userId,
            codeHash: hashToken(code),
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + EMAIL_CODE_MAX_AGE_MS).toISOString(),
        });
        return { code, email };
    });
}

export async function updateOwnProfile(userId: string, input: { displayName?: string; email?: string; emailCode?: string }) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");

        if (input.displayName !== undefined) user.displayName = normalizeDisplayName(input.displayName || user.username);

        if (input.email !== undefined) {
            const email = normalizeEmail(input.email);
            if (!email) throw new AuthInputError("请填写邮箱地址");
            validateEmail(email);
            if (email !== (user.email || "").toLowerCase()) {
                if (db.users.some((item) => item.id !== user.id && item.email?.toLowerCase() === email)) throw new AuthInputError("邮箱已被注册");
                consumeEmailCode(db, { purpose: "email-change", email, code: input.emailCode, userId });
                user.email = email;
            }
        }

        user.updatedAt = new Date().toISOString();
        return toPublicUser(user, db);
    });
}

export async function updateOwnPassword(userId: string, input: { currentPassword: string; newPassword: string }) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        if (!verifyPassword(input.currentPassword, user.passwordHash)) throw new AuthInputError("当前密码不正确");
        validatePassword(input.newPassword);
        user.passwordHash = hashPassword(input.newPassword);
        user.updatedAt = new Date().toISOString();
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return toPublicUser(user, db);
    });
}

export async function resetPasswordByEmail(input: { email: string; code?: string; newPassword: string }) {
    return mutateAuthDb((db) => {
        const email = normalizeEmail(input.email);
        validateEmail(email);
        const user = db.users.find((item) => item.email?.toLowerCase() === email);
        if (!user || user.status !== "active") throw new AuthInputError("没有找到可用账号");
        consumeEmailCode(db, { purpose: "password-reset", email, code: input.code });
        validatePassword(input.newPassword);
        user.passwordHash = hashPassword(input.newPassword);
        user.updatedAt = new Date().toISOString();
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return toPublicUser(user, db);
    });
}

export async function createSession(userId: string) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");

        const now = new Date();
        const sessionId = randomUUID();
        const token = randomBytes(32).toString("base64url");
        db.sessions.push({
            id: sessionId,
            userId,
            tokenHash: hashToken(token),
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
        });
        return `${sessionId}.${token}`;
    });
}

export async function getUserBySession(cookieValue: string | undefined) {
    const sessionParts = parseSessionCookie(cookieValue);
    if (!sessionParts) return null;

    const db = await readAuthDb();
    const session = db.sessions.find((item) => item.id === sessionParts.id);
    if (!session || session.tokenHash !== hashToken(sessionParts.token) || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = db.users.find((item) => item.id === session.userId);
    if (!user || user.status !== "active") return null;
    return toPublicUser(user, db);
}

export async function deleteSession(cookieValue: string | undefined) {
    const sessionParts = parseSessionCookie(cookieValue);
    if (!sessionParts) return;
    await mutateAuthDb((db) => {
        db.sessions = db.sessions.filter((item) => item.id !== sessionParts.id);
    });
}

export async function updateUserByAdmin(actorId: string, userId: string, patch: Partial<Pick<PublicUser, "displayName" | "email" | "role" | "status" | "pointsBalance">> & { password?: string }) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user) throw new AuthInputError("用户不存在");
        if (user.id === actorId && patch.status === "disabled") throw new AuthInputError("不能禁用当前登录的管理员账号");

        const nextRole = patch.role || user.role;
        const nextStatus = patch.status || user.status;
        if (user.role === "admin" && nextRole !== "admin" && countActiveAdmins(db, user.id) === 0) throw new AuthInputError("至少需要保留一个管理员");
        if (user.role === "admin" && nextStatus !== "active" && countActiveAdmins(db, user.id) === 0) throw new AuthInputError("至少需要保留一个可用管理员");

        if (patch.displayName !== undefined) user.displayName = normalizeDisplayName(patch.displayName || user.username);
        if (patch.email !== undefined) {
            const email = normalizeEmail(patch.email);
            if (email) {
                validateEmail(email);
                if (db.users.some((item) => item.id !== user.id && item.email?.toLowerCase() === email)) throw new AuthInputError("邮箱已被注册");
                user.email = email;
            } else {
                user.email = undefined;
            }
        }
        if (patch.password) {
            validatePassword(patch.password);
            user.passwordHash = hashPassword(patch.password);
            db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        }
        user.role = nextRole;
        user.status = nextStatus;
        if (patch.pointsBalance !== undefined) {
            const previousBalance = normalizePoints(user.pointsBalance, 0);
            user.pointsBalance = normalizePoints(patch.pointsBalance, user.pointsBalance);
            const delta = user.pointsBalance - previousBalance;
            if (delta !== 0) {
                addPointRecord(db, {
                    userId: user.id,
                    type: "admin-adjust",
                    amount: delta,
                    balanceAfter: user.pointsBalance,
                    description: "管理员后台调整",
                    createdAt: new Date().toISOString(),
                });
            }
        }
        user.updatedAt = new Date().toISOString();
        if (user.status !== "active") db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return toPublicUser(user, db);
    });
}

export async function deleteUserByAdmin(actorId: string, userId: string) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user) throw new AuthInputError("用户不存在");
        if (user.id === actorId) throw new AuthInputError("不能删除当前登录的管理员账号");
        if (user.role === "admin" && countActiveAdmins(db, user.id) === 0) throw new AuthInputError("至少需要保留一个管理员");
        db.users = db.users.filter((item) => item.id !== user.id);
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        db.quotaUsage = db.quotaUsage.filter((usage) => !usage || typeof usage !== "object" || (usage as { userId?: unknown }).userId !== user.id);
        db.checkIns = db.checkIns.filter((checkIn) => checkIn.userId !== user.id);
        db.emailCodes = db.emailCodes.filter((code) => code.userId !== user.id);
        return { ok: true };
    });
}

function toPublicUser(user: StoredUser, db?: AuthDatabase): PublicUser {
    const checkIn = db ? userCheckInState(db, user.id) : { checkedInToday: false, lastCheckInDate: undefined };
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        pointsBalance: normalizePoints(user.pointsBalance, DEFAULT_USER_POINTS),
        checkedInToday: checkIn.checkedInToday,
        lastCheckInDate: checkIn.lastCheckInDate,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
    };
}

async function readAuthDb(): Promise<AuthDatabase> {
    try {
        const raw = await readFile(AUTH_DATA_FILE, "utf8");
        return normalizeDb(JSON.parse(raw.trimStart().replace(/^\uFEFF/, "")) as Partial<AuthDatabase>);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
        throw error;
    }
}

async function mutateAuthDb<T>(mutator: (db: AuthDatabase) => T | Promise<T>) {
    const run = mutationQueue.then(async () => {
        const db = pruneExpiredSessions(await readAuthDb());
        const result = await mutator(db);
        await writeAuthDb(db);
        return result;
    });
    mutationQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

async function writeAuthDb(db: AuthDatabase) {
    await mkdir(dirname(AUTH_DATA_FILE), { recursive: true });
    await writeFile(AUTH_DATA_FILE, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function normalizeDb(db: Partial<AuthDatabase>): AuthDatabase {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(db.settings || {}) });
    return pruneExpiredSessions({
        version: 1,
        users: Array.isArray(db.users)
            ? db.users.map((user) => {
                  const legacyUser = user as Partial<StoredUser> & { quota?: Partial<LegacyUserQuota> };
                  return {
                      ...user,
                      pointsBalance: normalizePoints(legacyUser.pointsBalance, legacyQuotaToPoints(legacyUser.quota, settings.defaultPoints)),
                  } as StoredUser;
              })
            : [],
        sessions: Array.isArray(db.sessions) ? db.sessions : [],
        quotaUsage: Array.isArray(db.quotaUsage) ? db.quotaUsage : [],
        pointRecords: Array.isArray((db as Partial<AuthDatabase>).pointRecords) ? ((db as Partial<AuthDatabase>).pointRecords || []).map(normalizePointRecord).filter((item) => item.userId) : [],
        checkIns: Array.isArray(db.checkIns) ? db.checkIns.map(normalizeCheckIn).filter((item) => item.userId) : [],
        emailCodes: Array.isArray(db.emailCodes) ? db.emailCodes.map(normalizeEmailCode).filter((item) => item.email) : [],
        cdkCodes: Array.isArray(db.cdkCodes) ? db.cdkCodes.map(normalizeCdkCodeRecord).filter((item) => item.codeHash) : [],
        announcements: Array.isArray(db.announcements)
            ? db.announcements
                  .map(normalizeAnnouncement)
                  .filter((item) => item.title && item.content)
                  .slice(0, 200)
            : [],
        settings,
    });
}

function emptyDb(): AuthDatabase {
    return { version: 1, users: [], sessions: [], quotaUsage: [], pointRecords: [], checkIns: [], emailCodes: [], cdkCodes: [], announcements: [], settings: DEFAULT_SETTINGS };
}

function pruneExpiredSessions(db: AuthDatabase) {
    const now = Date.now();
    db.sessions = db.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    const minCheckInDate = new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
    db.checkIns = db.checkIns.filter((checkIn) => checkIn.date >= minCheckInDate);
    db.pointRecords = (db.pointRecords || []).slice(-10000);
    db.emailCodes = (db.emailCodes || []).filter((item) => !item.consumedAt && Date.parse(item.expiresAt) > now);
    db.cdkCodes = db.cdkCodes || [];
    db.announcements = (db.announcements || []).slice(0, 200);
    return db;
}

function countActiveAdmins(db: AuthDatabase, excludingUserId?: string) {
    return db.users.filter((user) => user.id !== excludingUserId && user.role === "admin" && user.status === "active").length;
}

function normalizeUsername(value: string) {
    return value.trim();
}

function normalizeEmail(value: unknown) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeDisplayName(value: string) {
    return value.trim().slice(0, 40);
}

function normalizeSettings(settings: AuthSettings): AuthSettings {
    const legacySettings = settings as AuthSettings & { defaultQuota?: Partial<LegacyUserQuota>; checkInReward?: Partial<LegacyUserQuota> };
    return {
        site: normalizeSiteSettings(settings.site),
        registrationEnabled: Boolean(settings.registrationEnabled),
        emailRegistrationEnabled: Boolean(settings.emailRegistrationEnabled),
        mail: normalizeMailSettings(settings.mail),
        allowUserApiConfig: false,
        defaultPoints: normalizePoints(settings.defaultPoints, legacyQuotaToPoints(legacySettings.defaultQuota, DEFAULT_USER_POINTS)),
        checkInRewardPoints: normalizePoints(settings.checkInRewardPoints, legacyQuotaToPoints(legacySettings.checkInReward, DEFAULT_CHECK_IN_REWARD_POINTS)),
        modelPointCosts: normalizeModelPointCosts(settings.modelPointCosts),
        generationPointMultipliers: normalizeGenerationPointMultipliers(settings.generationPointMultipliers),
        generationConcurrency: normalizeGenerationConcurrency(settings.generationConcurrency),
        generationDefaults: normalizeGenerationDefaults(settings.generationDefaults),
        generationAssetStorage: normalizeGenerationAssetStorage(settings.generationAssetStorage),
        webdav: normalizeWebdavSettings(settings.webdav),
        systemChannels: Array.isArray(settings.systemChannels) ? settings.systemChannels.map(normalizeSystemChannel).filter((channel) => channel.name || channel.baseUrl || channel.models.length) : [],
        defaultModels: {
            imageModel: settings.defaultModels?.imageModel || "",
            videoModel: settings.defaultModels?.videoModel || "",
            textModel: settings.defaultModels?.textModel || "",
            audioModel: settings.defaultModels?.audioModel || "",
        },
    };
}

function normalizeGenerationDefaults(settings: Partial<GenerationDefaultSettings> | undefined): GenerationDefaultSettings {
    return {
        canvasImageCount: Math.max(1, Math.min(10, Math.floor(Number(settings?.canvasImageCount) || DEFAULT_SETTINGS.generationDefaults.canvasImageCount))),
    };
}

function normalizeGenerationAssetStorage(settings: Partial<GenerationAssetStorageSettings> | undefined): GenerationAssetStorageSettings {
    return {
        imageServerFallback: settings?.imageServerFallback !== false,
        videoServerFallback: settings?.videoServerFallback !== false,
        imageServerDownload: settings?.imageServerDownload === true,
        videoServerDownload: settings?.videoServerDownload === true,
    };
}

function normalizeWebdavSettings(settings: Partial<WebdavSettings> | undefined): WebdavSettings {
    return {
        enabled: settings?.enabled === true,
        url: normalizeLinkUrl(settings?.url, ""),
        username: normalizeText(settings?.username, "", 160),
        password: typeof settings?.password === "string" ? settings.password.slice(0, 512) : "",
        directory: normalizeWebdavDirectory(settings?.directory),
    };
}

function normalizeWebdavDirectory(value: unknown) {
    const directory = typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
    return (directory || DEFAULT_WEBDAV_SETTINGS.directory).slice(0, 160);
}

function normalizeGenerationConcurrency(settings: Partial<GenerationConcurrencySettings> | undefined): GenerationConcurrencySettings {
    return {
        image: Math.max(1, Math.min(10, Math.floor(Number(settings?.image) || DEFAULT_SETTINGS.generationConcurrency.image))),
        video: Math.max(1, Math.min(5, Math.floor(Number(settings?.video) || DEFAULT_SETTINGS.generationConcurrency.video))),
    };
}

function normalizeSiteSettings(settings: Partial<SiteSettings> | undefined): SiteSettings {
    const title = normalizeText(settings?.title, DEFAULT_SITE_SETTINGS.title, 40);
    const seoTitle = normalizeText(settings?.seoTitle, title, 72);
    return {
        title,
        logoUrl: normalizeLogoUrl(settings?.logoUrl),
        seoTitle,
        seoDescription: normalizeText(settings?.seoDescription, DEFAULT_SITE_SETTINGS.seoDescription, 180),
        seoKeywords: normalizeText(settings?.seoKeywords, DEFAULT_SITE_SETTINGS.seoKeywords, 240),
        footerCopyright: normalizeText(settings?.footerCopyright, DEFAULT_SITE_SETTINGS.footerCopyright, 120),
        termsUrl: normalizeLinkUrl(settings?.termsUrl, DEFAULT_SITE_SETTINGS.termsUrl),
        privacyUrl: normalizeLinkUrl(settings?.privacyUrl, DEFAULT_SITE_SETTINGS.privacyUrl),
        homeShowcaseMode: settings?.homeShowcaseMode === "custom" ? "custom" : "random",
        homeShowcaseItems: normalizeSiteShowcaseItems(settings?.homeShowcaseItems),
        friendLinks: normalizeSiteFriendLinks(settings?.friendLinks),
        socials: normalizeSiteSocials(settings?.socials),
    };
}

function normalizeSiteShowcaseItems(settings: unknown): SiteShowcaseItem[] {
    if (!Array.isArray(settings)) return [];
    return settings
        .map((item, index) => {
            const value = item as Partial<SiteShowcaseItem>;
            const title = normalizeText(value.title, "", 80);
            const prompt = normalizeText(value.prompt, "", 3000);
            if (!title || !prompt) return null;
            return {
                id: normalizeText(value.id, `showcase-${index + 1}`, 80),
                title,
                coverUrl: normalizeLinkUrl(value.coverUrl, ""),
                prompt,
                tags: normalizeShowcaseTags(value.tags),
                category: normalizeText(value.category, "精选展示", 40),
            };
        })
        .filter((item): item is SiteShowcaseItem => Boolean(item))
        .slice(0, 8);
}

function normalizeShowcaseTags(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
    return Array.from(new Set(raw.map((tag) => String(tag || "").trim()).filter(Boolean))).slice(0, 4);
}

function normalizeSiteFriendLinks(settings: unknown): SiteFriendLink[] {
    const links = Array.isArray(settings) ? settings : DEFAULT_SITE_FRIEND_LINKS;
    const normalized = links
        .map((link, index) => {
            const value = link as Partial<SiteFriendLink>;
            return {
                id: normalizeText(value.id, `friend-${index + 1}`, 80),
                label: normalizeText(value.url?.replace(/\/$/, "") === "https://www.vozeb.com" ? "VOZEB" : value.label, "友情链接", 32),
                url: normalizeLinkUrl(value.url, ""),
                enabled: value.enabled !== false,
            };
        })
        .filter((link) => link.url)
        .slice(0, 12);
    for (const link of DEFAULT_SITE_FRIEND_LINKS) {
        if (normalized.some((item) => item.id === link.id || item.url.replace(/\/$/, "") === link.url.replace(/\/$/, ""))) continue;
        normalized.push(link);
    }
    const defaultOrdered = DEFAULT_SITE_FRIEND_LINKS.flatMap((link) => {
        const normalizedUrl = link.url.replace(/\/$/, "");
        const matched = normalized.find((item) => item.id === link.id || item.url.replace(/\/$/, "") === normalizedUrl);
        return matched ? [matched] : [];
    });
    const defaultKeys = new Set(DEFAULT_SITE_FRIEND_LINKS.flatMap((link) => [link.id, link.url.replace(/\/$/, "")]));
    const others = normalized.filter((link) => !defaultKeys.has(link.id) && !defaultKeys.has(link.url.replace(/\/$/, "")));
    return [...defaultOrdered, ...others].slice(0, 12);
}

function normalizeSiteSocials(settings: Partial<SiteSocialSettings> | undefined): SiteSocialSettings {
    return {
        email: normalizeSiteSocial("email", settings?.email),
        telegram: normalizeSiteSocial("telegram", settings?.telegram),
        x: normalizeSiteSocial("x", settings?.x),
        instagram: normalizeSiteSocial("instagram", settings?.instagram),
    };
}

function normalizeSiteSocial(key: SiteSocialKey, setting: Partial<SiteSocialSettings[SiteSocialKey]> | undefined) {
    const fallback = DEFAULT_SITE_SOCIALS[key];
    return {
        enabled: setting?.enabled !== false,
        label: normalizeText(setting?.label, fallback.label, 32),
        url: normalizeLinkUrl(setting?.url, fallback.url),
    };
}

function normalizeMailSettings(settings: Partial<MailSettings> | undefined): MailSettings {
    const port = Math.max(1, Math.min(65535, Math.floor(Number(settings?.port) || DEFAULT_MAIL_SETTINGS.port)));
    return {
        provider: normalizeText(settings?.provider, DEFAULT_MAIL_SETTINGS.provider, 40),
        host: normalizeText(settings?.host, DEFAULT_MAIL_SETTINGS.host, 120),
        port,
        secure: settings?.secure !== false,
        username: normalizeText(settings?.username, DEFAULT_MAIL_SETTINGS.username, 160),
        password: typeof settings?.password === "string" ? settings.password.slice(0, 512) : DEFAULT_MAIL_SETTINGS.password,
        fromEmail: normalizeText(settings?.fromEmail, DEFAULT_MAIL_SETTINGS.fromEmail, 160),
        fromName: normalizeText(settings?.fromName, DEFAULT_MAIL_SETTINGS.fromName, 60),
    };
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
    const text = typeof value === "string" ? repairKnownMojibakeText(value.trim()) : "";
    return (text || fallback).slice(0, maxLength);
}

function repairKnownMojibakeText(value: string) {
    if (value.includes("VOZEB") && value.includes("AI") && !value.includes("绘图") && value.includes(",")) return "VOZEB,AI 绘图,无限画布,提示词库,素材管理";
    if (value.includes("VOZEB") && value.includes("AI") && !value.includes("工作台")) return "面向 AI 图片创作与管理的 VOZEB 工作台";
    if (value.includes("2026 VOZEB") && !value.startsWith("©")) return "© 2026 VOZEB. All rights reserved.";
    if (value.startsWith("QQ ") && !value.includes("邮箱")) return "QQ 邮箱";
    return repairUtf8MojibakeText(value);
}

function repairUtf8MojibakeText(value: string) {
    if (!looksLikeUtf8Mojibake(value)) return value;
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) return value;
    return textQualityScore(repaired) > textQualityScore(value) ? repaired : value;
}

function looksLikeUtf8Mojibake(value: string) {
    if (!value) return false;
    if (/[\u0080-\u009f]/.test(value)) return true;
    if (/[ÂÃ][\u0080-\u00ff]/.test(value)) return true;
    const markers = value.match(/[åæçèéäöüï½ð]/g)?.length || 0;
    return markers >= 2 && !/[\u4e00-\u9fff]/.test(value);
}

function textQualityScore(value: string) {
    const cjk = value.match(/[\u4e00-\u9fff]/g)?.length || 0;
    const controls = value.match(/[\u0080-\u009f]/g)?.length || 0;
    const replacements = value.match(/\uFFFD/g)?.length || 0;
    const mojibakeMarkers = value.match(/[ÂÃåæçèéäöüï½ð]/g)?.length || 0;
    return cjk * 4 - controls * 6 - replacements * 20 - mojibakeMarkers;
}

function normalizeLogoUrl(value: unknown) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url) return DEFAULT_SITE_SETTINGS.logoUrl;
    if (url.startsWith("data:image/")) return url.slice(0, 500000);
    if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://") || url.startsWith("data:image/")) return url.slice(0, 2000);
    return DEFAULT_SITE_SETTINGS.logoUrl;
}

function normalizeLinkUrl(value: unknown, fallback: string) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url) return fallback;
    if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")) return url.slice(0, 2000);
    return fallback;
}

function normalizeSystemChannel(channel: Partial<SystemModelChannel>): SystemModelChannel {
    return {
        id: channel.id?.trim() || randomUUID(),
        name: repairKnownMojibakeText(channel.name?.trim() || "") || "通用接口",
        baseUrl: channel.baseUrl?.trim() || "",
        apiKey: channel.apiKey || "",
        apiFormat: channel.apiFormat === "gemini" ? "gemini" : "openai",
        models: Array.from(new Set((channel.models || []).map((model) => model.trim()).filter(Boolean))),
        enabled: channel.enabled !== false,
    };
}

function normalizePoints(value: unknown, fallback: number) {
    return normalizePointAmount(value, fallback);
}

function normalizePointAmount(value: unknown, fallback: number) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
    return Math.min(Number(numberValue.toFixed(2)), 1_000_000);
}

function normalizePointMultiplier(value: unknown, fallback = 1) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
    return Math.min(Number(numberValue.toFixed(2)), 1_000_000);
}

function normalizeModelPointCosts(value: unknown): ModelPointCosts {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([model, cost]) => [model.trim(), normalizePointMultiplier(cost)] as const)
            .filter(([model]) => Boolean(model)),
    );
}

function normalizeGenerationPointMultipliers(value: unknown): GenerationPointMultipliers {
    const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<GenerationPointMultipliers>) : {};
    return {
        imageQuality: normalizeMultiplierMap(source.imageQuality, DEFAULT_GENERATION_POINT_MULTIPLIERS.imageQuality),
        videoQuality: normalizeMultiplierMap(source.videoQuality, DEFAULT_GENERATION_POINT_MULTIPLIERS.videoQuality),
        videoSeconds: normalizeMultiplierMap(source.videoSeconds, DEFAULT_GENERATION_POINT_MULTIPLIERS.videoSeconds),
    };
}

function normalizeMultiplierMap(value: unknown, defaults: Record<string, number>) {
    const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
    return {
        ...defaults,
        ...Object.fromEntries(entries.map(([key, multiplier]) => [key.trim(), normalizePointMultiplier(multiplier)] as const).filter(([key]) => Boolean(key))),
    };
}

function resolveModelPointCost(costs: ModelPointCosts, model: string) {
    const modelName = model.trim();
    const matchedKey = Object.keys(costs || {}).find((key) => key.toLowerCase() === modelName.toLowerCase());
    return normalizePointMultiplier(costs[matchedKey || DEFAULT_MODEL_POINT_COST_KEY], 1);
}

function buildPointRecordDescription(model: string, usageKind: PointUsageKind, action: "consume" | "refund") {
    const modelName = model.trim() || "默认模型";
    const actionLabels: Record<PointUsageKind, { consume: string; refund: string }> = {
        api: { consume: "模型调用扣除", refund: "模型调用失败退回" },
        image: { consume: "生成图片调用扣除", refund: "生成图片调用失败退回" },
        video: { consume: "生成视频调用扣除", refund: "生成视频调用失败退回" },
        audio: { consume: "生成音频调用扣除", refund: "生成音频调用失败退回" },
        text: { consume: "生成文本调用扣除", refund: "生成文本调用失败退回" },
    };
    return `${modelName} ${actionLabels[usageKind]?.[action] || actionLabels.api[action]}`;
}

function legacyQuotaToPoints(quota: Partial<LegacyUserQuota> | undefined, fallback: number) {
    if (!quota || typeof quota !== "object") return fallback;
    return normalizePoints(quota.imageDaily, fallback);
}

function normalizeCheckIn(value: Partial<StoredCheckIn>): StoredCheckIn {
    const legacy = value as Partial<StoredCheckIn> & { reward?: Partial<LegacyUserQuota> };
    return {
        userId: value.userId || "",
        date: /^\d{4}-\d{2}-\d{2}$/.test(value.date || "") ? value.date! : currentQuotaDate(),
        rewardPoints: normalizePoints(value.rewardPoints, legacyQuotaToPoints(legacy.reward, DEFAULT_CHECK_IN_REWARD_POINTS)),
        createdAt: value.createdAt || new Date().toISOString(),
    };
}

function toPublicCdkCode(code: StoredCdkCode, db?: AuthDatabase, options?: { includePlain?: boolean }): PublicCdkCode {
    return {
        id: code.id,
        codePreview: code.codePreview,
        ...(options?.includePlain && code.code ? { code: code.code } : {}),
        points: code.points,
        maxRedemptions: code.maxRedemptions,
        redeemedCount: code.redeemedCount,
        redemptions: (code.redemptions || []).map((redemption) => {
            const user = db?.users.find((item) => item.id === redemption.userId);
            return {
                userId: redemption.userId,
                username: user?.username || "已删除用户",
                displayName: user?.displayName || user?.username || "已删除用户",
                redeemedAt: redemption.redeemedAt,
            };
        }),
        status: code.status,
        note: code.note,
        expiresAt: code.expiresAt,
        createdAt: code.createdAt,
        updatedAt: code.updatedAt,
    };
}

function isCdkCodeExpired(code: PublicCdkCode) {
    return Boolean(code.expiresAt && Date.parse(code.expiresAt) <= Date.now());
}

function normalizeCdkCodeRecord(value: Partial<StoredCdkCode>): StoredCdkCode {
    const redemptions = Array.isArray(value.redemptions)
        ? value.redemptions
              .map((item) => ({
                  userId: typeof item?.userId === "string" ? item.userId : "",
                  redeemedAt: typeof item?.redeemedAt === "string" ? item.redeemedAt : new Date().toISOString(),
              }))
              .filter((item) => item.userId)
        : [];
    const plainCode = formatCdkCodeForDisplay(value.code || "");
    const codePreview = normalizeText(value.codePreview || (plainCode ? previewCdkCode(plainCode) : ""), "CDK-****", 40);
    const codeHash = typeof value.codeHash === "string" && value.codeHash ? value.codeHash : plainCode ? hashToken(normalizeCdkCode(plainCode)) : "";
    const now = new Date().toISOString();
    return {
        id: value.id || randomUUID(),
        codePreview,
        ...(plainCode ? { code: plainCode } : {}),
        points: normalizePoints(value.points, 10),
        maxRedemptions: Math.max(redemptions.length || 1, Math.min(10000, Math.floor(Number(value.maxRedemptions) || 1))),
        redeemedCount: redemptions.length,
        status: value.status === "disabled" ? "disabled" : "active",
        note: normalizeText(value.note, "", 120),
        codeHash,
        redemptions,
        ...(normalizeOptionalIsoDate(value.expiresAt) ? { expiresAt: normalizeOptionalIsoDate(value.expiresAt) } : {}),
        createdAt: value.createdAt || now,
        updatedAt: value.updatedAt || value.createdAt || now,
    };
}

function normalizeCdkCode(value: string) {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function generateCdkPlainCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const chars = Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join("");
    return `VZ-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

function formatCdkCodeForDisplay(value: string) {
    const code = normalizeCdkCode(value);
    if (!code) return "";
    if (code.startsWith("VZ") && code.length === 22) return `${code.slice(0, 2)}-${code.slice(2, 7)}-${code.slice(7, 12)}-${code.slice(12, 17)}-${code.slice(17, 22)}`;
    return code;
}

function previewCdkCode(value: string) {
    const code = normalizeCdkCode(value);
    if (code.length <= 8) return `${code.slice(0, 2)}****`;
    return `${code.slice(0, 4)}****${code.slice(-4)}`;
}

function normalizeAnnouncement(value: Partial<PublicAnnouncement>): PublicAnnouncement {
    const now = new Date().toISOString();
    const startsAt = normalizeOptionalIsoDate(value.startsAt);
    const endsAt = normalizeOptionalIsoDate(value.endsAt);
    return {
        id: value.id || randomUUID(),
        title: normalizeText(value.title, "", 80),
        content: normalizeText(value.content, "", 3000),
        enabled: value.enabled !== false,
        popupHome: value.popupHome === true,
        popupAfterLogin: value.popupAfterLogin === true,
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
        createdAt: value.createdAt || now,
        updatedAt: value.updatedAt || value.createdAt || now,
    };
}

function isAnnouncementVisible(announcement: PublicAnnouncement) {
    if (!announcement.enabled) return false;
    const now = Date.now();
    if (announcement.startsAt && Date.parse(announcement.startsAt) > now) return false;
    if (announcement.endsAt && Date.parse(announcement.endsAt) <= now) return false;
    return true;
}

function normalizeOptionalIsoDate(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return undefined;
    return new Date(time).toISOString();
}

function resolveCdkExpiresAt(expiresAt: unknown, expiresInDays: unknown) {
    const explicitDate = normalizeOptionalIsoDate(expiresAt);
    if (explicitDate) return explicitDate;
    const days = Math.floor(Number(expiresInDays));
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return new Date(Date.now() + Math.min(days, 3650) * 24 * 60 * 60 * 1000).toISOString();
}

function normalizePointRecord(value: Partial<StoredPointRecord>): StoredPointRecord {
    const type = value.type === "consume" || value.type === "admin-adjust" ? value.type : "check-in";
    return {
        id: value.id || randomUUID(),
        userId: value.userId || "",
        type,
        amount: Number.isFinite(Number(value.amount)) ? Number(value.amount) : 0,
        balanceAfter: normalizePoints(value.balanceAfter, 0),
        description: normalizeText(value.description, type === "consume" ? "积分消耗" : "积分增加", 120),
        model: typeof value.model === "string" ? value.model.slice(0, 160) : undefined,
        createdAt: value.createdAt || new Date().toISOString(),
    };
}

function addPointRecord(db: AuthDatabase, record: Omit<StoredPointRecord, "id">) {
    db.pointRecords = db.pointRecords || [];
    db.pointRecords.push({ id: randomUUID(), ...record });
}

function normalizeEmailCode(value: Partial<StoredEmailCode>): StoredEmailCode {
    return {
        id: value.id || randomUUID(),
        purpose: value.purpose === "email-change" || value.purpose === "password-reset" ? value.purpose : "register",
        email: normalizeEmail(value.email),
        userId: value.userId,
        codeHash: value.codeHash || "",
        createdAt: value.createdAt || new Date().toISOString(),
        expiresAt: value.expiresAt || new Date(0).toISOString(),
        consumedAt: value.consumedAt,
    };
}

function consumeEmailCode(db: AuthDatabase, input: { purpose: EmailCodePurpose; email: string; code?: string; userId?: string }) {
    const code = typeof input.code === "string" ? input.code.trim() : "";
    if (!/^\d{6}$/.test(code)) throw new AuthInputError("请输入 6 位邮箱验证码");
    const email = normalizeEmail(input.email);
    const item = db.emailCodes.find((entry) => entry.purpose === input.purpose && entry.email === email && entry.userId === input.userId && !entry.consumedAt && Date.parse(entry.expiresAt) > Date.now());
    if (!item || item.codeHash !== hashToken(code)) throw new AuthInputError("邮箱验证码不正确或已过期");
    item.consumedAt = new Date().toISOString();
}

function userCheckInState(db: AuthDatabase, userId: string) {
    const today = currentQuotaDate();
    const dates = db.checkIns
        .filter((item) => item.userId === userId)
        .map((item) => item.date)
        .sort();
    const lastCheckInDate = dates[dates.length - 1];
    return { checkedInToday: lastCheckInDate === today, lastCheckInDate };
}

function currentQuotaDate() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function validateUsername(username: string) {
    if (!USERNAME_PATTERN.test(username)) throw new AuthInputError("用户名只能使用 3-32 位字母、数字、下划线、点或短横线");
}

function validateEmail(email: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw new AuthInputError("邮箱格式不正确");
}

function validatePassword(password: string) {
    if (password.length < 8) throw new AuthInputError("密码至少需要 8 位");
    if (password.length > 128) throw new AuthInputError("密码不能超过 128 位");
}

function parseSessionCookie(cookieValue: string | undefined) {
    if (!cookieValue) return null;
    const separatorIndex = cookieValue.indexOf(".");
    if (separatorIndex < 0) return null;
    return { id: cookieValue.slice(0, separatorIndex), token: cookieValue.slice(separatorIndex + 1) };
}

function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

function randomNumericCode() {
    return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}
