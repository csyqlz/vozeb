import { randomUUID } from "crypto";

import type { GenerationLogSource } from "@/lib/server/generation-log-store";

export type ImageTaskKind = "generation" | "edit";
export type ImageTaskStatus = "pending" | "running" | "success" | "error";

export type ImageTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    quality?: string;
    size?: string;
    systemPrompt?: string;
};

export type ImageTaskReference = {
    id?: string;
    name?: string;
    type?: string;
    dataUrl: string;
    url?: string;
};

export type ImageTask = {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    kind: ImageTaskKind;
    source: GenerationLogSource;
    title?: string;
    status: ImageTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: ImageTaskConfig;
    prompt: string;
    references: ImageTaskReference[];
    mask?: ImageTaskReference;
    result?: { dataUrl: string; remoteUrl?: string; serverUrl?: string };
    error?: string;
    pointsRemaining?: number;
};

const TASK_TTL_MS = 60 * 60 * 1000;
const TASK_STALE_MS = 3 * 60 * 1000;
const globalImageTaskStore = globalThis as typeof globalThis & { __vozebImageTasks?: Map<string, ImageTask> };
const tasks = (globalImageTaskStore.__vozebImageTasks ??= new Map<string, ImageTask>());

export function createImageTask(input: Omit<ImageTask, "id" | "status" | "createdAt" | "updatedAt">) {
    cleanupImageTasks();
    const now = Date.now();
    const task: ImageTask = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    tasks.set(task.id, task);
    return task;
}

export function getImageTask(id: string) {
    cleanupImageTasks();
    markStaleImageTasks();
    return tasks.get(id) || null;
}

export function countActiveImageTasksForUser(userId: string) {
    cleanupImageTasks();
    markStaleImageTasks();
    return Array.from(tasks.values()).filter((task) => task.userId === userId && (task.status === "pending" || task.status === "running")).length;
}

export function updateImageTask(id: string, patch: Partial<Pick<ImageTask, "status" | "result" | "error" | "pointsRemaining">>) {
    const task = tasks.get(id);
    if (!task) return null;
    const next = { ...task, ...patch, updatedAt: Date.now() };
    tasks.set(id, next);
    return next;
}

function cleanupImageTasks() {
    const expiresBefore = Date.now() - TASK_TTL_MS;
    for (const [id, task] of tasks) {
        if (task.updatedAt < expiresBefore) tasks.delete(id);
    }
}

function markStaleImageTasks() {
    const expiresBefore = Date.now() - TASK_STALE_MS;
    for (const [id, task] of tasks) {
        if ((task.status === "pending" || task.status === "running") && task.updatedAt < expiresBefore) {
            tasks.set(id, {
                ...task,
                status: "error",
                error: "生成任务已中断，请重新生成。",
                updatedAt: Date.now(),
            });
        }
    }
}
