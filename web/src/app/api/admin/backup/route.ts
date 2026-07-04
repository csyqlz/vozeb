import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { resolveServerDataPath } from "@/lib/server/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESTORE_FILE_MAP = {
    auth: "auth.json",
    prompts: "prompts.json",
    generationLogs: "generation-logs.json",
} as const;
const MAX_IMPORT_BYTES = 30 * 1024 * 1024;

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const exportedAt = new Date().toISOString();
    const backup = {
        app: "VOZEB",
        version: 1,
        exportedAt,
        files: {
            auth: await readDataJson("auth.json"),
            prompts: await readDataJson("prompts.json"),
            generationLogs: await readDataJson("generation-logs.json"),
        },
    };

    return new NextResponse(JSON.stringify(backup, null, 2), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="vozeb-data-backup-${exportedAt.slice(0, 10)}.json"`,
            "Cache-Control": "no-store",
        },
    });
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择要导入的备份文件" }, { status: 400 });
    if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "备份文件过大，请确认文件是否正确" }, { status: 400 });

    let parsed: unknown;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        return NextResponse.json({ error: "备份文件不是有效 JSON" }, { status: 400 });
    }

    const files = extractBackupFiles(parsed);
    try {
        validateBackupFiles(files);
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "备份文件格式不正确" }, { status: 400 });
    }
    const entries = Object.entries(RESTORE_FILE_MAP)
        .map(([key, fileName]) => ({ key, fileName, value: files[key as keyof BackupFiles] }))
        .filter((entry) => entry.value !== undefined && entry.value !== null);
    if (!entries.length) return NextResponse.json({ error: "备份文件里没有可导入的数据" }, { status: 400 });

    const importedAt = new Date().toISOString();
    const safetyBackupName = importedAt.replace(/[:.]/g, "-");
    const safetyBackupDir = resolveServerDataPath(`restore-backups/${safetyBackupName}`);
    await mkdir(safetyBackupDir, { recursive: true });
    await Promise.all(Object.values(RESTORE_FILE_MAP).map((fileName) => copyCurrentDataFile(fileName, resolveServerDataPath(`restore-backups/${safetyBackupName}/${fileName}`))));

    await Promise.all(
        entries.map(async (entry) => {
            await writeFile(resolveServerDataPath(entry.fileName), `${JSON.stringify(entry.value, null, 2)}\n`, "utf8");
        }),
    );

    return NextResponse.json({
        ok: true,
        imported: entries.map((entry) => entry.key),
        safetyBackupDir,
    });
}

async function readDataJson(fileName: string) {
    try {
        return JSON.parse(await readFile(resolveServerDataPath(fileName), "utf8")) as unknown;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

type BackupFiles = {
    auth?: unknown;
    prompts?: unknown;
    generationLogs?: unknown;
};

function extractBackupFiles(value: unknown): BackupFiles {
    const root = isRecord(value) ? value : {};
    const files = isRecord(root.files) ? root.files : root;
    return {
        auth: files.auth,
        prompts: files.prompts,
        generationLogs: files.generationLogs ?? files["generation-logs"],
    };
}

function validateBackupFiles(files: BackupFiles) {
    if (files.auth !== undefined && files.auth !== null) validateAuthBackup(files.auth);
    if (files.prompts !== undefined && files.prompts !== null) validateArrayDatabase(files.prompts, "prompts", "公共提示词备份格式不正确");
    if (files.generationLogs !== undefined && files.generationLogs !== null) validateArrayDatabase(files.generationLogs, "logs", "生成日志备份格式不正确");
}

function validateAuthBackup(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.users) || !isRecord(value.settings)) throw new Error("用户数据库备份格式不正确");
    const hasActiveAdmin = value.users.some((user) => isRecord(user) && user.role === "admin" && user.status === "active");
    if (!hasActiveAdmin) throw new Error("导入的用户数据库里没有可用管理员账号，为避免锁死后台已取消导入");
}

function validateArrayDatabase(value: unknown, key: string, message: string) {
    if (!isRecord(value) || !Array.isArray(value[key])) throw new Error(message);
}

async function copyCurrentDataFile(fileName: string, targetPath: string) {
    try {
        await copyFile(resolveServerDataPath(fileName), targetPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
