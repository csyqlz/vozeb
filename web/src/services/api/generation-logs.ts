export type GenerationLogKind = "image" | "video";
export type GenerationLogSource = "image-workbench" | "video-workbench" | "canvas" | "unknown";
export type GenerationLogStatus = "pending" | "success" | "failed";

export type GenerationLogAssetInput = {
    type: GenerationLogKind;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
};

export type GenerationLogRecordInput = {
    id?: string;
    taskId?: string;
    kind: GenerationLogKind;
    source: GenerationLogSource;
    status: GenerationLogStatus;
    title?: string;
    prompt?: string;
    model?: string;
    summary?: string;
    durationMs?: number;
    count?: number;
    successCount?: number;
    failCount?: number;
    assets?: GenerationLogAssetInput[];
    error?: string;
    createdAt?: string | number;
    completedAt?: string | number;
};

export type GenerationLogRecordResponse = {
    id: string;
    assets: Array<GenerationLogAssetInput & { url: string }>;
};

export async function recordGenerationLog(input: GenerationLogRecordInput) {
    const response = await fetch("/api/generation-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response));
    const payload = (await response.json()) as { log?: GenerationLogRecordResponse };
    if (!payload.log) throw new Error("记录生成日志失败");
    return payload.log;
}

function readError(response: Response) {
    return response
        .json()
        .then((payload: { error?: string }) => payload.error || "记录生成日志失败")
        .catch(() => "记录生成日志失败");
}
