"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { applyPublicSystemSettings, useConfigStore, type PublicSystemSettings } from "@/stores/use-config-store";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";

type PublicSiteSettings = {
    title: string;
    logoUrl: string;
};

export function AppTopNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [site, setSite] = useState<PublicSiteSettings>({ title: "VOZEB", logoUrl: "/logo.svg" });
    const setUser = useUserStore((state) => state.setUser);
    const setConfig = useConfigStore((state) => state.setConfig);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        void fetch("/api/auth/session")
            .then(
                (response) =>
                    response.json() as Promise<{
                        user?: LocalUser | null;
                        settings?: PublicSystemSettings & { site?: PublicSiteSettings };
                    }>,
            )
            .then((payload) => {
                if (payload.settings?.site) setSite(payload.settings.site);
                if (payload.user) setUser(payload.user);
                setConfig(applyPublicSystemSettings(useConfigStore.getState().config, payload.settings));
            })
            .catch(() => undefined);
    }, [setUser, setConfig]);

    return (
        <>
            {!hideHeader ? (
                <header className="app-shell-header sticky top-0 z-20 h-[68px] shrink-0 sm:h-[74px]">
                    <div className="mx-auto grid h-full max-w-[1500px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:grid-cols-[minmax(180px,0.75fr)_auto_minmax(360px,1.25fr)] lg:gap-5">
                        <div className="flex min-w-0 items-center justify-start overflow-hidden">
                            <Link href="/" className="flex h-full min-w-0 items-center gap-2.5 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <SiteLogo logoUrl={site.logoUrl} className="size-9" />
                                <span className="max-w-[24vw] truncate text-xl font-semibold sm:max-w-[30vw] lg:max-w-none">{site.title || "VOZEB"}</span>
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

                        <nav className="app-shell-nav-pill hide-scrollbar hidden min-w-0 items-center gap-1 overflow-x-auto overflow-y-visible lg:flex lg:justify-self-center">
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
                                        className={cn("app-shell-nav-link flex h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-medium leading-none", active && "is-active")}
                                    >
                                        <Icon className="size-[17px]" />
                                        <span className="truncate">{tool.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>

                        <div className="app-shell-actions my-auto flex h-9 max-w-[calc(100vw-9rem)] min-w-0 items-center justify-end overflow-visible whitespace-nowrap sm:max-w-[calc(100vw-12rem)] lg:max-w-none">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
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
