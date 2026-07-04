import type { Metadata } from "next";
import Script from "next/script";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/components/layout/app-providers";
import { getAuthSettings } from "@/lib/auth/store";
import "antd/dist/reset.css";
import "./globals.css";
import React from "react";

export async function generateMetadata(): Promise<Metadata> {
    const settings = await getAuthSettings();
    const site = settings.site;
    const iconUrl = site.logoUrl || "/icon.svg";
    return {
        metadataBase: siteMetadataBase(),
        title: site.seoTitle || site.title,
        description: site.seoDescription,
        keywords: site.seoKeywords
            .split(/[,，]/)
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        icons: {
            icon: [{ url: iconUrl }, { url: "/favicon.ico" }],
            shortcut: iconUrl,
        },
        openGraph: {
            title: site.seoTitle || site.title,
            description: site.seoDescription,
            siteName: site.title,
            images: iconUrl ? [{ url: iconUrl }] : undefined,
        },
    };
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN" suppressHydrationWarning className="font-sans">
            <body
                className="bg-background text-foreground antialiased"
                style={{
                    fontFamily: '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
                }}
            >
                <Script
                    id="theme-script"
                    strategy="beforeInteractive"
                    dangerouslySetInnerHTML={{
                        __html: `try{var p="vozeb",l="in"+"finite-canvas";var s=JSON.parse(localStorage.getItem(p+":theme_store")||localStorage.getItem(l+":theme_store")||"{}");var t=s.state&&s.state.theme==="dark"?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t}catch(e){}`,
                    }}
                />
                <AntdRegistry>
                    <AppProviders>{children}</AppProviders>
                </AntdRegistry>
            </body>
        </html>
    );
}

function siteMetadataBase() {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    try {
        return new URL(siteUrl);
    } catch {
        return new URL("http://localhost:3000");
    }
}
