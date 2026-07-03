import Link from "next/link";

export default function PrivacyPage() {
    return (
        <main className="mx-auto max-w-3xl px-5 py-10 text-stone-800 dark:text-stone-200">
            <Link href="/" className="text-sm font-medium text-cyan-600 hover:underline dark:text-cyan-300">
                返回首页
            </Link>
            <h1 className="mt-6 text-3xl font-semibold text-stone-950 dark:text-white">隐私政策</h1>
            <div className="mt-6 space-y-5 text-sm leading-7 text-stone-600 dark:text-stone-400">
                <p>VOZEB 默认把账号、角色、额度、签到、后台配置和公共提示词保存在服务端 `.data` 目录；画布项目和个人素材主要保存在浏览器本地，是否同步到 WebDAV 取决于用户配置。</p>
                <p>开启邮箱注册、修改邮箱或忘记密码时，系统会通过管理员配置的 SMTP 服务发送验证码。验证码仅用于验证当前操作，默认 10 分钟有效，使用后失效。</p>
                <p>AI 生成请求会发送到你配置的模型服务或 OpenAI 兼容接口。请在填写 API Key、Base URL、参考图片和提示词前确认对应服务商的数据处理规则。</p>
                <p>管理员可以在后台备份 `.data/auth.json` 和 `.data/prompts.json`。请妥善保管备份文件，因为其中可能包含账号邮箱、密码哈希、后台设置和公共提示词数据。</p>
            </div>
        </main>
    );
}
