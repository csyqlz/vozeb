import Link from "next/link";
import { ArrowLeft, Database, KeyRound, MailCheck, ShieldCheck, Workflow } from "lucide-react";

const policies = [
    {
        title: "账号与配置数据",
        body: "VOZEB 默认把账号、角色、额度、签到、后台配置、CDK、公告和公共提示词保存在服务端 `.data` 目录；WebDAV 由管理员后台统一接入，用户端不会展示真实连接信息。",
        icon: <Database className="size-5" />,
    },
    {
        title: "邮箱验证码",
        body: "开启邮箱注册、修改邮箱或忘记密码时，系统会通过管理员配置的 SMTP 服务发送验证码。验证码仅用于验证当前操作，默认 10 分钟有效，使用后失效。",
        icon: <MailCheck className="size-5" />,
    },
    {
        title: "AI 模型请求",
        body: "AI 生成请求统一经过系统接口代理发送到管理员配置的模型服务或 OpenAI 兼容接口，用户端不会展示真实上游域名或 API Key。部署者仍需确认对应服务商的数据处理规则。",
        icon: <Workflow className="size-5" />,
    },
    {
        title: "备份文件安全",
        body: "管理员可以在后台备份 `.data/auth.json` 和 `.data/prompts.json`。请妥善保管备份文件，因为其中可能包含账号邮箱、密码哈希、后台设置和公共提示词数据。",
        icon: <KeyRound className="size-5" />,
    },
];

export default function PrivacyPage() {
    return (
        <main className="h-dvh overflow-y-auto bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.12),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f8fafc_58%,#eef2f7_100%)] text-stone-800 dark:bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_34%),linear-gradient(180deg,#0a0a0a_0%,#101010_58%,#171717_100%)] dark:text-stone-200">
            <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-8 sm:px-8 sm:py-10">
                <Link
                    href="/"
                    className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm shadow-stone-200/50 backdrop-blur transition hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:bg-white/5 dark:text-stone-200 dark:shadow-black/30 dark:hover:border-emerald-500/50 dark:hover:text-emerald-200"
                >
                    <ArrowLeft className="size-4" />
                    返回首页
                </Link>

                <section className="mt-8 overflow-hidden rounded-lg border border-stone-200 bg-white/88 shadow-xl shadow-stone-200/60 backdrop-blur dark:border-white/10 dark:bg-stone-950/78 dark:shadow-black/30">
                    <div className="border-b border-stone-200 bg-stone-950 px-6 py-8 text-white sm:px-8 dark:border-white/10 dark:bg-white/[0.06]">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-emerald-100">
                            <ShieldCheck className="size-3.5" />
                            VOZEB Privacy
                        </div>
                        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">隐私政策</h1>
                        <p className="mt-4 max-w-2xl text-base leading-8 text-stone-200 dark:text-stone-300">这里说明 VOZEB 在账号、邮箱、模型请求和备份文件中的数据处理方式，方便部署者和使用者提前了解边界。</p>
                    </div>

                    <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
                        {policies.map((item) => (
                            <article key={item.title} className="rounded-lg border border-stone-200 bg-stone-50/80 p-5 dark:border-white/10 dark:bg-white/[0.04]">
                                <div className="flex items-center gap-3">
                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70 dark:bg-emerald-950/45 dark:text-emerald-200 dark:ring-emerald-800/60">
                                        {item.icon}
                                    </span>
                                    <h2 className="text-base font-semibold text-stone-950 dark:text-white">{item.title}</h2>
                                </div>
                                <p className="mt-4 text-sm leading-7 text-stone-600 dark:text-stone-400">{item.body}</p>
                            </article>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
