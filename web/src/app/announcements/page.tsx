import Link from "next/link";
import { ArrowLeft, Megaphone } from "lucide-react";

import { listAnnouncements } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
    const announcements = await listAnnouncements(false);

    return (
        <main className="min-h-dvh bg-background px-4 py-8 text-stone-950 dark:text-stone-100 sm:px-6">
            <div className="mx-auto max-w-4xl">
                <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white">
                    <ArrowLeft className="size-4" />
                    返回首页
                </Link>
                <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/50 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
                    <div className="flex items-center gap-3">
                        <span className="flex size-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200/80 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-900/70">
                            <Megaphone className="size-5" />
                        </span>
                        <div>
                            <h1 className="text-2xl font-semibold">网站公告</h1>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">按发布时间展示站点通知、维护说明和功能提醒。</p>
                        </div>
                    </div>
                </div>
                <div className="mt-5 space-y-4">
                    {announcements.map((announcement) => (
                        <article key={announcement.id} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">{announcement.title}</h2>
                                <time className="text-xs text-stone-500 dark:text-stone-400">{new Date(announcement.createdAt).toLocaleString("zh-CN")}</time>
                            </div>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-600 dark:text-stone-300">{announcement.content}</p>
                        </article>
                    ))}
                    {!announcements.length ? <div className="rounded-xl border border-dashed border-stone-300 py-16 text-center text-sm text-stone-500 dark:border-stone-700">暂无公告</div> : null}
                </div>
            </div>
        </main>
    );
}
