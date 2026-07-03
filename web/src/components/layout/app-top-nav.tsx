"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";

type PublicSiteSettings = {
    title: string;
    logoUrl: string;
};

export function AppTopNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [site, setSite] = useState<PublicSiteSettings>({ title: "VOZEB", logoUrl: "/logo.svg" });
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        void fetch("/api/auth/session")
            .then((response) => response.json() as Promise<{ settings?: { site?: PublicSiteSettings } }>)
            .then((payload) => {
                if (payload.settings?.site) setSite(payload.settings.site);
            })
            .catch(() => undefined);
    }, []);

    return (
        <>
            {!hideHeader ? (
                <header className="app-shell-header sticky top-0 z-20 h-[68px] shrink-0 sm:h-[74px]">
                    <div className="mx-auto grid h-full max-w-7xl grid-cols-[1fr_auto] items-center gap-3 px-3 sm:px-6 lg:grid-cols-[1fr_auto_1fr]">
                        <div className="flex min-w-0 items-center justify-start">
                            <Link href="/" className="flex h-full shrink-0 items-center gap-2.5 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <SiteLogo logoUrl={site.logoUrl} className="size-9" />
                                <span className="max-w-[34vw] truncate text-xl font-semibold sm:max-w-none">{site.title || "VOZEB"}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>
                        </div>

                        <nav className="app-shell-nav-pill hide-scrollbar hidden min-w-0 items-center gap-1 overflow-x-auto lg:flex">
                            {navigationTools.map((tool) => {
                                const Icon = tool.icon;
                                const active = tool.slug === activeToolSlug;
                                return (
                                    <Link
                                        key={tool.slug}
                                        href={`/${tool.slug}`}
                                        prefetch
                                        onMouseEnter={() => router.prefetch(`/${tool.slug}`)}
                                        onFocus={() => router.prefetch(`/${tool.slug}`)}
                                        className={cn(
                                            "flex h-10 shrink-0 items-center gap-2 rounded-md px-3.5 text-sm font-medium leading-none transition",
                                            active ? "bg-stone-950 text-white shadow-sm dark:bg-white dark:text-stone-950" : "text-stone-600 hover:bg-stone-950/6 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white",
                                        )}
                                    >
                                        <Icon className="size-[17px]" />
                                        <span className="truncate">{tool.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-1 justify-self-end whitespace-nowrap sm:gap-2">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}

function SiteLogo({ logoUrl, className }: { logoUrl: string; className: string }) {
    if (logoUrl && logoUrl !== "/logo.svg") return <img src={logoUrl} alt="" className={cn(className, "shrink-0 object-contain")} />;
    return (
        <span
            className={cn(className, "shrink-0 bg-stone-950 dark:bg-white")}
            style={{
                mask: "url(/logo.svg) center / contain no-repeat",
                WebkitMask: "url(/logo.svg) center / contain no-repeat",
            }}
        />
    );
}
