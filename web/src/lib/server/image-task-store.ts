import { randomUUID } from "crypto";

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
};

export type ImageTask = {
    id: string;
    userId: string;
    kind: ImageTaskKind;
    status: ImageTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: ImageTaskConfig;
    prompt: string;
    references: ImageTaskReference[];
    mask?: ImageTaskReference;
    result?: { dataUrl: string };
    error?: string;
    pointsRemaining?: number;
};

const TASK_TTL_MS = 60 * 60 * 1000;
const tasks = new Map<string, ImageTask>();

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
    return tasks.get(id) || null;
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
