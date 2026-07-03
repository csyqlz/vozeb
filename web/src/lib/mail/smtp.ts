import net from "node:net";
import tls from "node:tls";

import type { MailSettings } from "@/lib/auth/store";

type SmtpSocket = net.Socket | tls.TLSSocket;

type SendTestMailInput = {
    mail: MailSettings;
    to?: string;
};

type SendSmtpMailInput = {
    mail: MailSettings;
    to: string;
    subject: string;
    text: string;
};

const COMMAND_TIMEOUT_MS = 15000;

export async function sendSmtpTestMail({ mail, to }: SendTestMailInput) {
    const username = mail.username.trim();
    const fromEmail = (mail.fromEmail || username).trim();
    const recipient = (to || fromEmail || username).trim();
    await sendSmtpMail({
        mail,
        to: recipient,
        subject: "VOZEB 邮箱服务测试",
        text: ["这是一封来自 VOZEB 管理后台的测试邮件。", "", "如果你收到这封邮件，说明 SMTP 配置可以正常发送。"].join("\r\n"),
    });
}

export async function sendSmtpMail({ mail, to, subject, text }: SendSmtpMailInput) {
    const host = mail.host.trim();
    const port = Number(mail.port) || 465;
    const username = mail.username.trim();
    const password = mail.password;
    const fromEmail = (mail.fromEmail || username).trim();
    const recipient = to.trim();
    const fromName = (mail.fromName || "VOZEB").trim();

    if (!host) throw new Error("请填写 SMTP 服务器");
    if (!username) throw new Error("请填写邮箱账号");
    if (!password) throw new Error("请填写授权码或密码");
    if (!isEmail(fromEmail)) throw new Error("发件邮箱格式不正确");
    if (!isEmail(recipient)) throw new Error("测试收件邮箱格式不正确");

    const client = await SmtpClient.connect({ host, port, secure: mail.secure });
    try {
        await client.expect([220]);
        const ehlo = await client.command(`EHLO ${smtpDomain(fromEmail)}`, [250]);
        if (!mail.secure && /\bSTARTTLS\b/i.test(ehlo.text)) {
            await client.command("STARTTLS", [220]);
            await client.upgradeToTls(host);
            await client.command(`EHLO ${smtpDomain(fromEmail)}`, [250]);
        }
        await client.command("AUTH LOGIN", [334]);
        await client.command(Buffer.from(username, "utf8").toString("base64"), [334]);
        await client.command(Buffer.from(password, "utf8").toString("base64"), [235]);
        await client.command(`MAIL FROM:<${fromEmail}>`, [250]);
        await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
        await client.command("DATA", [354]);
        await client.writeData(buildMessage({ fromEmail, fromName, recipient, subject, body: text }));
        await client.command("QUIT", [221]).catch(() => undefined);
    } finally {
        client.close();
    }
}

class SmtpClient {
    private buffer = "";
    private socket: SmtpSocket;

    private constructor(socket: SmtpSocket) {
        this.socket = socket;
        this.socket.setEncoding("utf8");
        this.socket.on("data", (chunk) => {
            this.buffer += chunk;
        });
    }

    static connect(options: { host: string; port: number; secure: boolean }) {
        return new Promise<SmtpClient>((resolve, reject) => {
            const socket = options.secure ? tls.connect({ host: options.host, port: options.port, servername: options.host }) : net.connect({ host: options.host, port: options.port });
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error("连接 SMTP 服务器超时"));
            }, COMMAND_TIMEOUT_MS);
            socket.once(options.secure ? "secureConnect" : "connect", () => {
                clearTimeout(timer);
                resolve(new SmtpClient(socket));
            });
            socket.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    upgradeToTls(host: string) {
        return new Promise<void>((resolve, reject) => {
            const nextSocket = tls.connect({ socket: this.socket, servername: host });
            const timer = setTimeout(() => {
                nextSocket.destroy();
                reject(new Error("升级 TLS 连接超时"));
            }, COMMAND_TIMEOUT_MS);
            nextSocket.setEncoding("utf8");
            nextSocket.on("data", (chunk) => {
                this.buffer += chunk;
            });
            nextSocket.once("secureConnect", () => {
                clearTimeout(timer);
                this.socket = nextSocket;
                resolve();
            });
            nextSocket.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    async command(command: string, expectedCodes: number[]) {
        this.socket.write(`${command}\r\n`);
        return this.expect(expectedCodes);
    }

    async writeData(data: string) {
        this.socket.write(`${data}\r\n.\r\n`);
        return this.expect([250]);
    }

    expect(expectedCodes: number[]) {
        return new Promise<{ code: number; text: string }>((resolve, reject) => {
            const startedAt = Date.now();
            const poll = () => {
                const response = parseResponse(this.buffer);
                if (response) {
                    this.buffer = this.buffer.slice(response.length);
                    if (!expectedCodes.includes(response.code)) {
                        reject(new Error(response.text || `SMTP 返回异常：${response.code}`));
                        return;
                    }
                    resolve({ code: response.code, text: response.text });
                    return;
                }
                if (Date.now() - startedAt > COMMAND_TIMEOUT_MS) {
                    reject(new Error("等待 SMTP 响应超时"));
                    return;
                }
                setTimeout(poll, 25);
            };
            poll();
        });
    }

    close() {
        this.socket.destroy();
    }
}

function parseResponse(buffer: string) {
    const match = buffer.match(/(?:^|\r?\n)(\d{3}) [^\r\n]*(?:\r?\n|$)/);
    if (!match || match.index === undefined) return null;
    const end = match.index + match[0].length;
    const text = buffer.slice(0, end).trim();
    return { code: Number(match[1]), text, length: end };
}

function buildMessage({ fromEmail, fromName, recipient, subject, body }: { fromEmail: string; fromName: string; recipient: string; subject: string; body: string }) {
    return [
        `From: ${encodeHeader(fromName)} <${fromEmail}>`,
        `To: <${recipient}>`,
        `Subject: ${encodeHeader(subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        `Date: ${new Date().toUTCString()}`,
        "",
        dotStuff(body),
    ].join("\r\n");
}

function encodeHeader(value: string) {
    return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function dotStuff(value: string) {
    return value.replace(/\r?\n\./g, "\r\n..");
}

function smtpDomain(email: string) {
    return email.split("@")[1] || "vozeb.local";
}

function isEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
