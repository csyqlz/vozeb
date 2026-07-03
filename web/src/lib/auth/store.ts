import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { hashPassword, verifyPassword } from "./password";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";
export type ApiCallFormat = "openai" | "gemini";

export type UserQuota = {
    imageDaily: number;
    videoDaily: number;
    textDaily: number;
    audioDaily: number;
};

export type QuotaKind = "image" | "video" | "text" | "audio";

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

export type SiteSettings = {
    title: string;
    logoUrl: string;
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    termsUrl: string;
    privacyUrl: string;
    socials: SiteSocialSettings;
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
    quota: UserQuota;
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

type StoredQuotaUsage = {
    userId: string;
    date: string;
    imageDaily: number;
    videoDaily: number;
    textDaily: number;
    audioDaily: number;
    updatedAt: string;
};

type StoredCheckIn = {
    userId: string;
    date: string;
    reward: UserQuota;
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
    defaultQuota: UserQuota;
    checkInReward: UserQuota;
    systemChannels: SystemModelChannel[];
    defaultModels: SystemDefaultModels;
};

type AuthDatabase = {
    version: 1;
    users: StoredUser[];
    sessions: StoredSession[];
    quotaUsage: StoredQuotaUsage[];
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
export const DEFAULT_USER_QUOTA: UserQuota = { imageDaily: 100, videoDaily: 20, textDaily: 500, audioDaily: 100 };
export const DEFAULT_CHECK_IN_REWARD: UserQuota = { imageDaily: 5, videoDaily: 1, textDaily: 20, audioDaily: 5 };
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
    title: "VOZEB",
    logoUrl: "/logo.svg",
    seoTitle: "VOZEB",
    seoDescription: "面向 AI 图片创作与管理的 VOZEB 工作台",
    seoKeywords: "VOZEB,AI 绘图,无限画布,提示词库,素材管理",
    footerCopyright: "© 2026 VOZEB. All rights reserved.",
    termsUrl: "/terms",
    privacyUrl: "/privacy",
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
    defaultQuota: DEFAULT_USER_QUOTA,
    checkInReward: DEFAULT_CHECK_IN_REWARD,
    systemChannels: [],
    defaultModels: { imageModel: "", videoModel: "", textModel: "", audioModel: "" },
};
const AUTH_DATA_FILE = resolve(process.cwd(), ".data", "auth.json");
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

export async function checkInUser(userId: string) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");

        const today = currentQuotaDate();
        if (db.checkIns.some((item) => item.userId === userId && item.date === today)) throw new AuthInputError("今天已经签到过了");

        const reward = normalizeQuota(db.settings.checkInReward, DEFAULT_CHECK_IN_REWARD);
        user.quota = addQuota(normalizeQuota(user.quota, db.settings.defaultQuota), reward);
        user.updatedAt = new Date().toISOString();
        db.checkIns.push({ userId, date: today, reward, createdAt: user.updatedAt });
        return { user: toPublicUser(user, db), reward, date: today };
    });
}

export async function consumeUserQuota(userId: string, kind: QuotaKind, amount = 1) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("账号不可用");

        const quotaKey = quotaKeyByKind(kind);
        const quota = normalizeQuota(user.quota, db.settings.defaultQuota);
        const requested = Math.max(1, Math.min(1000, Math.floor(Number(amount) || 1)));
        const today = currentQuotaDate();
        const now = new Date().toISOString();
        let usage = db.quotaUsage.find((item) => item.userId === userId && item.date === today);
        if (!usage) {
            usage = { userId, date: today, imageDaily: 0, videoDaily: 0, textDaily: 0, audioDaily: 0, updatedAt: now };
            db.quotaUsage.push(usage);
        }

        if (usage[quotaKey] + requested > quota[quotaKey]) {
            throw new QuotaExceededError(`今日${quotaKindLabel(kind)}额度不足，剩余 ${Math.max(0, quota[quotaKey] - usage[quotaKey])}`);
        }

        usage[quotaKey] += requested;
        usage.updatedAt = now;
        return { date: today, used: usage[quotaKey], limit: quota[quotaKey], remaining: Math.max(0, quota[quotaKey] - usage[quotaKey]) };
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
            quota: db.settings.defaultQuota,
            passwordHash: hashPassword(input.password),
            createdAt: now,
            updatedAt: now,
        };
        db.users.push(user);
        return toPublicUser(user, db);
    });
}

export async function authenticateUser(input: { username: string; password: string }) {
    const username = normalizeUsername(input.username);
    const db = await readAuthDb();
    const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new AuthInputError("用户名或密码不正确");
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

export async function updateUserByAdmin(actorId: string, userId: string, patch: Partial<Pick<PublicUser, "displayName" | "email" | "role" | "status">> & { quota?: Partial<UserQuota>; password?: string }) {
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
        if (patch.quota) user.quota = normalizeQuota(patch.quota, db.settings.defaultQuota);
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
        db.quotaUsage = db.quotaUsage.filter((usage) => usage.userId !== user.id);
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
        quota: normalizeQuota(user.quota, DEFAULT_USER_QUOTA),
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
            ? db.users.map((user) => ({
                  ...user,
                  quota: normalizeQuota(user.quota, settings.defaultQuota),
              }))
            : [],
        sessions: Array.isArray(db.sessions) ? db.sessions : [],
        quotaUsage: Array.isArray(db.quotaUsage) ? db.quotaUsage.map(normalizeQuotaUsage).filter(Boolean) : [],
        checkIns: Array.isArray(db.checkIns) ? db.checkIns.map(normalizeCheckIn).filter((item) => item.userId) : [],
        emailCodes: Array.isArray(db.emailCodes) ? db.emailCodes.map(normalizeEmailCode).filter((item) => item.email) : [],
        settings,
    });
}

function emptyDb(): AuthDatabase {
    return { version: 1, users: [], sessions: [], quotaUsage: [], checkIns: [], emailCodes: [], settings: DEFAULT_SETTINGS };
}

function pruneExpiredSessions(db: AuthDatabase) {
    const now = Date.now();
    db.sessions = db.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    const minDate = new Date(now - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);
    db.quotaUsage = db.quotaUsage.filter((usage) => usage.date >= minDate);
    const minCheckInDate = new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
    db.checkIns = db.checkIns.filter((checkIn) => checkIn.date >= minCheckInDate);
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
    const defaultQuota = normalizeQuota(settings.defaultQuota, DEFAULT_USER_QUOTA);
    return {
        site: normalizeSiteSettings(settings.site),
        registrationEnabled: Boolean(settings.registrationEnabled),
        emailRegistrationEnabled: Boolean(settings.emailRegistrationEnabled),
        mail: normalizeMailSettings(settings.mail),
        allowUserApiConfig: settings.allowUserApiConfig !== false,
        defaultQuota,
        checkInReward: normalizeQuota(settings.checkInReward, DEFAULT_CHECK_IN_REWARD),
        systemChannels: Array.isArray(settings.systemChannels) ? settings.systemChannels.map(normalizeSystemChannel).filter((channel) => channel.name || channel.baseUrl || channel.models.length) : [],
        defaultModels: {
            imageModel: settings.defaultModels?.imageModel || "",
            videoModel: settings.defaultModels?.videoModel || "",
            textModel: settings.defaultModels?.textModel || "",
            audioModel: settings.defaultModels?.audioModel || "",
        },
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
        socials: normalizeSiteSocials(settings?.socials),
    };
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

function normalizeQuota(quota: Partial<UserQuota> | undefined, fallback: UserQuota): UserQuota {
    return {
        imageDaily: normalizeQuotaNumber(quota?.imageDaily, fallback.imageDaily),
        videoDaily: normalizeQuotaNumber(quota?.videoDaily, fallback.videoDaily),
        textDaily: normalizeQuotaNumber(quota?.textDaily, fallback.textDaily),
        audioDaily: normalizeQuotaNumber(quota?.audioDaily, fallback.audioDaily),
    };
}

function normalizeQuotaNumber(value: unknown, fallback: number) {
    const numberValue = Math.floor(Number(value));
    if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
    return Math.min(numberValue, 1_000_000);
}

function normalizeQuotaUsage(value: Partial<StoredQuotaUsage>): StoredQuotaUsage {
    return {
        userId: value.userId || "",
        date: /^\d{4}-\d{2}-\d{2}$/.test(value.date || "") ? value.date! : currentQuotaDate(),
        imageDaily: normalizeQuotaNumber(value.imageDaily, 0),
        videoDaily: normalizeQuotaNumber(value.videoDaily, 0),
        textDaily: normalizeQuotaNumber(value.textDaily, 0),
        audioDaily: normalizeQuotaNumber(value.audioDaily, 0),
        updatedAt: value.updatedAt || new Date().toISOString(),
    };
}

function normalizeCheckIn(value: Partial<StoredCheckIn>): StoredCheckIn {
    return {
        userId: value.userId || "",
        date: /^\d{4}-\d{2}-\d{2}$/.test(value.date || "") ? value.date! : currentQuotaDate(),
        reward: normalizeQuota(value.reward, DEFAULT_CHECK_IN_REWARD),
        createdAt: value.createdAt || new Date().toISOString(),
    };
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

function addQuota(current: UserQuota, reward: UserQuota): UserQuota {
    return {
        imageDaily: normalizeQuotaNumber(current.imageDaily + reward.imageDaily, current.imageDaily),
        videoDaily: normalizeQuotaNumber(current.videoDaily + reward.videoDaily, current.videoDaily),
        textDaily: normalizeQuotaNumber(current.textDaily + reward.textDaily, current.textDaily),
        audioDaily: normalizeQuotaNumber(current.audioDaily + reward.audioDaily, current.audioDaily),
    };
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

function quotaKeyByKind(kind: QuotaKind): keyof UserQuota {
    if (kind === "video") return "videoDaily";
    if (kind === "text") return "textDaily";
    if (kind === "audio") return "audioDaily";
    return "imageDaily";
}

function quotaKindLabel(kind: QuotaKind) {
    if (kind === "video") return "视频";
    if (kind === "text") return "文本";
    if (kind === "audio") return "音频";
    return "图片";
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
