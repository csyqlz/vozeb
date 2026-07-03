"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Image as ImageIcon, Layers3, Sparkles, Wand2 } from "lucide-react";
import { App, Button, Image, Tag } from "antd";

import { AuthForm } from "@/components/auth/auth-form";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";

type SessionPayload = {
    user?: LocalUser | null;
};

const featureItems = [
    { icon: Layers3, title: "无限画布", text: "把图片、文字、视频、音频与配置节点串成连续创作流。" },
    { icon: Wand2, title: "AI 工作台", text: "统一管理文生图、图生图、视频生成、提示词和素材沉淀。" },
    { icon: ImageIcon, title: "提示词资产", text: "内置公共提示词库与远程封面，灵感、参数和结果一起归档。" },
];

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} /> : <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

function HeroCape() {
    return (
        <svg className="hero-cape" viewBox="0 0 760 160" role="presentation" aria-hidden="true">
            <defs>
                <linearGradient id="cape-fill" x1="110" x2="660" y1="18" y2="104" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#67e8f9" stopOpacity="0" />
                    <stop offset="0.22" stopColor="#67e8f9" stopOpacity="0.18" />
                    <stop offset="0.52" stopColor="#f8fafc" stopOpacity="0.42" />
                    <stop offset="0.78" stopColor="#38bdf8" stopOpacity="0.22" />
                    <stop offset="1" stopColor="#0ea5e9" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="cape-edge" x1="118" x2="684" y1="84" y2="20" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
                    <stop offset="0.26" stopColor="#a5f3fc" stopOpacity="0.72" />
                    <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.9" />
                    <stop offset="0.82" stopColor="#67e8f9" stopOpacity="0.72" />
                    <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path className="hero-cape-fill" d="M128 84 C208 128 336 116 430 78 C526 38 596 10 682 18 C602 46 536 91 444 124 C330 164 210 151 128 84Z" fill="url(#cape-fill)" />
            <path className="hero-cape-edge hero-cape-edge-main" d="M124 79 C200 122 333 113 429 75 C526 37 595 8 682 16" />
            <path className="hero-cape-edge hero-cape-edge-soft" d="M154 105 C247 136 352 126 452 92 C535 64 594 48 655 48" />
            <path className="hero-cape-tail" d="M586 42 C638 70 690 86 730 84" />
        </svg>
    );
}

export default function HomePage() {
    const { message } = App.useApp();
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        void fetch("/api/auth/session")
            .then((response) => response.json() as Promise<SessionPayload>)
            .then((data) => {
                if (data.user) setUser(data.user);
            })
            .catch(() => undefined);

        void fetchPrompts({ pageSize: 8 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message, setUser]);

    return (
        <main className="animated-dot-bg relative h-dvh overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <header className="relative z-10 border-b border-white/10 bg-black/35 backdrop-blur-xl">
                <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-6">
                    <Link href="/" className="inline-flex items-center gap-3 text-white">
                        <span
                            className="size-9 bg-white"
                            style={{
                                mask: "url(/logo.svg) center / contain no-repeat",
                                WebkitMask: "url(/logo.svg) center / contain no-repeat",
                            }}
                        />
                        <span className="text-xl font-semibold tracking-normal">VOZEB</span>
                    </Link>
                    <nav className="hidden items-center gap-7 text-sm font-medium text-stone-300 md:flex">
                        {navigationTools.slice(0, 4).map((tool) => (
                            <Link key={tool.slug} href={`/${tool.slug}`} className="transition hover:text-white">
                                {tool.label}
                            </Link>
                        ))}
                    </nav>
                    <Button href={user ? "/canvas" : "/login"}>{user ? "进入工作台" : "登录"}</Button>
                </div>
            </header>

            <section className="relative mx-auto grid min-h-[calc(100dvh-5rem)] max-w-7xl items-center gap-10 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_420px]">
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200/20 bg-cyan-200/8 px-3 py-1.5 text-sm text-cyan-100">
                        <Sparkles className="size-4" />
                        v0.5.2 官网化登录首屏
                    </div>
                    <div className="hero-title-wrap mt-10 items-start text-left">
                        <h1 className="ai-title-aurora max-w-5xl text-balance text-6xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">VOZEB</h1>
                        <HeroCape />
                    </div>
                    <p className="mt-6 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-300">
                        在 <Highlighter action="underline" color="#FF9800">VOZEB</Highlighter> 中生成、连接和重组 <Highlighter action="highlight" color="#87CEFA">图片、文字与图形</Highlighter>，让创作从单次生成变成连续推演。
                    </p>
                    <div className="mt-9 flex flex-wrap items-center gap-3">
                        <Button type="primary" size="large" href={`/${primaryTool.slug}`} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            开始使用
                        </Button>
                        <Button size="large" href="/prompts">
                            查看提示词库
                        </Button>
                    </div>
                    <div className="mt-10 grid gap-3 sm:grid-cols-3">
                        {featureItems.map((item) => {
                            const Icon = item.icon;
                            return (
                                <article key={item.title} className="landing-feature-panel">
                                    <Icon className="size-5 text-cyan-200" />
                                    <h2 className="mt-3 text-base font-semibold text-white">{item.title}</h2>
                                    <p className="mt-2 text-sm leading-6 text-stone-400">{item.text}</p>
                                </article>
                            );
                        })}
                    </div>
                </div>

                <aside className="relative z-10">
                    <div className="landing-auth-shell">
                        {user ? (
                            <div className="p-7">
                                <div className="inline-flex size-11 items-center justify-center rounded-md bg-cyan-300 text-stone-950">
                                    <CheckCircle2 className="size-6" />
                                </div>
                                <h2 className="mt-6 text-2xl font-semibold text-white">欢迎回来，{user.displayName || user.username}</h2>
                                <p className="mt-3 text-sm leading-6 text-stone-400">你的账号已登录，可以直接进入画布继续创作。</p>
                                <Button type="primary" size="large" href="/canvas" block className="mt-7" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                    进入工作台
                                </Button>
                            </div>
                        ) : (
                            <AuthForm mode="login" variant="embedded" nextPath="/canvas" />
                        )}
                    </div>
                </aside>
            </section>

            <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20">
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-10">
                    <div>
                        <h2 className="text-3xl font-semibold text-white">沉淀每一次好结果</h2>
                        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-400">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                    </div>
                    <Button type="link" href="/prompts" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                        查看提示词库
                    </Button>
                </div>
                <div className="grid auto-rows-[190px] gap-4 md:grid-cols-4">
                    {promptShowcase.map((item, index) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                                setPreviewIndex(index);
                                setPreviewOpen(true);
                            }}
                            className={cn("group relative cursor-pointer overflow-hidden border border-white/10 bg-white/5 text-left", index === 0 && "md:col-span-2 md:row-span-2", index === 3 && "md:col-span-2")}
                        >
                            <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" referrerPolicy="no-referrer" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-4 text-white">
                                <div className="mb-2 flex flex-wrap gap-1.5">
                                    {item.tags.slice(0, 2).map((tag) => (
                                        <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                                <h3 className="text-sm font-medium">{item.title}</h3>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
