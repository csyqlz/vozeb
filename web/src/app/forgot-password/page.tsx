"use client";

import { useState } from "react";
import Link from "next/link";
import { App, Button, Input } from "antd";
import { ArrowLeft, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
    const { message } = App.useApp();
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const sendCode = async () => {
        setSendingCode(true);
        try {
            const response = await fetch("/api/auth/email-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose: "password-reset", email }),
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

    const resetPassword = async () => {
        setSubmitting(true);
        try {
            const response = await fetch("/api/auth/password/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code, newPassword }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "重置密码失败");
            message.success("密码已重置，请登录");
            window.location.href = "/login";
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重置密码失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="auth-page-bg flex h-dvh items-center justify-center overflow-y-auto px-4 py-6 text-foreground sm:px-6 sm:py-10">
            <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white/90 p-6 shadow-2xl shadow-cyan-950/10 backdrop-blur dark:border-white/10 dark:bg-black/55">
                <Link href="/login" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white">
                    <ArrowLeft className="size-4" />
                    返回登录
                </Link>
                <div className="mb-5">
                    <p className="text-sm font-medium text-cyan-600 dark:text-cyan-300">找回账号</p>
                    <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-white">重置密码</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">输入绑定邮箱，获取验证码后设置新密码。</p>
                </div>
                <div className="space-y-4">
                    <Input size="large" prefix={<Mail className="size-4 text-stone-500" />} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="绑定邮箱" type="email" />
                    <Input.Search size="large" value={code} onChange={(event) => setCode(event.target.value)} placeholder="6 位验证码" enterButton="获取验证码" loading={sendingCode} onSearch={() => void sendCode()} />
                    <Input.Password size="large" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="新密码，至少 8 位" />
                    <Button type="primary" size="large" block loading={submitting} onClick={() => void resetPassword()}>
                        重置密码
                    </Button>
                </div>
            </section>
        </main>
    );
}
