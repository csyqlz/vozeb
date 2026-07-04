import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, "web");
const outputDir = path.join(repoRoot, "docs", "assets", "readme");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const puppeteerEntry = process.env.PUPPETEER_CORE_ENTRY || path.join(process.env.TEMP || ".", "vozeb-screenshot-tools", "node_modules", "puppeteer-core", "lib", "esm", "puppeteer", "puppeteer-core.js");
const baseUrl = process.env.VOZEB_SCREENSHOT_BASE_URL || "http://localhost:3000";
const viewport = { width: 1440, height: 900, deviceScaleFactor: 1 };

const demoUser = {
    id: "readme-demo-admin",
    username: "demo_admin",
    displayName: "Demo Admin",
    email: "demo@vozeb.local",
    password: "DemoPass123!",
};

const imageOne = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="640" viewBox="0 0 900 640">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#0f172a"/><stop offset=".45" stop-color="#0e7490"/><stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
    <radialGradient id="sun" cx=".72" cy=".24" r=".35">
      <stop stop-color="#fef9c3"/><stop offset=".5" stop-color="#38bdf8" stop-opacity=".45"/><stop offset="1" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="900" height="640" fill="url(#bg)"/>
  <rect width="900" height="640" fill="url(#sun)" opacity=".85"/>
  <path d="M0 455 C145 385 238 470 385 410 C545 345 650 365 900 280 L900 640 L0 640Z" fill="#08111f" opacity=".78"/>
  <path d="M0 510 C180 430 275 532 442 466 C605 402 730 415 900 365 L900 640 L0 640Z" fill="#0f766e" opacity=".5"/>
  <circle cx="612" cy="196" r="72" fill="#f8fafc" opacity=".9"/>
  <text x="70" y="115" fill="#f8fafc" font-family="Arial, sans-serif" font-size="56" font-weight="700">VOZEB</text>
  <text x="74" y="162" fill="#dbeafe" font-family="Arial, sans-serif" font-size="24">AI canvas concept frame</text>
</svg>`);

const imageTwo = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="640" viewBox="0 0 900 640">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#f8fafc"/><stop offset=".5" stop-color="#bae6fd"/><stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#ffffff"/><stop offset="1" stop-color="#d1fae5"/>
    </linearGradient>
  </defs>
  <rect width="900" height="640" fill="url(#g)"/>
  <g transform="translate(100 90)">
    <rect width="700" height="460" rx="36" fill="url(#card)" opacity=".9"/>
    <circle cx="210" cy="170" r="90" fill="#0f172a" opacity=".95"/>
    <circle cx="500" cy="170" r="90" fill="#0284c7" opacity=".88"/>
    <path d="M180 318 C250 260 315 358 390 305 C475 245 535 285 610 230" fill="none" stroke="#0f172a" stroke-width="18" stroke-linecap="round" opacity=".75"/>
    <text x="72" y="405" fill="#0f172a" font-family="Arial, sans-serif" font-size="38" font-weight="700">Prompt to image</text>
  </g>
</svg>`);

const demoProject = {
    id: "readme-demo-canvas",
    title: "VOZEB 0.7.0 演示画布",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backgroundMode: "lines",
    showImageInfo: true,
    viewport: { x: 270, y: 130, k: 0.78 },
    nodes: [
        {
            id: "node-prompt",
            type: "text",
            title: "提示词草稿",
            position: { x: -260, y: 20 },
            width: 330,
            height: 220,
            metadata: {
                content: "用无限画布整理参考图、提示词、模型配置和生成结果，保留每一次可复用的创作路径。",
                prompt: "创作工作流说明",
                status: "success",
                fontSize: 16,
            },
        },
        {
            id: "node-config",
            type: "config",
            title: "生成配置",
            position: { x: 130, y: -55 },
            width: 340,
            height: 240,
            metadata: {
                status: "idle",
                generationMode: "image",
                model: "gpt-image-2",
                size: "1024x1024",
                count: 1,
                composerContent: "海报级 AI 创作概念图，清晰 UI 分层，细节丰富",
            },
        },
        {
            id: "node-image-1",
            type: "image",
            title: "生成结果 1",
            position: { x: 560, y: -40 },
            width: 330,
            height: 236,
            metadata: {
                content: imageOne,
                prompt: "VOZEB AI canvas concept frame",
                status: "success",
                naturalWidth: 900,
                naturalHeight: 640,
                mimeType: "image/svg+xml",
                bytes: 4096,
            },
        },
        {
            id: "node-image-2",
            type: "image",
            title: "参考图",
            position: { x: 380, y: 315 },
            width: 300,
            height: 214,
            metadata: {
                content: imageTwo,
                prompt: "Prompt to image",
                status: "success",
                naturalWidth: 900,
                naturalHeight: 640,
                mimeType: "image/svg+xml",
                bytes: 4096,
            },
        },
        {
            id: "node-video",
            type: "video",
            title: "视频脚本",
            position: { x: -170, y: 340 },
            width: 360,
            height: 210,
            metadata: {
                status: "idle",
                prompt: "镜头从画布节点推进到成片预览，展示创作链路。",
            },
        },
    ],
    connections: [
        { id: "edge-1", fromNodeId: "node-prompt", toNodeId: "node-config" },
        { id: "edge-2", fromNodeId: "node-config", toNodeId: "node-image-1" },
        { id: "edge-3", fromNodeId: "node-image-1", toNodeId: "node-image-2" },
    ],
    chatSessions: [
        {
            id: "chat-demo",
            title: "画布助手演示",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [
                { id: "m1", role: "user", text: "帮我把这组节点整理成可复用的海报创作流程。" },
                { id: "m2", role: "assistant", text: "已识别提示词、配置节点和两张参考图，可继续生成或保存到素材库。" },
            ],
        },
    ],
    activeChatId: "chat-demo",
};

const demoAssets = [
    {
        id: "asset-image",
        kind: "image",
        title: "海报概念参考",
        coverUrl: imageOne,
        tags: ["海报", "参考图"],
        source: "Canvas",
        note: "README 演示素材",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { dataUrl: imageOne, width: 900, height: 640, bytes: 4096, mimeType: "image/svg+xml" },
    },
    {
        id: "asset-text",
        kind: "text",
        title: "产品页提示词",
        coverUrl: "",
        tags: ["提示词", "产品"],
        source: "我的提示词",
        note: "用于演示素材库文本沉淀",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { content: "为 AI 创作工具生成一个清晰、有层次、突出工作流的产品主视觉。" },
    },
];

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    ensureDemoAdmin();

    const { default: puppeteer } = await import(pathToFileURL(puppeteerEntry).href);
    const userDataDir = path.join(process.env.TEMP || ".", `vozeb-readme-chrome-${Date.now()}`);
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: "new",
        userDataDir,
        defaultViewport: viewport,
        args: ["--no-first-run", "--disable-extensions", "--disable-sync", "--hide-scrollbars", "--font-render-hinting=none"],
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        await login(page);
        await seedBrowserState(page);
        await createDemoPrompt(page);

        await capture(page, "/", "01-home.png", async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
        });
        await capture(page, `/canvas/${demoProject.id}`, "02-canvas.png", async () => {
            await page.waitForSelector("main", { timeout: 20000 });
            await sleep(1200);
        });
        await capture(page, `/canvas/${demoProject.id}`, "03-canvas-agent.png", async () => {
            await page.waitForSelector("main", { timeout: 20000 });
            await sleep(800);
            await clickByText(page, "Agent");
            await sleep(900);
        });
        await capture(page, "/image", "04-image-workbench.png", async () => {
            await typeIntoFirstTextarea(page, "一张 VOZEB AI 创作工作台宣传图，展示无限画布、提示词库和生成结果。");
        });
        await capture(page, "/video", "05-video-workbench.png", async () => {
            await typeIntoFirstTextarea(page, "镜头沿画布连线推进，展示从参考图到成片的 AI 视频创作流程。");
        });
        await capture(page, "/prompts", "06-prompt-library.png");
        await capture(page, "/my-prompts", "07-my-prompts.png");
        await capture(page, "/assets", "08-assets.png");
        await capture(page, "/profile", "09-profile-points.png", async () => {
            await maskSensitive(page);
        });
        await capture(page, "/admin", "10-admin-dashboard.png", async () => {
            await maskSensitive(page);
        });
    } finally {
        await browser.close();
    }
}

async function capture(page, route, fileName, prepare) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle2" });
    await sleep(900);
    if (prepare) await prepare();
    await maskSensitive(page);
    await page.screenshot({ path: path.join(outputDir, fileName), fullPage: false, type: "png" });
    console.log(`captured ${fileName}`);
}

async function login(page) {
    await page.goto(baseUrl, { waitUntil: "networkidle2" });
    const result = await page.evaluate(async ({ username, password }) => {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        return { ok: response.ok, text: await response.text() };
    }, demoUser);
    if (!result.ok) throw new Error(`demo login failed: ${result.text}`);
}

async function seedBrowserState(page) {
    await page.goto(baseUrl, { waitUntil: "networkidle2" });
    await page.evaluate(async ({ project, assets }) => {
        localStorage.setItem("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "light" }, version: 0 }));
        localStorage.setItem(
            "infinite-canvas:config_store",
            JSON.stringify({
                state: {
                    config: {
                        apiSource: "system",
                        model: "gpt-5-3",
                        imageModel: "gpt-image-2",
                        videoModel: "seedance-demo",
                        textModel: "gpt-5-3",
                        audioModel: "tts-demo",
                        count: "1",
                        canvasImageCount: "1",
                        size: "1024x1024",
                        quality: "auto",
                        channels: [],
                        modelPointCosts: { default: 1, "gpt-image-2": 3 },
                    },
                },
                version: 0,
            }),
        );
        await putIdb("app_state", "infinite-canvas:canvas_store", JSON.stringify({ state: { projects: [project] }, version: 0 }));
        await putIdb("app_state", "infinite-canvas:asset_store", JSON.stringify({ state: { assets }, version: 0 }));

        async function putIdb(storeName, key, value) {
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open("infinite-canvas");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                tx.objectStore(storeName).put(value, key);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        }
    }, { project: demoProject, assets: demoAssets });
}

async function createDemoPrompt(page) {
    await page.evaluate(async ({ coverUrl }) => {
        await fetch("/api/my-prompts", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                title: "VOZEB 产品主视觉",
                prompt: "生成一张干净、专业、适合开源项目 README 展示的 AI 创作工作台界面图。",
                category: "产品展示",
                tags: ["README", "工作流", "主视觉"],
                coverUrl,
            }),
        });
    }, { coverUrl: imageTwo });
}

async function typeIntoFirstTextarea(page, text) {
    const textarea = await page.$("textarea");
    if (!textarea) return;
    await textarea.click({ clickCount: 3 });
    await page.keyboard.type(text, { delay: 2 });
    await sleep(400);
}

async function clickByText(page, text) {
    const handles = await page.$$("button,a");
    for (const handle of handles) {
        const label = await page.evaluate((el) => el.textContent?.trim() || el.getAttribute("aria-label") || "", handle);
        if (label.includes(text)) {
            await handle.click();
            return true;
        }
    }
    return false;
}

async function maskSensitive(page) {
    await page.evaluate(() => {
        const sensitivePattern = /(api|key|token|secret|password|密钥|授权码|密码|邮箱|email|base url|baseurl)/i;
        document.querySelectorAll("input, textarea").forEach((input) => {
            const el = input;
            const label = [el.getAttribute("placeholder"), el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("aria-label"), el.closest("label")?.textContent].filter(Boolean).join(" ");
            if (sensitivePattern.test(label) || el.type === "password") {
                el.value = el.type === "password" ? "••••••••" : "已隐藏";
                el.setAttribute("value", el.value);
            }
        });
        document.querySelectorAll("[title]").forEach((el) => {
            const title = el.getAttribute("title") || "";
            if (sensitivePattern.test(title) || title.includes("@")) el.setAttribute("title", "已隐藏");
        });
    });
}

function ensureDemoAdmin() {
    const dataDir = path.join(webRoot, ".data");
    const authFile = path.join(dataDir, "auth.json");
    fs.mkdirSync(dataDir, { recursive: true });
    const db = fs.existsSync(authFile)
        ? JSON.parse(fs.readFileSync(authFile, "utf8"))
        : { version: 1, users: [], sessions: [], quotaUsage: [], pointRecords: [], checkIns: [], emailCodes: [], settings: {} };
    const now = new Date().toISOString();
    const existing = db.users.find((user) => user.username === demoUser.username);
    const user = {
        id: demoUser.id,
        username: demoUser.username,
        email: demoUser.email,
        displayName: demoUser.displayName,
        role: "admin",
        status: "active",
        pointsBalance: 1688,
        passwordHash: hashPassword(demoUser.password),
        createdAt: now,
        updatedAt: now,
    };
    if (existing) Object.assign(existing, user, { id: existing.id });
    else db.users.push(user);
    db.sessions ||= [];
    db.quotaUsage ||= [];
    db.pointRecords ||= [];
    db.checkIns ||= [];
    db.emailCodes ||= [];
    fs.writeFileSync(authFile, JSON.stringify(db, null, 2));
}

function hashPassword(password) {
    const salt = randomBytes(16).toString("base64url");
    const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url");
    return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

function svgDataUrl(svg) {
    const compact = svg.replace(/\s+/g, " ").trim();
    return `data:image/svg+xml;base64,${Buffer.from(compact).toString("base64")}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
