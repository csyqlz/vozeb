import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { createEmailVerificationCode, getAuthSettings, isAuthInputError, type EmailCodePurpose } from "@/lib/auth/store";
import { sendSmtpMail } from "@/lib/mail/smtp";

export const runtime = "nodejs";

const purposeText: Record<EmailCodePurpose, string> = {
    register: "注册账号",
    "email-change": "修改邮箱",
    "password-reset": "重置密码",
};

export async function POST(request: Request) {
    try {
        const body = await readJsonBody<{ purpose?: unknown; email?: unknown }>(request);
        const purpose = body.purpose === "email-change" || body.purpose === "password-reset" ? body.purpose : body.purpose === "register" ? body.purpose : null;
        if (!purpose) return NextResponse.json({ error: "验证码用途不正确" }, { status: 400 });

        const currentUser = await getCurrentUser();
        if (purpose === "email-change" && !currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

        const { code, email } = await createEmailVerificationCode({
            purpose,
            email: typeof body.email === "string" ? body.email : "",
            userId: purpose === "email-change" ? currentUser?.id : undefined,
        });
        const settings = await getAuthSettings();
        await sendSmtpMail({
            mail: settings.mail,
            to: email,
            subject: `VOZEB ${purposeText[purpose]}验证码`,
            text: [`你的 VOZEB ${purposeText[purpose]}验证码是：${code}`, "", "验证码 10 分钟内有效，请勿转发给他人。"].join("\r\n"),
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Send email code failed", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "发送验证码失败" }, { status: 400 });
    }
}
