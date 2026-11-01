# 03: 下载当前教材并离线阅读

Status: ready-for-agent
Category: enhancement

**What to build:** 用户从桌面书架明确添加当前教材，下载原页、目录及所需资源，完整下载后可离线阅读。

**Blocked by:** 01：桌面打开笔记库并保存第一篇笔记；14：离线教材资源清单与校验准备

## Acceptance criteria

- [x] 添加操作下载确定教材版本，生成或载入教材级目录和核对过的页码映射；不开放个人 PDF 上传，不迁移个人内容。
- [x] 使用 14 固定的资源清单、版本身份、下载来源和完整性校验约定，实施时确定本机持久资源位置并记录决定；不得以开发目录文件可访问替代真实下载路径。
- [x] 仅完整下载并校验通过后显示离线可用；中断、校验失败及资源缺失有提示和重试，不删除笔记或错误宣称完成。
- [x] 完整下载后断网并重启安装产物，当前教材所有页面、目录、缩略图和必要字体可读取；文件页序与印刷页码仍分别核对。
- [x] 离线资源不放入可随意清理的索引缓存；重建或清理索引不删除教材资源。重复下载不覆盖笔记。
- [x] 书架添加、打开、移出与重加沿用保留个人内容及阅读记录的语义；确认过的版本在离线时不需要重新登录才能读取本地原页。
- [x] 为 04 的初始笔记包导入保留明确添加动作与教材版本上下文，本票不因普通阅读或扫描生成笔记。

## Scope and verification

依据：项目规格 R15（2026-11-01 已确认方案）。实现前阅读当前规格、适用项目约定与技能。实施授权与调度见[任务索引](../spec.md#实施调度2026-11-01)；执行时仅领取依赖已完成的任务。

本票需完成对应完整用户路径及有意义的失败场景验证；后续整体验收不替代本票验证。实施过程中确定的字段、交互边界和验证结果记录在本票，不将静态原型细节自动升级为需求。不得迁移旧个人内容、增加学生笔记云端备份或扩大首版范围。

## Comments

- 2026-11-01：按 DonQ 批准的 12 票拆分创建，尚未开始实现。


- 2026-11-01 实施完成，待协调者审查集成。基线 `0140b9ed4e6fe38679910243f5425a07aada39d1`；隔离工作树 `/Users/chengqiyu/.codex/worktrees/markdown-notes-03/课本解读`，分支 `codex/markdown-notes-03-offline-textbook`。未修改主目录、其他票或中央调度表；未自行合并。
- 持久位置确定为 Electron `userData/textbook-resources/<教材版本ID>/`。消费 14 的 405 项固定清单，代码固定清单摘要 `c7b99570b8bc136574b9421c59a01a65f86a9298cc07b075530e68eed1f47b13`。真实 HTTP 下载逐项核对状态、大小与 SHA-256，再同步临时文件并原子提交；失败保留已核对资源供重试。全部资源及安装清单通过后写 `complete.json`；每次启动仍重新核对，不能仅凭完成标记宣告可用。原页读取时再次校验，缺失或损坏会撤销可用状态。
- 用户先选笔记库，再明确添加教材。目录写入该库 `.textbook/textbooks/<教材版本ID>/catalog.json`；相同内容复用，已有不同内容报错并保留。`custom.json`、未知内容与 Markdown 不被改写。`.textbook`、各中间目录拒绝符号链接和目录联接；目录文件拒绝符号链接、硬链接和非普通文件。真实文件系统测试覆盖各层，外部目标保持原字节；普通读取缺失目录不会创建文件。
- 资源字节可在本机各库复用；书架成员、启动目的地及续读位置按库路径摘要命名空间隔离。B 库须再次明确添加才写 B 的目录，不能继承 A 的成员；切库不改原库阅读记录。下载不阻塞笔记队列；最后目录提交与选库共享串行队列，并在提交前后核对当前 token。慢下载时从 A 切到 B，旧操作不能写 A/B 目录或更新 B 的成员。
- 桌面复用原 `Shelf` 与完整 `Reader`，包括连续 202 页、章/节目录、202 张缩略图、页码跳转、搜索、原文定位与知识图。笔记编辑器切到教材时保留实例和草稿。桌面使用本地已随代码提供的只读初始解读，不连接旧云端个人内容，也不生成 Markdown；04 接管初始笔记导入与统一编辑。`textbookResources.add(vaultToken, textbookId)` 是明确添加接口，返回 `textbookId`、库内相对 `catalogPath`、`manifestSha256`；`context` 提供当前 token 和库身份，供后续导入沿同一动作衔接。
- 桌面构建移除 `dist/textbooks/`，打包规则也排除该目录；未以随包原页代替下载。构建专属安装清单覆盖全部 62 项前端资源，包含延迟 JS、字体与公式资源。截图复查发现 Pixi 默认初始化不适合禁止 eval 的桌面 CSP，已在桌面入口加载 Pixi 自带静态 shader/uniform 适配模块；CSP 未放宽，网页不加载该适配模块。安装检查现在要求真实画布及无绘制错误，已核对实际节点和连线截图。
- 检查：`npm run lint`、`npm run desktop:build`（含三组 typecheck）通过；`npm test` 共 64 项通过，最后队列收紧后又运行 3 项教材测试通过。涵盖真实全量 HTTP、短响应、错误哈希、404/503、缺资源修复、缺源/不可信 HTTP、安装资源丢失、个人内容保留、隐藏目录链接边界、双库成员/位置隔离和慢下载切库。`verify-installer` 核对 62 项安装资源通过。
- 安装产物检查：`DESKTOP_EXECUTABLE=/Users/chengqiyu/.codex/worktrees/markdown-notes-03/课本解读/release/mac/课本解读.app/Contents/MacOS/课本解读 node desktop/check-textbooks.mjs` 通过。使用真实 loopback HTTP；首次故意返回 503，失败不写成员或完成标记，重试复用前四项。慢下载切库后分别明确添加两库，各自恢复文件第 88/12 页。随后停止 HTTP 服务、移除来源配置、清理该测试应用的 Chromium 缓存，并以 Electron offline 模拟重启；逐项核对 405 项大小/摘要，解码全部原页和缩略图，加载 6 个字体，检查 202 个原页节点、6 章目录、页面跳转、公式 SVG、搜索定位、实际知识图画布和移出/重加续读。渲染器 HTTP(S) 请求为 0。没有改动宿主网络设置。
- 最终安装证据：`/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-offline-app-lkAntK/`，内有 `result.json`、`downloaded-reader.png`、`offline-formula.png`、`offline-graph.png`。原桌面笔记 `npm run desktop:check` 通过，证据 `/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-desktop-check-yaRN19/`。ego-browser 独立空 origin `http://localhost:5194` 执行原 `checkBookshelf` 通过，包括添加、阅读、关联返回、状态损坏及失败路径；证据 `/tmp/markdown-notes-03-web/`。
- 上述勾选表示本票的本地实现及 macOS 打包运行证据。生产来源仍为 `unpublished`；仅支持发行方提供获准 HTTPS 根 URL 的主进程配置 `TEXTBOOK_DOWNLOAD_BASE_URL`，默认缺源时明确失败。DonQ 已确认先完成本地实现、来源另票保留，由协调者的 16 票承接，不表示教材已公开发布。Windows 实机归 13；DMG 原生安装、系统对话框及 macOS 原生操作归 15；04 初始 Markdown 导入不在本票验收中。

- 2026-11-01 协调者最终审查：以 `05ee1d9` 集成，核对下载校验、库内目录链接边界、按库状态及慢下载 token 保护；查看真实离线图谱截图和运行结果。集成工作树独立执行 64 项测试、lint、typecheck 全部通过。允许依赖票继续实施；生产来源 16 与 Windows 13 仍未验收。
