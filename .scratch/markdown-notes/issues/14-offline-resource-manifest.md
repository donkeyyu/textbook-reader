# 14: 离线教材资源清单与校验准备

Status: ready-for-agent
Category: enhancement

**What to build:** 从 03 拆出可独立完成的教材资源准备，给桌面下载器提供可核对的版本、资源清单与完整性校验依据。

**Blocked by:** 无

## Acceptance criteria

- [x] 依据当前已核对教材版本、页面资源与目录，确定必须下载和必须随安装包提供的资源；覆盖全书原页、缩略图、目录映射、字体等离线依赖。沿用既有版本身份，不伪造页码或新的教材来源。
- [x] 提供可重复生成和验证资源清单的最小脚本或产物；固定路径、字节数及内容哈希，缺失、损坏和越界资源不能通过。
- [x] 记录下载来源与发布输入；区分真实可用远端、仅本地测试源和尚未发布的源，不把开发目录可读当作下载可用，不擅自公开发布教材。
- [x] 交付 03 可消费的清单格式和失败语义，用真实 HTTP 下载样本核对哈希及损坏失败；完整桌面下载与断网重启由 03 验证。
- [x] 不改写已有教材图像、索引事实或用户笔记；不涉及 AI 初始笔记包转换、Electron 下载界面或个人 PDF 上传。

## Scope and verification

依据 R15 教材获取与统一内容，实施授权见[任务索引](../spec.md#实施调度2026-11-01)。本票仅承接 03 的资源准备，不扩大首版范围。

## Comments

- 2026-11-01：协调者从 03 拆出，与 01 隔离并行实施；下载器与本机存储位置仍归 03。
- 2026-11-01：资源准备实施完成，待协调者审查。基于 `ea373b5`，在隔离工作树 `/Users/chengqiyu/dev/textbook-notes-14`、分支 `codex/markdown-notes-14` 实施；未改 Electron、package.json、React 界面、现有教材图像、索引事实或中央调度表。
- 交付：[生成及验证脚本](../../../scripts/offline-resources.mjs)、[检查](../../../scripts/offline-resources.test.mjs)、[消费约定](../../../resources/offline/README.md)和 `resources/offline/grade-7-volume-1/` 的 `catalog.json`、`manifest.json`、`manifest.sha256`。教材 ID 沿用 PDF SHA-256 `6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249`；清单 SHA-256 为 `c7b99570b8bc136574b9421c59a01a65f86a9298cc07b075530e68eed1f47b13`。无时间戳，重复生成结果一致。
- 覆盖：405 个下载资源，共 35,265,318 字节，含全书 202 张 WebP、202 张缩略图和目录；目录保留 6 章、15 节的既有 ID、46 项教材目录入口与逐页印刷页码，16 页无可见页码仍为 `null`。安装包静态资源清单覆盖 18 个文件，其中有 6 个字体及其授权、来源记录。原 PDF、审核索引和 404 份转换记录均在生成时核对。旧 CSV 审核摘要使用 CRLF，Git 保存 LF；脚本仅按其原始 CRLF 核对，不改写 CSV，不对下载资源做换行归一化。
- 检查通过：`node --test scripts/offline-resources.test.mjs` 共 5 项，包含清单摘要与必要项、越界路径、符号链接、缺失及损坏；实际 loopback TCP/HTTP 下载并核对全部 405 项，另外检查错误哈希、短响应、超长响应、404、206、重定向、中断和超时。staging 拒绝非空目录，已有笔记保持原字节。安装包检查覆盖固定清单内的字体、延迟 JS 文件丢失或损坏，以及当前目录中未被清单覆盖的文件。
- 检查通过：`npm run lint:backend`、`npm run build`；构建保留既有 MathJax `eval` 与 chunk 大小警告。对成功构建运行 `installer` / `verify-installer`，记录 50 个非教材文件（30 个 JS），共 6,518,196 字节，构建专属清单 SHA-256 为 `f7c0bcdb9413bc3f8f3160134f5e85a4a307ff8d1ecc78ee3b09052d6321a71e`。该枚举仅证明与提供的构建目录一致，不证明构建自身未遗漏动态依赖；票 03 仍须实际断网加载公式。构建专属临时清单已清理，集成后按消费约定重新生成。
- 下载源限制：准备清单明确记录 `source.status: unpublished`、`baseUrl: null`。已有国家平台 PDF URL 只作历史来源记录，本票未重新验证其当前可下载性，也不能当作 WebP/目录下载根 URL。本地 staging 与测试 HTTP 未发布到远端；未执行云端写入或公开教材发布。发布输入已固定为 staging 的相对路径文件集、可信清单摘要及待提供的获准 HTTPS 根 URL。真实发布源、安装包的持久资源位置、下载 UI、完整下载及断网重启验收仍归 03；AI 初始笔记包转换与个人内容迁移未纳入本票。
