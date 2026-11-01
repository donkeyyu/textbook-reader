# 当前教材离线资源约定

本目录交付票 14 的资源准备。票 03 负责下载动作、持久存储、完成状态和桌面断网重启验收。这里不包含初始 Markdown 笔记包，不导入或改写用户笔记。

## 版本与产物

- 教材 ID 沿用 `src/textbook/library.ts`：原 PDF 的 SHA-256，即 `6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249`。资源路径中的 `grade-7-volume-1` 只是既有路径，不是另一套版本 ID。
- `grade-7-volume-1/manifest.json` 固定 `schemaVersion: 1`、教材 ID、202 页以及各文件的 `path`、`bytes`、`sha256`。路径采用相对于发布根目录的 POSIX 路径，大小按原始文件字节计算，SHA-256 为小写十六进制。
- `manifest.sha256` 是上述 JSON 文件本身的摘要，包含其实际缩进和末尾换行。消费者须从可信安装包或发布配置固定此摘要。仅从同一下载服务器获取清单和摘要，不能证明其可信。
- `download` 共 405 项：`textbooks/grade-7-volume-1/page-1.webp` 至 `page-202.webp`、`thumb-1.webp` 至 `thumb-202.webp`，以及同目录的 `catalog.json`。PDF、原 PNG 和转换记录不是阅读所需下载资源；它们保留在开发来源材料中。
- `installerPublic` 列出当前 `public/` 中除 `textbooks/` 外的全部 18 个文件，包含 6 个 WOFF2 字体、字体授权及来源记录、界面素材。它们必须随安装包提供。

`catalog.json` 是教材级持久目录的输入，其格式为：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 整数 `1` |
| `textbookId`、`title`、`pageCount` | 既有教材版本、标题和页数 |
| `pages` | 202 条 `{ page, width, height, printedPage }`；`page` 从 1 开始，`printedPage` 为原页可见字符串或 `null` |
| `chapters` | 6 条既有 `{ id, title, start, end }`，ID 如 `chapter-1`；范围均为文件页序 |
| `sections` | 15 条既有 `{ id, chapterId, title, start, end }`，ID 如 `1.1` |
| `contents` | 已核对教材目录的全部 46 项 `{ title, contentsPrintedPage, pdfPage }`；栏目入口不另造章、节 ID |

页码来自 `src/textbook/book.json`，并逐条与已审核 `index.jsonl` 核对。章、节直接读取 `src/textbook/sections.ts` 导出的现有 ID 与范围。`contents` 取自已核对的 `catalog.md`；`contentsPrintedPage` 是目录所写页码，不能替代原页 `printedPage`。例如章扉页仍为 `null`。生成器不重新做教材内容索引，也不修改这些来源。

生成时核对原 PDF、索引审核摘要和 404 份 WebP 转换记录。旧 `verification.json` 中 CSV 摘要对应 CRLF，而 Git 保存的是 LF；仅对此 CSV 恢复原始 CRLF 后核对摘要，原文件不改写。下载资源和生成产物仍逐字节核对，不做换行归一化。

## 命令

在仓库根目录直接运行；不需要新增依赖或 npm 命令：

```sh
node scripts/offline-resources.mjs generate
node scripts/offline-resources.mjs verify
node --test scripts/offline-resources.test.mjs
```

生成器需要仓库中的原 PDF、既有索引、WebP、转换记录和静态资源。它会启动同一 Node 的 `--experimental-strip-types` 子进程读取现有目录导出。节点版本要求沿用项目 `package.json`；不需要未入库的 PNG 或 `cwebp`。`generate` 只更新本目录三份 JSON/摘要产物；`verify` 不写文件，并要求当前来源与已提交产物完全一致。

发布准备可将 `download` 所列文件复制到一个空目录，保持全部相对路径：

```sh
node scripts/offline-resources.mjs stage /tmp/textbook-release
node scripts/offline-resources.mjs http-check https://approved-host.example/release-root/
```

示例域名是占位符。`stage` 仅准备本地目录，拒绝覆盖非空目录，不发布文件。发布输入为该目录中的 `manifest.json`、`manifest.sha256` 及 405 个资源，以及由安装包固定的清单摘要和获准使用的 HTTPS 根 URL。根 URL 必须以 `/` 结尾，不带用户信息、查询参数或片段；不跟随重定向。测试明确传入 `--allow-local-http` 时才允许 loopback HTTP。

安装包须包含整个前端构建产物，排除准备由明确添加教材动作下载的 `textbooks/`。需要包含所有延迟加载的 JS chunk，不能只打包 `index.html` 的直接引用。当前 `math.ts` 使用本地 `mathjax-full` SVG 输出及局部字体缓存；公式所需字形在构建的 JS 中，不需另下在线字体。当前中文正文使用系统字体回退。

```sh
npm run build
node scripts/offline-resources.mjs installer dist /tmp/installer.manifest.json
node scripts/offline-resources.mjs verify-installer dist /tmp/installer.manifest.json
```

`installer` 核对 `installerPublic`，再对提供的成功构建产物固定全部非教材文件的大小和摘要，输出构建专属清单及 `.sha256`。输出必须在构建目录之外。`verify-installer` 核对该摘要、教材清单引用以及清单对当前目录的覆盖，可检查打包过程中丢失的文件。枚举现有文件不能证明构建自身没有遗漏动态依赖；票 03 仍须验证断网后的实际公式加载。集成、重新构建或更换依赖后须重新生成；本次开发构建的文件名不作为稳定协议。

## 票 03 的消费方式与失败语义

可导入 `scripts/offline-resources.mjs` 的标准 Node 函数，无导入副作用：

```js
const manifest = parseManifest(manifestBytes, trustedManifestSha256);
const bytes = await fetchResource(approvedBaseUrl, manifest.download[0]);
// 仅收到并核对完整内容后，才由桌面模块安全落盘。
await verifyDirectory(persistentResourceRoot, manifest.download);
```

`fetchResource` 返回核对后的 `Buffer`，使用 30 秒超时，限制到清单声明的大小；不写文件、不维护进度或完成标记。`verifyBytes` 可校验已有字节；`verifyDirectory` 拒绝缺失、损坏、路径越界及符号链接资源。资源路径不含绝对路径、反斜线、`..`、URL 编码、驱动器、查询符号、Windows 保留设备名或末尾句点。桌面模块仍负责写入边界、临时文件、持久资源位置、原子完成状态、重试及最终安装目录核对；本票的 staging 命令不替代该模块。

错误抛出 `Error`，具有 `code`，涉及单个资源时附 `path`；CLI 写到 stderr 并以非零状态退出：

| `code` | 含义与处理 |
| --- | --- |
| `MANIFEST_HASH_MISMATCH`、`INVALID_MANIFEST`、`INCOMPLETE_MANIFEST` | 清单不可信、版本不支持或必需项不全，停止添加 |
| `INVALID_PATH`、`INVALID_SOURCE` | 路径或下载根 URL 无效，停止该操作 |
| `SOURCE_MISMATCH`、`STALE_MANIFEST` | 开发来源与已审核记录或固定产物不一致，先审查并重新生成 |
| `MISSING_RESOURCE`、`SIZE_MISMATCH`、`HASH_MISMATCH` | 文件缺失、不完整或损坏，不能标记离线可用，可重新下载 |
| `HTTP_ERROR`、`NETWORK_ERROR` | 非 200、重定向、中断、超时或网络失败，不能标记完成，可重试 |
| `INCOMPLETE_INSTALLER` | 安装包缺少入口、JS 或未覆盖全部构建文件，重新准备安装包 |
| `OUTPUT_NOT_EMPTY` | staging 目标已有文件，使用新的空目录 |
| 其他文件系统错误、CLI 的 `IO_ERROR` | 保留原错误，按失败处理，不能显示成功 |

只有全部 `download` 项和安装包资源都核对通过，才具备完整资源依据；这不等于已通过桌面断网重启验收。目录的复制或更新不得覆盖学生的 `custom.json` 与笔记。

## 下载源状态与交付边界

`source.status` 当前固定为 `unpublished`，`baseUrl` 为 `null`。来源记录中的国家平台 PDF URL 仅说明原 PDF 的出处，不是上述 WebP 与目录的发布根 URL；本票未重新验证其当前可下载性。仓库可读、本地 staging 和 loopback HTTP 均不表示教材已获准发布或已有远端下载服务。

自动检查使用实际 TCP/HTTP 服务，传输全部 405 项；另检查错误哈希、缺失、短响应、超长响应、206、重定向、中断和超时。测试服务只在本机运行并随测试删除。真实发布根 URL 及发布授权尚待提供；未执行云端写入或公开发布。票 03 仍需对获准发布源及桌面安装产物进行完整下载、断网重启、公式渲染和持久存储验收。
