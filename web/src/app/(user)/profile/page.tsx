"use client";

import { useEffect, useState } from "react";
import { App, Button, Input } from "antd";
import { Mail, Save, ShieldCheck } from "lucide-react";

import { useUserStore, type LocalUser } from "@/stores/use-user-store";

export default function ProfilePage() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const clearSession = useUserStore((state) => state.clearSession);
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [savingProfile, setSavingProfile] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const boundEmail = user?.email || "";
    const emailChanged = email.trim().toLowerCase() !== boundEmail.toLowerCase();

    useEffect(() => {
        if (!user) return;
        setDisplayName(user.displayName || user.username);
        setEmail(user.email || "");
    }, [user]);

    const saveProfile = async () => {
        setSavingProfile(true);
        try {
            const response = await fetch("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName, email, emailCode }),
            });
            const payload = (await response.json()) as { user?: LocalUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || "保存个人资料失败");
            setUser(payload.user);
            setEmailCode("");
            message.success("个人资料已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存个人资料失败");
        } finally {
            setSavingProfile(false);
        }
    };

    const sendEmailCode = async () => {
        if (!emailChanged) {
            message.info("邮箱未变化，无需获取验证码");
            return;
        }
        setSendingCode(true);
        try {
            const response = await fetch("/api/auth/email-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose: "email-change", email }),
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

    const savePassword = async () => {
        setSavingPassword(true);
        try {
            const response = await fetch("/api/auth/password", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "修改密码失败");
            clearSession();
            message.success("密码已修改，请重新登录");
            window.location.href = "/login";
        } catch (error) {
            message.error(error instanceof Error ? error.message : "修改密码失败");
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <main className="profile-page-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto w-full max-w-4xl">
                <div className="mb-5">
                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-white">个人资料</h1>
                    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">查看已绑定邮箱，修改昵称、邮箱和登录密码。</p>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 font-semibold text-stone-950 dark:text-white">
                                <Mail className="size-4 text-cyan-500" />
                                资料与邮箱
                            </div>
                            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{boundEmail ? "已绑定邮箱" : "未绑定邮箱"}</span>
                        </div>
                        <div className="space-y-4">
                            <div className="rounded-lg border border-cyan-200/70 bg-cyan-50/70 p-3 text-sm leading-6 text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/25 dark:text-cyan-100">
                                <div className="font-medium">{boundEmail ? "当前绑定邮箱" : "当前未绑定邮箱"}</div>
                                <div className="mt-1 break-all text-cyan-800/80 dark:text-cyan-100/75">{boundEmail || "绑定邮箱后可用于找回密码和接收验证码。"}</div>
                            </div>
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">登录用户名</span>
                                <Input value={user?.username || ""} disabled />
                                <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">用户名用于登录和账号识别，注册后不可修改；可使用已绑定邮箱登录。</span>
                            </label>
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">显示昵称</span>
                                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                            </label>
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{boundEmail ? "修改邮箱" : "绑定邮箱"}</span>
                                <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@qq.com" />
                            </label>
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">邮箱验证码</span>
                                <Input.Search
                                    value={emailCode}
                                    onChange={(event) => setEmailCode(event.target.value)}
                                    placeholder={emailChanged ? "修改邮箱时必填" : "邮箱未变化时无需填写"}
                                    enterButton="获取验证码"
                                    loading={sendingCode}
                                    disabled={!emailChanged}
                                    onSearch={() => void sendEmailCode()}
                                />
                            </label>
                            <Button type="primary" icon={<Save className="size-4" />} loading={savingProfile} onClick={() => void saveProfile()}>
                                保存资料
                            </Button>
                        </div>
                    </section>
                    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
                        <div className="mb-4 flex items-center gap-2 font-semibold text-stone-950 dark:text-white">
                            <ShieldCheck className="size-4 text-cyan-500" />
                            修改密码
                        </div>
                        <div className="space-y-4">
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">当前密码</span>
                                <Input.Password value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                            </label>
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">新密码</span>
                                <Input.Password value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" />
                            </label>
                            <Button type="primary" danger loading={savingPassword} onClick={() => void savePassword()}>
                                修改密码并重新登录
                            </Button>
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}
