import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(webRoot, ".next", "standalone");
const serverEntry = path.join(standaloneRoot, "server.js");

await assertPath(serverEntry, "Standalone server was not found. Run `pnpm run build` first.");
await copyDirectoryContents(path.join(webRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
await copyDirectoryContents(path.join(webRoot, "public"), path.join(standaloneRoot, "public"));

const child = spawn(process.execPath, ["server.js"], {
    cwd: standaloneRoot,
    env: {
        ...process.env,
        PORT: process.env.PORT || "3000",
        HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
        VOZEB_DATA_DIR: process.env.VOZEB_DATA_DIR || path.join(webRoot, ".data"),
    },
    stdio: "inherit",
});

child.on("exit", (code) => {
    process.exit(code ?? 0);
});

child.on("error", (error) => {
    console.error(error);
    process.exit(1);
});

async function assertPath(target, message) {
    try {
        await stat(target);
    } catch {
        throw new Error(message);
    }
}

async function copyDirectoryContents(source, target) {
    await assertPath(source, `Missing build asset directory: ${source}`);
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    await Promise.all(
        entries.map((entry) =>
            cp(path.join(source, entry.name), path.join(target, entry.name), {
                recursive: true,
                force: true,
            }),
        ),
    );
}
