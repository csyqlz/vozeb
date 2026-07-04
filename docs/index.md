# VOZEB 文档索引

当前版本：`v0.7.7`。VOZEB 是基于原创开源画布项目继续开发的二开版本，当前仓库为 `csyqlz/vozeb`。

## 项目介绍

- [快速开始](/docs/overview/quick-start)
- [功能介绍](/docs/overview/features)
- [Codex App 插件](/docs/overview/codex-app-plugin)
- [Render 部署](/docs/overview/render)
- [Docker 部署](/docs/overview/docker)
- [第三方 GitHub 提示词仓库](/docs/overview/third-party-prompt-repositories)

## 操作手册

- [画布节点操作手册](/docs/canvas/canvas-node-manual)
- [画布快捷键](/docs/canvas/canvas-shortcuts)

## 开发与数据

- [本地开发](/docs/backend/local-development)
- [画布数据结构](/docs/backend/canvas-data-structure)

## 商务合作

- [开源协议](/docs/business/license)
- [贡献者协议](/docs/business/cla)
- [商务合作](/docs/business/business)

## 支持与安全

- [漏洞提交](/docs/support/security)
- [打赏支持](/docs/support/donate)
- [广告赞助](/docs/support/sponsor)

## 项目进度

- [更新日志](/docs/progress/changelog)
- [待测试](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)

## 说明

- 当前画布项目和“我的素材”主要保存在浏览器本地，跨设备可自行配置 WebDAV 同步。
- 管理员后台支持账号、邮箱注册、SMTP 邮箱服务、积分、模型渠道和公共提示词库管理。
- 管理员后台概览支持导出和导入服务端用户数据库、公共提示词与生成日志备份，导入前会保留当前数据快照。
- 管理员后台支持生成日志，能按用户、日期、类型、入口和状态查看图片/视频生成记录与提示词，并支持勾选删除。
- 公共提示词库会采集原作者接入的远程提示词源，只保留可访问的远程图片 URL，不写入浏览器本地素材存储；后台手机端提示词列表使用卡片布局，避免表格横向溢出。
- 生图和视频创作台支持生成记录标题重命名，右侧生成结果可选择删除；生图结果可清理失效图片，手机端记录抽屉会完整滚动展示。
