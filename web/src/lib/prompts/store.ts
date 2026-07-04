import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AuthInputError } from "@/lib/auth/store";
import originalAuthorSeeds from "@/lib/prompts/original-author-seeds.json";

export type PromptScope = "library" | "user";

export type StoredPrompt = {
    id: string;
    scope: PromptScope;
    ownerUserId?: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    preview: string;
    githubUrl?: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
};

export type PromptInput = {
    title?: string;
    coverUrl?: string;
    prompt?: string;
    tags?: string[] | string;
    category?: string;
    preview?: string;
};

type PromptDatabase = {
    version: 1;
    prompts: StoredPrompt[];
    seedSources: string[];
};

type OriginalAuthorSeed = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    preview: string;
    githubUrl: string;
};

type PromptListOptions = {
    scope: PromptScope;
    ownerUserId?: string;
    keyword?: string;
    tags?: string[];
    category?: string;
    page?: number;
    pageSize?: number;
};

const PROMPT_DATA_FILE = resolve(process.cwd(), ".data", "prompts.json");
const DEFAULT_COVER_URL = "";
const LEGACY_ORIGINAL_AUTHOR_SEED_SOURCE_PREFIX = `basketikun/${"in"}finite-canvas-prompts`;
const ORIGINAL_AUTHOR_SEED_SOURCE_PREFIX = "vozeb/original-author-prompts";
const ORIGINAL_AUTHOR_SEED_SOURCE = `${ORIGINAL_AUTHOR_SEED_SOURCE_PREFIX}:v3`;
let mutationQueue = Promise.resolve();

export async function listPrompts(options: PromptListOptions) {
    const db = await readPromptDb({ includeSeeds: true });
    const keyword = (options.keyword || "").trim().toLowerCase();
    const tags = options.tags || [];
    const category = options.category || "";
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.max(1, Math.min(100, options.pageSize || 20));
    const base = db.prompts
        .filter((item) => item.scope === options.scope)
        .filter((item) => (options.scope === "user" ? item.ownerUserId === options.ownerUserId : true))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const withoutTagFilter = filterPrompts(base, { keyword, category, tags: [] });
    const filtered = filterPrompts(base, { keyword, category, tags });

    return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        tags: collectTags(withoutTagFilter),
        categories: collectCategories(base),
        total: filtered.length,
    };
}

export async function listAllLibraryPrompts() {
    const db = await readPromptDb({ includeSeeds: true });
    return db.prompts.filter((item) => item.scope === "library").sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function countAllLibraryPrompts() {
    const db = await readPromptDb({ includeSeeds: true });
    return db.prompts.filter((item) => item.scope === "library").length;
}

export async function createPrompt(scope: PromptScope, input: PromptInput, ownerUserId?: string) {
    return mutatePromptDb((db) => {
        const now = new Date().toISOString();
        const prompt = normalizePromptInput(input);
        const item: StoredPrompt = {
            id: randomUUID(),
            scope,
            ownerUserId: scope === "user" ? ownerUserId : undefined,
            title: prompt.title,
            coverUrl: prompt.coverUrl,
            prompt: prompt.prompt,
            tags: prompt.tags,
            category: prompt.category,
            preview: prompt.preview,
            createdAt: now,
            updatedAt: now,
        };
        db.prompts.push(item);
        return item;
    });
}

export async function updatePrompt(id: string, input: PromptInput, options: { scope: PromptScope; ownerUserId?: string }) {
    return mutatePromptDb((db) => {
        const item = db.prompts.find((prompt) => prompt.id === id && prompt.scope === options.scope && (options.scope === "library" || prompt.ownerUserId === options.ownerUserId));
        if (!item) throw new AuthInputError("提示词不存在");
        const next = normalizePromptInput({ ...item, ...input });
        item.title = next.title;
        item.coverUrl = next.coverUrl;
        item.prompt = next.prompt;
        item.tags = next.tags;
        item.category = next.category;
        item.preview = next.preview;
        item.updatedAt = new Date().toISOString();
        return item;
    });
}

export async function deletePrompt(id: string, options: { scope: PromptScope; ownerUserId?: string }) {
    return mutatePromptDb((db) => {
        const before = db.prompts.length;
        db.prompts = db.prompts.filter((prompt) => !(prompt.id === id && prompt.scope === options.scope && (options.scope === "library" || prompt.ownerUserId === options.ownerUserId)));
        if (db.prompts.length === before) throw new AuthInputError("提示词不存在");
        return { ok: true };
    });
}

function filterPrompts(items: StoredPrompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function normalizePromptInput(input: PromptInput) {
    const title = (input.title || "").trim();
    const prompt = (input.prompt || "").trim();
    if (!title) throw new AuthInputError("请输入标题");
    if (!prompt) throw new AuthInputError("请输入提示词内容");
    return {
        title: title.slice(0, 120),
        coverUrl: (input.coverUrl || DEFAULT_COVER_URL).trim(),
        prompt,
        tags: normalizeTags(input.tags),
        category: (input.category || "默认").trim().slice(0, 40) || "默认",
        preview: (input.preview || "").trim(),
    };
}

function normalizeTags(value: PromptInput["tags"]) {
    const raw = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
    return Array.from(new Set(raw.map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 12);
}

async function readPromptDb({ includeSeeds }: { includeSeeds: boolean }): Promise<PromptDatabase> {
    try {
        const raw = await readFile(PROMPT_DATA_FILE, "utf8");
        const db = JSON.parse(raw) as Partial<PromptDatabase>;
        const normalized: PromptDatabase = {
            version: 1,
            prompts: Array.isArray(db.prompts) ? db.prompts.map(normalizeStoredPrompt).filter(Boolean) : [],
            seedSources: Array.isArray(db.seedSources) ? db.seedSources.filter(Boolean) : [],
        };
        return includeSeeds ? ensureOriginalAuthorPrompts(normalized) : normalized;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            const empty = { version: 1 as const, prompts: [], seedSources: [] };
            return includeSeeds ? ensureOriginalAuthorPrompts(empty) : empty;
        }
        throw error;
    }
}

async function ensureOriginalAuthorPrompts(db: PromptDatabase) {
    if (db.seedSources.includes(ORIGINAL_AUTHOR_SEED_SOURCE)) return db;
    const seeds = originalAuthorSeeds as OriginalAuthorSeed[];
    if (!seeds.length) return db;
    const now = new Date().toISOString();
    db.prompts = db.prompts.filter((item) => !isOriginalAuthorSeedSource(item.source));
    db.seedSources = db.seedSources.filter((source) => !isOriginalAuthorSeedSource(source));
    const existingIds = new Set(db.prompts.map((item) => item.id));
    const seededPrompts = seeds
        .map((seed): StoredPrompt => ({
            id: `original-${seed.id}`,
            scope: "library",
            title: seed.title,
            coverUrl: seed.coverUrl,
            prompt: seed.prompt,
            tags: normalizeTags(seed.tags),
            category: seed.category,
            preview: seed.preview,
            githubUrl: seed.githubUrl,
            source: ORIGINAL_AUTHOR_SEED_SOURCE,
            createdAt: now,
            updatedAt: now,
        }))
        .filter((item) => !existingIds.has(item.id));
    db.prompts.push(...seededPrompts);
    db.seedSources = Array.from(new Set([...db.seedSources, ORIGINAL_AUTHOR_SEED_SOURCE]));
    await writePromptDb(db);
    return db;
}

async function mutatePromptDb<T>(mutator: (db: PromptDatabase) => T | Promise<T>) {
    const run = mutationQueue.then(async () => {
        const db = await readPromptDb({ includeSeeds: false });
        const result = await mutator(db);
        await writePromptDb(db);
        return result;
    });
    mutationQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

async function writePromptDb(db: PromptDatabase) {
    await mkdir(dirname(PROMPT_DATA_FILE), { recursive: true });
    await writeFile(PROMPT_DATA_FILE, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function normalizeStoredPrompt(value: StoredPrompt): StoredPrompt {
    const now = new Date().toISOString();
    return {
        id: value.id || randomUUID(),
        scope: value.scope === "user" ? "user" : "library",
        ownerUserId: value.ownerUserId,
        title: value.title || "未命名提示词",
        coverUrl: value.coverUrl || "",
        prompt: value.prompt || "",
        tags: normalizeTags(value.tags),
        category: value.category || "默认",
        preview: value.preview || "",
        githubUrl: value.githubUrl,
        source: value.source,
        createdAt: value.createdAt || now,
        updatedAt: value.updatedAt || value.createdAt || now,
    };
}

function collectTags(items: StoredPrompt[]) {
    return Array.from(new Set(items.flatMap((item) => item.tags).filter(isUsefulPromptTag)));
}

function collectCategories(items: StoredPrompt[]) {
    return Array.from(new Set(items.map((item) => item.category).filter(Boolean)));
}

function isActiveOption(value: string) {
    return value && value !== "全部" && value !== "all";
}

function isOriginalAuthorSeedSource(source?: string) {
    return Boolean(source?.startsWith(ORIGINAL_AUTHOR_SEED_SOURCE_PREFIX) || source?.startsWith(LEGACY_ORIGINAL_AUTHOR_SEED_SOURCE_PREFIX));
}

function isUsefulPromptTag(tag?: string) {
    const value = (tag || "").trim();
    if (!value || value.length > 24) return false;
    if (value.startsWith("@")) return false;
    if (/^aws?ome-?gpt/i.test(value)) return false;
    if (/^(moosl|openai)$/i.test(value)) return false;
    return true;
}
