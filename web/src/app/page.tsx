"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Gauge, Image as ImageIcon, Layers3, Mail, Send, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { App, Button, Image, Modal, Tag } from "antd";

import { AuthForm } from "@/components/auth/auth-form";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cn } from "@/lib/utils";

type SessionPayload = {
    user?: LocalUser | null;
    settings?: {
        site?: {
            title: string;
            logoUrl: string;
            seoDescription?: string;
            footerCopyright?: string;
            termsUrl?: string;
            privacyUrl?: string;
            friendLinks?: SiteFriendLink[];
            socials?: SiteSocialSettings;
        };
    };
};

type SiteSocialKey = "email" | "telegram" | "x" | "instagram";

type SiteSocialSettings = Record<SiteSocialKey, { enabled: boolean; label: string; url: string }>;
type SiteFriendLink = { id: string; label: string; url: string; enabled: boolean };

const featureItems = [
    { icon: Layers3, title: "无限画布", text: "把图片、文字、视频、音频与配置节点串成连续创作流。" },
    { icon: Wand2, title: "AI 工作台", text: "统一管理文生图、图生图、视频生成、提示词和素材沉淀。" },
    { icon: ImageIcon, title: "提示词资产", text: "内置公共提示词库与远程封面，灵感、参数和结果一起归档。" },
];

const heroStats = [
    { icon: ImageIcon, value: "874+", label: "远程封面提示词" },
    { icon: Gauge, value: "1 CPU", label: "低配构建模式" },
    { icon: ShieldCheck, value: ".data", label: "账号数据持久化" },
];

const defaultSite: {
    title: string;
    logoUrl: string;
    seoDescription: string;
    footerCopyright: string;
    termsUrl: string;
    privacyUrl: string;
    friendLinks: SiteFriendLink[];
    socials: SiteSocialSettings;
} = {
    title: "VOZEB",
    logoUrl: "/logo.svg",
    seoDescription: "面向 AI 图片创作与管理的 VOZEB 工作台",
    footerCopyright: "© 2026 VOZEB. All rights reserved.",
    termsUrl: "/terms",
    privacyUrl: "/privacy",
    friendLinks: [{ id: "linux-do", label: "Linux.do", url: "https://linux.do/", enabled: true }],
    socials: {
        email: { enabled: true, label: "邮箱联系", url: "mailto:contact@example.com" },
        telegram: { enabled: true, label: "Telegram", url: "https://t.me/vozeb" },
        x: { enabled: true, label: "X", url: "https://x.com/vozeb" },
        instagram: { enabled: true, label: "Instagram", url: "https://instagram.com/vozeb" },
    } satisfies SiteSocialSettings,
};

const socialIconByKey: Record<SiteSocialKey, ReactNode> = {
    email: <Mail className="size-4" />,
    telegram: <Send className="size-4" />,
    x: <span className="text-base font-black leading-none">X</span>,
    instagram: <span className="text-sm font-black leading-none">IG</span>,
};

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

function HeroCape() {
    return (
        <svg className="hero-cape" viewBox="0 0 760 160" role="presentation" aria-hidden="true">
            <defs>
                <clipPath id="cape-reveal">
                    <rect className="hero-cape-reveal" x="0" y="0" width="760" height="160" />
                </clipPath>
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
            <g clipPath="url(#cape-reveal)">
                <path className="hero-cape-fill" d="M82 76 C188 132 326 125 438 78 C538 36 619 5 724 18 C628 48 552 98 448 132 C312 176 172 150 82 76Z" fill="url(#cape-fill)" />
                <path className="hero-cape-edge hero-cape-edge-main" d="M78 72 C178 126 323 121 438 74 C540 34 620 6 724 16" />
                <path className="hero-cape-edge hero-cape-edge-soft" d="M120 105 C235 140 356 130 470 91 C555 62 620 46 695 48" />
                <path className="hero-cape-tail" d="M584 42 C642 72 694 88 740 84" />
            </g>
        </svg>
    );
}

export default function HomePage() {
    const router = useRouter();
    const { message } = App.useApp();
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [site, setSite] = useState(defaultSite);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const friendLinks = (site.friendLinks || []).filter((link) => link.enabled && link.url);

    useEffect(() => {
        void fetch("/api/auth/session")
            .then((response) => response.json() as Promise<SessionPayload>)
            .then((data) => {
                if (data.user) setUser(data.user);
                if (data.settings?.site) setSite((current) => ({ ...current, ...data.settings!.site }));
            })
            .catch(() => undefined);

        void fetchPrompts({ pageSize: 8 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message, setUser]);

    return (
        <main className="animated-dot-bg relative h-dvh overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <header className="landing-site-header relative z-10">
                <div className="mx-auto grid h-20 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
                    <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-stone-950 dark:text-white">
                        <SiteLogo logoUrl={site.logoUrl} className="size-9 bg-stone-950 dark:bg-white" />
                        <span className="truncate text-xl font-semibold tracking-normal">{site.title || "VOZEB"}</span>
                    </Link>
                    <nav className="landing-nav-pill hidden items-center gap-1 text-sm font-medium text-stone-700 md:flex dark:text-stone-300">
                        {navigationTools.slice(0, 4).map((tool) => (
                            <Link key={tool.slug} href={`/${tool.slug}`} prefetch className="rounded-md px-4 py-2 transition hover:bg-stone-950/6 hover:text-stone-950 dark:hover:bg-white/10 dark:hover:text-white">
                                {tool.label}
                            </Link>
                        ))}
                    </nav>
                    <div className="flex items-center justify-end gap-2">
                        <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className="landing-theme-toggle" aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
                        <Button className="landing-login-button" onClick={() => (user ? router.push("/canvas") : setAuthOpen(true))}>
                            {user ? "进入工作台" : "登录"}
                        </Button>
                    </div>
                </div>
            </header>

            <section className="relative mx-auto flex min-h-[calc(100dvh-7rem)] max-w-[1500px] items-center justify-center px-6 pb-8 pt-4">
                <div className="landing-hero-copy relative z-10 mx-auto w-full max-w-7xl text-center">
                    <div className="hero-title-stage">
                        <div className="hero-title-wrap">
                            <h1 className="ai-title-aurora max-w-6xl text-balance text-7xl font-semibold tracking-normal sm:text-8xl lg:text-[9rem] xl:text-[11rem]">{site.title || "VOZEB"}</h1>
                            <span className="hero-version-badge inline-flex items-center gap-2 rounded-lg border border-cyan-300/45 bg-white/82 px-3.5 py-2 text-sm font-semibold text-stone-700 shadow-sm shadow-cyan-950/5 dark:border-cyan-200/20 dark:bg-cyan-200/8 dark:text-cyan-100">
                                <Sparkles className="size-4" />
                                v0.7.1 创作入口
                            </span>
                            <HeroCape />
                        </div>
                    </div>
                    <p className="mx-auto mt-5 max-w-4xl text-balance text-lg leading-8 text-stone-500 sm:text-xl sm:leading-9 dark:text-stone-300">
                        在{" "}
                        <Highlighter action="underline" color="#FF9800">
                            {site.title || "VOZEB"}
                        </Highlighter>{" "}
                        中生成、连接和重组{" "}
                        <Highlighter action="highlight" color="#87CEFA">
                            图片、文字与图形
                        </Highlighter>
                        ，让创作从单次生成变成连续推演。
                    </p>
                    <div className="landing-hero-actions mt-8 flex flex-wrap items-center justify-center gap-4">
                        <Button className="landing-hero-cta" type="primary" size="large" onClick={() => (user ? router.push(`/${primaryTool.slug}`) : setAuthOpen(true))} icon={<ArrowRight className="size-5" />} iconPlacement="end">
                            开始使用
                        </Button>
                        <Button className="landing-hero-cta landing-hero-cta-secondary" size="large" href="/prompts">
                            查看提示词库
                        </Button>
                    </div>
                    <div className="landing-capability-stage mx-auto mt-10 max-w-6xl">
                        <div className="landing-stat-grid grid gap-3 sm:grid-cols-3">
                            {heroStats.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.label} className="landing-stat-pill text-left">
                                        <span className="landing-stat-icon">
                                            <Icon className="size-4" />
                                        </span>
                                        <div>
                                            <div className="text-sm font-semibold text-stone-950 dark:text-white">{item.value}</div>
                                            <div className="text-xs text-stone-500 dark:text-stone-400">{item.label}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="landing-feature-grid mt-4 grid gap-4 sm:grid-cols-3">
                            {featureItems.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <article key={item.title} className="landing-feature-panel text-left">
                                        <span className="landing-feature-icon">
                                            <Icon className="size-5" />
                                        </span>
                                        <h2 className="mt-3 text-base font-semibold text-stone-950 dark:text-white">{item.title}</h2>
                                        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{item.text}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <section className="landing-showcase-section relative z-10 mx-auto max-w-[1200px] px-6 pb-20">
                <div className="landing-showcase-shell">
                    <div className="landing-showcase-header mb-8 flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-semibold text-stone-950 sm:text-3xl dark:text-white">沉淀每一次好结果</h2>
                            <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600 dark:text-stone-400">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <Button type="link" href="/prompts" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            查看提示词库
                        </Button>
                    </div>
                    <div className="grid auto-rows-[190px] gap-4 sm:grid-cols-2 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden rounded-lg border border-white/60 bg-white/70 text-left shadow-sm shadow-stone-200/60 dark:border-white/10 dark:bg-white/5 dark:shadow-black/20",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
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
                </div>
            </section>

            <footer className="landing-footer relative z-10 mx-auto max-w-[1200px] px-6 pb-10">
                <div className="landing-footer-shell">
                    <div className="landing-footer-brand flex min-w-0 items-center gap-4">
                        <SiteLogo logoUrl={site.logoUrl} className="landing-footer-logo bg-stone-950 dark:bg-white" />
                        <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-stone-950 dark:text-white">{site.title || "VOZEB"}</div>
                            <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">{site.footerCopyright}</div>
                        </div>
                    </div>
                    <div className="landing-footer-actions">
                        <div className="landing-footer-links">
                            <Link href={site.termsUrl || "/terms"} className="landing-footer-link">
                                使用条款
                            </Link>
                            <Link href={site.privacyUrl || "/privacy"} className="landing-footer-link">
                                隐私政策
                            </Link>
                            {friendLinks.map((link) => (
                                <Link key={link.id} href={link.url} className="landing-footer-link" target={link.url.startsWith("/") ? undefined : "_blank"} rel={link.url.startsWith("/") ? undefined : "noreferrer"}>
                                    {link.label}
                                </Link>
                            ))}
                        </div>
                        <div className="landing-footer-socials">
                            {Object.entries(site.socials)
                                .filter(([, social]) => social.enabled && social.url)
                                .map(([key, social]) => (
                                    <Link key={key} href={social.url} className="landing-footer-social" title={social.label} target={social.url.startsWith("/") ? undefined : "_blank"} rel={social.url.startsWith("/") ? undefined : "noreferrer"}>
                                        {socialIconByKey[key as SiteSocialKey]}
                                        <span className="sr-only">{social.label}</span>
                                    </Link>
                                ))}
                        </div>
                    </div>
                </div>
            </footer>

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

            <Modal open={authOpen} footer={null} width={820} centered destroyOnHidden onCancel={() => setAuthOpen(false)} className="landing-auth-modal">
                <div className="landing-auth-modal-shell">
                    <section className="landing-auth-modal-brand">
                        <div className="inline-flex items-center gap-3 text-stone-950 dark:text-white">
                            <SiteLogo logoUrl={site.logoUrl} className="landing-auth-brand-logo bg-stone-950 dark:bg-white" />
                            <span className="text-2xl font-semibold">{site.title || "VOZEB"}</span>
                        </div>
                        <div className="landing-auth-modal-copy">
                            <p className="text-sm font-medium text-cyan-700 dark:text-cyan-200">VOZEB Access</p>
                            <h2 className="mt-3 text-3xl font-semibold leading-tight text-stone-950 dark:text-white">继续你的创作现场</h2>
                            <p className="mt-4 text-sm leading-7 text-stone-500 dark:text-stone-300">登录后进入画布、素材、模型和提示词库。</p>
                        </div>
                        <div className="landing-auth-modal-bullets grid gap-2 text-sm text-stone-600 dark:text-stone-300">
                            {["无限画布编排", "远程提示词库", "用户积分与后台"].map((item) => (
                                <div key={item} className="flex items-center gap-2">
                                    <span className="size-1.5 rounded-full bg-cyan-300" />
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                    <div className="landing-auth-modal-form">
                        <AuthForm mode="login" variant="embedded" nextPath="/canvas" className="min-h-0 bg-transparent p-0 shadow-none" />
                    </div>
                </div>
            </Modal>
        </main>
    );
}

function SiteLogo({ logoUrl, className }: { logoUrl: string; className: string }) {
    if (logoUrl && logoUrl !== "/logo.svg") return <img src={logoUrl} alt="" className={cn(className, "shrink-0 object-contain")} />;
    return (
        <span
            className={cn(className, "shrink-0")}
            style={{
                mask: "url(/logo.svg) center / contain no-repeat",
                WebkitMask: "url(/logo.svg) center / contain no-repeat",
            }}
        />
    );
}
