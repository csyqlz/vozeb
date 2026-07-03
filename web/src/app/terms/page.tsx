import Link from "next/link";

export default function TermsPage() {
    return (
        <main className="mx-auto max-w-3xl px-5 py-10 text-stone-800 dark:text-stone-200">
            <Link href="/" className="text-sm font-medium text-cyan-600 hover:underline dark:text-cyan-300">
                返回首页
            </Link>
            <h1 className="mt-6 text-3xl font-semibold text-stone-950 dark:text-white">使用条款</h1>
            <div className="mt-6 space-y-5 text-sm leading-7 text-stone-600 dark:text-stone-400">
                <p>VOZEB 是面向 AI 创作、无限画布、提示词管理和素材沉淀的开源项目。你可以在遵守 AGPL-3.0 协议和原作者致谢要求的前提下部署、修改和分发。</p>
                <p>你需要自行配置并管理所使用的 AI 接口、模型服务、邮箱 SMTP 和第三方存储服务，并遵守对应服务商的条款。由外部接口、模型输出、邮箱服务或部署环境导致的问题，应由部署者自行评估和处理。</p>
                <p>管理员可以管理用户、额度、注册策略、邮箱服务、网站信息和公共提示词库。请勿上传、生成或传播违法、侵权、恶意或违反当地法律法规的内容。</p>
                <p>本项目仍处于快速迭代阶段，建议在升级前通过管理员后台备份用户数据库和公共提示词数据。</p>
            </div>
        </main>
    );
}
