<p align="center">
  <img src="web/public/logo.svg?v=0.5.2-white" width="108" alt="VOZEB logo">
</p>

<h1 align="center">VOZEB</h1>

<p align="center">
  <a href="https://github.com/csyqlz/vozeb"><img src="https://img.shields.io/github/stars/csyqlz/vozeb?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v0.5.2-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://vercel.com/"><img src="https://img.shields.io/badge/Vercel-ready-000000?style=flat-square&logo=vercel" alt="Vercel ready"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16.2-000000?style=flat-square&logo=nextdotjs" alt="Next.js"></a>
</p>

VOZEB 是一款面向 AI 图片创作、素材管理和视觉方案迭代的开源工作台。它把无限画布、AI 生成、参考图编辑、提示词库、素材沉淀、用户权限、管理员配置和本地 Agent 能力放到同一个工作流里，适合个人创作者、本地部署场景和小团队内部使用。

VOZEB 当前版本为 `v0.5.2`，这是基于原开源项目 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 继续开发的二开版本。感谢原创作者 basketikun 对无限画布、AI 创作工作流、Canvas Agent 和 Codex 插件能力的开源贡献。

> [!CAUTION]
> 项目仍处于快速开发阶段，不保证历史数据兼容。当前更适合个人或本地部署，不建议直接公网多人共用。

## 功能总览

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 图片创作：支持文生图、图生图、参考图编辑、图片反推提示词、图片切图、局部蒙版修改和图片放大。
- 音频与视频：支持音频节点、视频生成、声音/水印配置，以及图片、视频、音频参考输入。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回当前画布。
- 提示词库：支持公共提示词库、我的提示词、标签、分类、封面和提示词素材沉淀；管理员公共提示词会采集原作者接入的远程提示词源，并只保留可访问的远程图片 URL。
- 素材管理：支持图片、文本、视频等素材保存、复用、导入导出和 WebDAV 同步。
- 用户系统：支持账号密码注册登录、管理员后台、用户角色、账号状态、每日额度和签到奖励。
- 通用接口：管理员可配置 OpenAI 兼容接口、系统模型渠道、默认模型，并允许或禁止用户自配接口。
- 本地 Agent：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 通过 MCP 操作当前画布。
- Codex App 插件：提供 Codex app 插件，安装后可自动注册 MCP 并尝试拉起本地 Agent。
- 版本更新：右上角版本入口可查看更新记录，并从 `csyqlz/vozeb` 检查最新版本。

## v0.5.2 更新

- 首页改为公开官网式首屏，登录入口直接融合到首页；已登录用户可一键进入工作台。
- VOZEB 标题下方加入轻量动态披风 SVG 光翼，背景改为静态海蓝星海，保留视觉冲击同时避免 Canvas 粒子卡顿。
- Next.js 构建支持 `NEXT_BUILD_CPUS` 限制 worker 数，Docker 默认 `NEXT_BUILD_CPUS=1`，更适合 2 核 2G 服务器构建。

## v0.5.1 更新

- 版本提升为 `v0.5.1`，同步更新项目说明、文档入口、部署命令和版本检查信息。
- 管理员公共提示词库接入原作者提示词源采集，只保留可正常访问的远程图片 URL，封面不写入浏览器本地素材存储。
- 后台公共提示词表格新增封面缩略图，便于管理员确认图片是否正常显示。
- 修正文档站、Docker、Render、快速开始等资料里的旧仓库地址和旧项目名称。

## v0.5.0 更新

- 项目品牌更新为 VOZEB，GitHub 链接、版本检查地址和文档配置切换到 `csyqlz/vozeb`。
- 版本定义为 `v0.5.0`，版本弹窗新增二开说明、原作者信息和当前功能记录。
- 管理员后台改为侧边栏切换布局，支持概览、系统设置、用户管理和公共提示词库分区管理。
- 管理后台可集中管理注册开关、签到奖励、用户额度、系统接口渠道、默认模型和公共提示词。
- 签到成功等全局通知下移到顶部导航下方，并统一浅色/深色通知样式。
- 后台侧栏选中态适配深色主题，避免点击后出现突兀反白。
- 使用新的 VOZEB 图标作为 logo 与 favicon，并适配浅色/深色主题颜色。
- 修复检查更新逻辑：当本地当前版本高于远端旧版本时，不再把远端旧版本显示为最新。
- README 补回完整项目说明、功能清单、截图展示、部署方式和原创作者致谢。

## 详细功能

### 画布创作

VOZEB 的核心工作流围绕无限画布展开。你可以在画布里放置图片、文本、音频、视频和配置节点，通过连线组织上下游关系，用节点工具条进行复制、下载、保存素材、编辑、切图、放大、蒙版局部修改等操作。画布支持多项目管理、导入导出、撤销重做、小地图和快捷键。

### AI 生成

项目支持 OpenAI 兼容接口，浏览器前台可直接请求用户配置的 `Base URL` 和 `API Key`。支持文本问答、文生图、图生图、参考图编辑、音频生成和视频生成。视频生成支持 Seedance 2.0 场景，可通过火山方舟 Agent Plan 接入。

### 提示词与素材

公共提示词由管理员后台维护，会出现在用户端提示词库。用户也可以维护自己的提示词，把稳定的提示词、参考风格和生成结果沉淀为素材。素材库支持本地保存、导入导出和可选 WebDAV 同步，适合长期积累个人创作资产。

### 用户与管理员

VOZEB 增加了账号系统和后台管理能力。管理员可以控制注册是否开放，调整用户角色、账号状态、每日额度、签到奖励、系统接口渠道和默认模型。后台采用侧边栏切换布局，概览、系统设置、用户管理和公共提示词库分区更清楚。

### Agent 与插件

本地 Canvas Agent 可以连接 Codex / Claude Code，让 Agent 通过 MCP 读取和操作当前画布。仓库同时提供 Codex App 插件，安装后会注册同一个 `infinite-canvas` MCP，并尝试拉起本地 Agent。当前仍保留原 MCP 名称和部分内部存储 key，以避免破坏已有用户数据和插件兼容性。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="VOZEB 画布编排" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="VOZEB 图片生成" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="VOZEB 参考图编辑" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="VOZEB 节点工作流" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="VOZEB 多图展示" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="VOZEB 创作结果" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/jkWsF8q1/image.png" alt="VOZEB 素材沉淀" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/XrnfXHx7/image.png" alt="VOZEB 画布效果" border="0"></td>
  </tr>
</table>

## 技术栈

- 前端：Next.js、React、TypeScript、Tailwind CSS、Ant Design、Zustand、TanStack Query。
- 存储：浏览器本地存储为主，支持导入导出与可选 WebDAV 同步。
- Agent：Canvas Agent、MCP、Codex / Claude Code 本地集成。
- 部署：Vercel 或 Docker。

## 快速开始

```bash
git clone git@github.com:csyqlz/vozeb.git
cd vozeb/web
pnpm install
pnpm run dev
```

运行后默认端口为 `3000`，可访问 `http://localhost:3000`。

首次打开后进入右上角配置，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`。

## Docker 运行

低配服务器（例如 2 核 2G）建议优先使用发布镜像，拉取速度和稳定性都比现场构建更好：

```yaml
services:
  app:
    image: ghcr.io/csyqlz/vozeb:latest
    container_name: vozeb
    ports:
      - "3000:3000"
    restart: unless-stopped
```

如果需要基于当前源码本地构建，再使用下面的命令：

```bash
docker build -t vozeb .
docker run --rm -p 3000:3000 vozeb
```

## New API 自动配置

如果使用 New API，可在 `系统设置 -> 聊天方式 -> 添加聊天设置` 中填入：

```text
https://your-vozeb-domain.example?apiKey={key}&baseUrl={address}
```

跳转后会自动打开配置弹窗并填入 API Key 和 Base URL。请把示例域名替换成你的 VOZEB 部署地址。

## 文档

- [快速开始](docs/content/docs/overview/quick-start.mdx)
- [功能介绍](docs/content/docs/overview/features.mdx)
- [Render 部署](docs/content/docs/overview/render.mdx)
- [Docker 部署](docs/content/docs/overview/docker.mdx)
- [第三方 GitHub 提示词仓库](docs/content/docs/overview/third-party-prompt-repositories.mdx)
- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [画布快捷键](docs/content/docs/canvas/canvas-shortcuts.mdx)
- [本地开发](docs/content/docs/backend/local-development.mdx)
- [画布数据结构](docs/content/docs/backend/canvas-data-structure.mdx)
- [本地 Canvas Agent](canvas-agent/README.md)
- [Codex app 插件](plugins/infinite-canvas)
- [开源协议](docs/content/docs/business/license.mdx)
- [贡献者协议](docs/content/docs/business/cla.mdx)
- [漏洞提交](docs/content/docs/support/security.mdx)
- [待办事项](docs/content/docs/progress/todo.mdx)
- [待测试](docs/content/docs/progress/pending-test.mdx)

## 致谢

VOZEB 基于原开源项目 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 继续开发。感谢原创作者 basketikun 对无限画布、AI 创作工作流、Canvas Agent 和 Codex 插件能力的开源贡献。

也感谢 LinuxDO 社区、相关提示词开源仓库、Codex / Claude Code 生态和所有工具链项目提供的灵感与基础设施。

## 开源协议

本项目继续遵循 GNU Affero General Public License v3.0，见 [LICENSE](LICENSE)。二次开发、分发或部署时请遵守 AGPL-3.0 协议，并保留原作者与本项目的开源信息。
