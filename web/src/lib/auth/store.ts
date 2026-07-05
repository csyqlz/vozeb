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

export type GenerationAssetStorageSettings = {
    imageServerFallback: boolean;
    videoServerFallback: boolean;
    imageServerDownload: boolean;
    videoServerDownload: boolean;
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
    generationConcurrency: GenerationConcurrencySettings;
    generationAssetStorage: GenerationAssetStorageSettings;
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
const DEFAULT_SETTINGS: AuthSettings = {
    site: DEFAULT_SITE_SETTINGS,
    registrationEnabled: true,
    emailRegistrationEnabled: false,
    mail: DEFAULT_MAIL_SETTINGS,
    allowUserApiConfig: true,
    defaultPoints: DEFAULT_USER_POINTS,
    checkInRewardPoints: DEFAULT_CHECK_IN_REWARD_POINTS,
    modelPointCosts: {},
    generationConcurrency: { image: 4, video: 1 },
    generationAssetStorage: {
        imageServerFallback: true,
        videoServerFallback: true,
        imageServerDownload: false,
        videoServerDownload: false,
    },
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

export async function listPointRecords(userId: string, limit = 50) {
    const db = await readAuthDb();
    return (db.pointRecords || [])
        .filter((record) => record.userId === userId)
        .map(toPublicPointRecord)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, Math.max(1, Math.min(200, Math.floor(Number(limit) || 50))));
}

function toPublicPointRecord(record: StoredPointRecord): PublicPointRecord {
    return { ...record, description: displayPointRecordDescription(record) };
}

function displayPointRecordDescription(record: StoredPointRecord) {
    const description = record.description.trim();
    const model = (record.model || "").trim();
    if (!model) return description;
    if (record.type === "consume" && description.startsWith("管理员接口调用：")) {
        return buildPointRecordDescription(model, legacyPointUsageKindFromModel(model), "consume");
    }
    if (record.type === "admin-adjust" && description.startsWith("接口调用失败退回：")) {
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
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");

        const today = currentQuotaDate();
        if (db.checkIns.some((item) => item.userId === userId && item.date === today)) throw new AuthInputError("今天已经签到过了");

        const rewardPoints = normalizePoints(db.settings.checkInRewardPoints, DEFAULT_CHECK_IN_REWARD_POINTS);
        user.pointsBalance = normalizePoints(user.pointsBalance, db.settings.defaultPoints) + rewardPoints;
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
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");

        const multiplier = resolveModelPointCost(db.settings.modelPointCosts, model);
        const units = Math.max(1, Math.min(1000, Math.floor(Number(amount) || 1)));
        const cost = Math.max(0, Math.ceil(units * multiplier));
        const balance = normalizePoints(user.pointsBalance, db.settings.defaultPoints);

        if (cost > balance) {
            throw new QuotaExceededError(`积分不足，当前余额 ${balance}，本次需要 ${cost}`);
        }

        user.pointsBalance = balance - cost;
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

        const refund = Math.max(0, Math.floor(Number(amount) || 0));
        if (!refund) return toPublicUser(user, db);

        user.pointsBalance = normalizePoints(user.pointsBalance, db.settings.defaultPoints) + refund;
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
        if (!firstUser && !db.settings.registrationEnabled) throw new AuthInputError("当前站点已关闭注册");
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
        if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new AuthInputError("Username already exists");
        if (email && db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("Email already exists");

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
            description: "Admin created user",
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
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new AuthInputError("用户名、邮箱或密码不正确");
    if (user.status !== "active") throw new AuthInputError("该账号已被禁用");

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
            throw new AuthInputError("该邮箱未绑定账号");
        }

        const code = randomNumericCode();
        const activeCode = db.emailCodes.find((item) => item.purpose === input.purpose && item.email === email && item.userId === input.userId && !item.consumedAt && Date.parse(item.expiresAt) > now.getTime());
        if (activeCode && now.getTime() - Date.parse(activeCode.createdAt) < EMAIL_CODE_RESEND_COOLDOWN_MS) {
            throw new AuthInputError("验证码发送太频繁，请 60 秒后再试");
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
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");

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
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");
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
        if (!user || user.status !== "active") throw new AuthInputError("该邮箱未绑定可用账号");
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
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");

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
        if (user.id === actorId && patch.status === "disabled") throw new AuthInputError("不能禁用当前管理员账号");

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
        return normalizeDb(JSON.parse(raw) as Partial<AuthDatabase>);
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
        settings,
    });
}

function emptyDb(): AuthDatabase {
    return { version: 1, users: [], sessions: [], quotaUsage: [], pointRecords: [], checkIns: [], emailCodes: [], settings: DEFAULT_SETTINGS };
}

function pruneExpiredSessions(db: AuthDatabase) {
    const now = Date.now();
    db.sessions = db.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    const minCheckInDate = new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
    db.checkIns = db.checkIns.filter((checkIn) => checkIn.date >= minCheckInDate);
    db.pointRecords = (db.pointRecords || []).slice(-10000);
    db.emailCodes = (db.emailCodes || []).filter((item) => !item.consumedAt && Date.parse(item.expiresAt) > now);
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
        allowUserApiConfig: settings.allowUserApiConfig !== false,
        defaultPoints: normalizePoints(settings.defaultPoints, legacyQuotaToPoints(legacySettings.defaultQuota, DEFAULT_USER_POINTS)),
        checkInRewardPoints: normalizePoints(settings.checkInRewardPoints, legacyQuotaToPoints(legacySettings.checkInReward, DEFAULT_CHECK_IN_REWARD_POINTS)),
        modelPointCosts: normalizeModelPointCosts(settings.modelPointCosts),
        generationConcurrency: normalizeGenerationConcurrency(settings.generationConcurrency),
        generationAssetStorage: normalizeGenerationAssetStorage(settings.generationAssetStorage),
        systemChannels: Array.isArray(settings.systemChannels) ? settings.systemChannels.map(normalizeSystemChannel).filter((channel) => channel.name || channel.baseUrl || channel.models.length) : [],
        defaultModels: {
            imageModel: settings.defaultModels?.imageModel || "",
            videoModel: settings.defaultModels?.videoModel || "",
            textModel: settings.defaultModels?.textModel || "",
            audioModel: settings.defaultModels?.audioModel || "",
        },
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
                category: normalizeText(value.category, "首页展示", 40),
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
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback).slice(0, maxLength);
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
        name: channel.name?.trim() || "默认渠道",
        baseUrl: channel.baseUrl?.trim() || "",
        apiKey: channel.apiKey || "",
        apiFormat: "openai",
        models: Array.from(new Set((channel.models || []).map((model) => model.trim()).filter(Boolean))),
        enabled: channel.enabled !== false,
    };
}

function normalizePoints(value: unknown, fallback: number) {
    const numberValue = Math.floor(Number(value));
    if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
    return Math.min(numberValue, 1_000_000);
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

function resolveModelPointCost(costs: ModelPointCosts, model: string) {
    const modelName = model.trim();
    const matchedKey = Object.keys(costs || {}).find((key) => key.toLowerCase() === modelName.toLowerCase());
    return normalizePointMultiplier(costs[matchedKey || DEFAULT_MODEL_POINT_COST_KEY], 1);
}

function buildPointRecordDescription(model: string, usageKind: PointUsageKind, action: "consume" | "refund") {
    const modelName = model.trim() || "模型";
    const actionLabels: Record<PointUsageKind, { consume: string; refund: string }> = {
        api: { consume: "接口调用扣除", refund: "接口调用失败退回" },
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
    if (!/^\d{6}$/.test(code)) throw new AuthInputError("请填写 6 位邮箱验证码");
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
    if (!USERNAME_PATTERN.test(username)) throw new AuthInputError("用户名需为 3-32 位字母、数字、下划线、点或短横线");
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
