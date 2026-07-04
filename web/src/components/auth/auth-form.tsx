"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, UserRound } from "lucide-react";
import { App, Button, Input } from "antd";

import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";

type AuthFormProps = {
    mode: "login" | "register";
    nextPath?: string;
    registrationEnabled?: boolean;
    emailRegistrationEnabled?: boolean;
    firstUser?: boolean;
    variant?: "page" | "embedded";
    className?: string;
    headerSlot?: ReactNode;
    authError?: string;
};

export function AuthForm({ mode, nextPath = "/canvas", registrationEnabled = true, emailRegistrationEnabled = false, firstUser = false, variant = "page", className, headerSlot, authError }: AuthFormProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const setUser = useUserStore((state) => state.setUser);
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
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
                body: JSON.stringify({ username, email, emailCode, displayName, password }),
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

    const sendEmailCode = async () => {
        setSendingCode(true);
        try {
            const response = await fetch("/api/auth/email-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose: "register", email }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "验证码发送失败");
            message.success("验证码已发送，请查看邮箱");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "验证码发送失败");
        } finally {
            setSendingCode(false);
        }
    };

    const form = (
        <section className={cn("auth-panel flex min-h-full items-center", variant === "embedded" ? "p-6 sm:p-7" : "p-8 sm:p-10", className)}>
            <form onSubmit={submit} className="auth-form-body w-full space-y-6">
                {headerSlot}
                <div className="auth-form-header">
                    <p className="auth-form-kicker text-sm font-medium text-cyan-600 dark:text-cyan-300">{firstUser ? "首次设置" : isRegister ? "创建账号" : "账号访问"}</p>
                    <h2 className={cn("mt-2 font-semibold tracking-normal text-stone-950 dark:text-white", variant === "embedded" ? "text-2xl" : "text-3xl")}>{firstUser ? "创建第一个管理员账号" : isRegister ? "注册后进入 VOZEB" : "登录进入 VOZEB"}</h2>
                    <p className="auth-form-description mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{isRegister ? "创建账号后即可进入 VOZEB。" : "登录后继续你的画布、素材和提示词工作流。"}</p>
                </div>

                {authError ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100">{authError}</div> : null}

                {disabled ? <div className="rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900 dark:border-cyan-300/20 dark:bg-cyan-300/8 dark:text-cyan-50">当前站点已关闭注册，请联系管理员开通账号。</div> : null}

                <label className="block space-y-3">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{isRegister ? "登录用户名" : "用户名 / 邮箱"}</span>
                    <Input
                        size="large"
                        prefix={<UserRound className="size-4 text-stone-500" />}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder={isRegister ? "your_name" : "用户名或已绑定邮箱"}
                        autoComplete="username"
                        disabled={submitting || disabled}
                        required
                    />
                    {isRegister ? <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">用于登录，注册后不可修改；昵称可在个人资料中随时修改。</span> : null}
                </label>

                {isRegister && emailRegistrationEnabled ? (
                    <div className="space-y-3">
                        <label className="block space-y-3">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">邮箱</span>
                            <Input
                                size="large"
                                prefix={<Mail className="size-4 text-stone-500" />}
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="name@qq.com"
                                autoComplete="email"
                                type="email"
                                disabled={submitting || disabled}
                                required
                            />
                        </label>
                        <label className="block space-y-3">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">邮箱验证码</span>
                            <Input.Search
                                size="large"
                                value={emailCode}
                                onChange={(event) => setEmailCode(event.target.value)}
                                placeholder="6 位验证码"
                                enterButton={sendingCode ? "发送中" : "获取验证码"}
                                loading={sendingCode}
                                disabled={submitting || disabled}
                                onSearch={() => void sendEmailCode()}
                                required
                            />
                        </label>
                    </div>
                ) : null}

                {isRegister ? (
                    <label className="block space-y-3">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">显示昵称</span>
                        <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示在顶部账号菜单，可留空" autoComplete="name" disabled={submitting || disabled} />
                    </label>
                ) : null}

                <label className="block space-y-3">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">密码</span>
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

                <Button className="auth-submit-button" type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                    {isRegister ? "注册并进入" : "登录"}
                </Button>

                <div className="auth-switch-link pt-2 text-center text-sm text-stone-500 dark:text-stone-400">
                    {isRegister ? (
                        <>
                            已有账号？{" "}
                            <Link href="/login" className="font-medium text-stone-950 hover:underline dark:text-white">
                                去登录
                            </Link>
                        </>
                    ) : (
                        <>
                            没有账号？{" "}
                            <Link href="/register" className="font-medium text-stone-950 hover:underline dark:text-white">
                                去注册
                            </Link>
                            <span className="mx-2 text-stone-300 dark:text-stone-700">/</span>
                            <Link href="/forgot-password" className="font-medium text-stone-950 hover:underline dark:text-white">
                                忘记密码
                            </Link>
                        </>
                    )}
                </div>
            </form>
        </section>
    );

    if (variant === "embedded") return form;

    return (
        <main className="auth-page-bg flex h-dvh items-center justify-center overflow-y-auto px-4 py-6 text-foreground sm:px-6 sm:py-10">
            <div className="auth-page-card grid w-full max-w-5xl overflow-hidden border border-stone-200 bg-white/86 shadow-2xl shadow-cyan-950/10 backdrop-blur md:grid-cols-[0.9fr_1fr] dark:border-white/10 dark:bg-black/50 dark:shadow-cyan-950/20">
                <section className="auth-page-brand-panel flex min-h-[220px] flex-col justify-between gap-5 border-b border-stone-200 p-5 text-stone-950 sm:min-h-[360px] sm:gap-8 sm:p-8 md:border-b-0 md:border-r dark:border-white/10 dark:text-white">
                    <div className="flex items-start justify-between gap-4">
                        <Link href="/" className="inline-flex items-center gap-4 text-base font-semibold">
                            <span
                                className="size-16 bg-stone-950 sm:size-20 dark:bg-cyan-200"
                                style={{
                                    mask: "url(/logo.svg) center / contain no-repeat",
                                    WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                }}
                            />
                            <span className="text-3xl">VOZEB</span>
                        </Link>
                        <Link
                            href="/"
                            className="auth-back-home inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white/70 px-3 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:text-stone-950 dark:border-white/10 dark:bg-white/5 dark:text-stone-200 dark:hover:border-white/20 dark:hover:text-white"
                        >
                            <ArrowLeft className="size-4" />
                            <span>返回首页</span>
                        </Link>
                    </div>
                    <div className="auth-page-brand-copy">
                        <h1 className="text-balance text-2xl font-semibold tracking-normal sm:text-3xl">{firstUser ? "创建第一个管理员账号" : isRegister ? "创建你的 VOZEB 账号" : "继续你的 VOZEB 创作"}</h1>
                    </div>
                    <div className="auth-page-feature-list grid gap-2 text-sm text-stone-600 dark:text-stone-300">
                        {["画布与素材自动保留", "提示词与模型集中管理", "管理员后台统一配置"].map((item) => (
                            <div key={item} className="flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-cyan-400" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>
                    <p className="auth-page-brand-description max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">账号系统负责身份和权限，画布、素材、模型等工作流会保留在登录后的主界面里。</p>
                </section>
                {form}
            </div>
        </main>
    );
}
