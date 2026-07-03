"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { App, Button, Input } from "antd";

import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";

type AuthFormProps = {
    mode: "login" | "register";
    nextPath?: string;
    registrationEnabled?: boolean;
    firstUser?: boolean;
    variant?: "page" | "embedded";
    className?: string;
    headerSlot?: ReactNode;
};

export function AuthForm({ mode, nextPath = "/canvas", registrationEnabled = true, firstUser = false, variant = "page", className, headerSlot }: AuthFormProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const setUser = useUserStore((state) => state.setUser);
    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const isRegister = mode === "register";
    const disabled = isRegister && !registrationEnabled;

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (disabled) return;
        setSubmitting(true);
        try {
            const response = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, displayName, password }),
            });
            const payload = (await response.json()) as { user?: LocalUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || (isRegister ? "注册失败" : "登录失败"));
            setUser(payload.user);
            message.success(isRegister ? "注册成功" : "登录成功");
            router.replace(nextPath);
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : isRegister ? "注册失败" : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    const form = (
        <section className={cn("auth-panel flex min-h-full items-center", variant === "embedded" ? "p-6 sm:p-7" : "p-8 sm:p-10", className)}>
            <form onSubmit={submit} className="w-full space-y-5">
                {headerSlot}
                <div>
                    <p className="text-sm font-medium text-cyan-300">{firstUser ? "首次设置" : isRegister ? "创建账号" : "账号访问"}</p>
                    <h2 className={cn("mt-2 font-semibold tracking-normal text-white", variant === "embedded" ? "text-2xl" : "text-3xl")}>{firstUser ? "创建第一个管理员账号" : isRegister ? "注册后进入 VOZEB" : "登录进入 VOZEB"}</h2>
                    <p className="mt-3 text-sm leading-6 text-stone-400">{isRegister ? "用户名支持字母、数字、下划线、点和短横线。" : "输入账号后直接进入画布、素材、模型和提示词工作流。"}</p>
                </div>

                {disabled ? <div className="rounded-md border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-50">当前站点已关闭注册，请联系管理员开通账号。</div> : null}

                <label className="block space-y-2">
                    <span className="text-sm font-medium text-stone-200">用户名</span>
                    <Input size="large" prefix={<UserRound className="size-4 text-stone-500" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="your_name" autoComplete="username" disabled={submitting || disabled} required />
                </label>

                {isRegister ? (
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-stone-200">显示名称</span>
                        <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="用于顶部账号菜单" autoComplete="name" disabled={submitting || disabled} />
                    </label>
                ) : null}

                <label className="block space-y-2">
                    <span className="text-sm font-medium text-stone-200">密码</span>
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-stone-500" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={isRegister ? "至少 8 位" : "请输入密码"}
                        autoComplete={isRegister ? "new-password" : "current-password"}
                        disabled={submitting || disabled}
                        required
                    />
                </label>

                <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                    {isRegister ? "注册并进入" : "登录"}
                </Button>

                <div className="text-center text-sm text-stone-400">
                    {isRegister ? (
                        <>
                            已有账号？{" "}
                            <Link href="/login" className="font-medium text-white hover:underline">
                                去登录
                            </Link>
                        </>
                    ) : (
                        <>
                            没有账号？{" "}
                            <Link href="/register" className="font-medium text-white hover:underline">
                                去注册
                            </Link>
                        </>
                    )}
                </div>
            </form>
        </section>
    );

    if (variant === "embedded") return form;

    return (
        <main className="auth-page-bg flex min-h-dvh items-center justify-center px-6 py-10 text-foreground">
            <div className="grid w-full max-w-5xl overflow-hidden border border-white/10 bg-black/50 shadow-2xl shadow-cyan-950/20 backdrop-blur md:grid-cols-[0.9fr_1fr]">
                <section className="flex min-h-[360px] flex-col justify-between border-b border-white/10 p-8 text-white md:border-b-0 md:border-r">
                    <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold">
                        <span
                            className="size-8 bg-cyan-300"
                            style={{
                                mask: "url(/logo.svg) center / contain no-repeat",
                                WebkitMask: "url(/logo.svg) center / contain no-repeat",
                            }}
                        />
                        VOZEB
                    </Link>
                    <div>
                        <p className="text-sm text-cyan-200/70">{firstUser ? "首次设置" : isRegister ? "创建账号" : "账号访问"}</p>
                        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-normal">{firstUser ? "创建第一个管理员账号" : isRegister ? "注册后进入 VOZEB 工作台" : "登录继续你的 VOZEB 创作"}</h1>
                    </div>
                    <p className="max-w-sm text-sm leading-6 text-stone-400">账号系统负责身份和权限，画布、素材、模型等工作流会保留在登录后的主界面里。</p>
                </section>
                {form}
            </div>
        </main>
    );
}
