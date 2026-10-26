# 课本解读

初中数学教材解读项目。当前可上下连续阅读人教版七年级上册全部 202 个 PDF 页面。左侧导航可收起，支持缩略图、页码输入和上下页跳转。六章均已接入按教材位置展开的补充解读与关联回顾。

## 目录导航

| 位置 | 用途 |
| --- | --- |
| `src/` | 阅读器源码及单元测试。 |
| `content/` | 六章补充正文与教材位置，作为内容发布源。 |
| `public/textbooks/` | 网页运行所需页图、缩略图及来源记录。 |
| `materials/` | 教材 PDF、来源记录、内容索引；本地 PNG 与提取文本用于核对和重新生成。 |
| `scripts/` | 资源准备、内容发布检查及浏览器回归入口。 |
| `supabase/` | 数据库迁移及权限、数据行为检查。 |
| `docs/` | 需求、背景、架构、ADR、内容审核记录和项目工作约定。 |
| [外部参考](docs/references/Obsidian-Graph-View-逆向报告/Obsidian-Graph-View-逆向报告.md) | `docs/references/` 保存研究报告及其证据包。 |
| [历史归档](docs/archive/README.md) | `docs/archive/` 保存过期设计快照和历史评审。 |
| `.scratch/` | 任务、交接及验收证据，纳入 Git；包含尚未完成的人工验证。 |
| `.agents/skills/` | 随仓库维护的项目技能。 |
| `.impeccable/surfaces/` | 设计工具使用的页面入口。 |

根目录保留运行配置、README、AGENTS，以及工具约定的 `PRODUCT.md`、`DESIGN.md` 和领域约定的 `GLOSSARY.md`。`node_modules/`、`dist/`、`supabase/.temp/` 是本地依赖、构建输出或工具缓存，已由 Git 忽略。

任务入口：[教材预习与复习](.scratch/textbook-preview-review/README.md)、[补充节点图交接](.scratch/supplement-graph/dispatch-plan.md)。

## 本地开发

使用 Node.js 22.12+（22.x）或 24+，以及 npm。

```sh
npm ci
npm run dev
```

```sh
npm run typecheck # 类型检查
npm test          # 页目录、滚动定位与内容引用检查
npm run build     # 类型检查并构建到 dist/
npm run preview   # 预览构建结果
```

当前使用 Vite、React 和 TypeScript。

仓库包含七年级上册 PDF，以及全部 202 页的 WebP、缩略图和来源记录。另一台电脑克隆或拉取后，直接执行上述命令即可；日常运行不需要 Python、`cwebp` 或 `prepare:textbook`。浏览器打开终端显示的本地地址（默认端口 5173，已占用时会使用其他端口）。

仅在重新生成页图时运行 `npm run prepare:textbook`。该命令需要 `cwebp`，以及本地 `materials/indexes/人教版-数学-七年级上册/images/` 中已核对的 PNG 页图（不纳入 Git）；它校验 PDF 与全部 PNG 的哈希，再生成 WebP、缩略图、来源记录及 `src/textbook/book.json`。来源见 [项目背景](docs/CONTEXT.md)。换教材时须重新核对内容与定位，不能仅替换文件名。

## 当前阅读与内容

首次打开从封面开始，有有效记录时恢复上次原页阅读位置。全部页面按 PDF 文件顺序连续排列；居中的页码控件可原位输入，关联目标另显示已核对的教材页码。布局与组件说明见 [DESIGN.md](DESIGN.md)，行为要求见 [SPEC.md](docs/SPEC.md)。

六章共接入 970 条补充和 1087 个经原图核对的位置，覆盖 PDF 第 8–199 页的逐页取舍记录。入口对应段落、关键语句、例题步骤或题目；117 个位置仅作为关联回顾目标。数量描述当前交付，不是各章的固定配额。

| 章节 | 逐题清单 | 补充条数 | 定位数 |
| --- | ---: | ---: | ---: |
| 第一章 有理数 | 90 | 128 | 145 |
| 第二章 有理数的运算 | 175 | 247 | 281 |
| 第三章 代数式 | 70 | 110 | 127 |
| 第四章 整式的加减 | 75 | 109 | 120 |
| 第五章 一元一次方程 | 126 | 187 | 198 |
| 第六章 几何图形初步 | 130 | 189 | 216 |

共 666 项逐题清单，覆盖例题、练习、习题、复习题和明确作答的思考、探究、活动。每题涵盖所需知识、方法思路、注意条件及相关知识入口，按理解过程组织为连续说明或分节内容；同题小问逐一涵盖，跨页的同一分项只计一次；独立情境、活动图及旁注按实际入口分项记录。一般概念及步骤解读继续保留，标题不重复标注当前位置页码。

类型标记指向原页区域，密集入口合并后按题号选择；必要解释直接可读，可选方法由读者主动展开。解读提供定位、关联查阅与返回。默认补充的个人笔记实时保存，自选段落的个人补充另有显式保存流程；两者均支持 Markdown。定位、返回及续读的状态区别见 [架构说明](docs/ARCHITECTURE.md#阅读状态与跳转)。

工具栏用图标打开节点图，用“+”框选添加补充。个人内容可从图谱搜索进入，其详情的“全部补充”提供列表与新建入口；章、节可调整或未归属，保存、改名与删除后可刷新读取。

笔记和个人正文输入 `[[` 可搜索补充，候选显示章、节及位置或摘要。选择后绑定具体条目，同名链接可以指向不同目标；没有匹配时可主动创建，取消不留空条目。预览中的链接打开对应内容，目标删除后显示失效。改写链接文字或粘贴纯文本后需重新选择目标。

默认解读从 Supabase 读取；静态 JSON 保留为发布源，并检查来源身份、位置和关联引用。六章分别维护 `chapter-N.json` 和定位文件，由 `src/textbook/chapters.ts` 统一注册；第一章定位沿用 `locations.json`，其余章节使用 `chapter-N.locations.json`。各章逐题覆盖均已完成原图核对。通用内容编译器尚未实现；补充内容的学习效果尚无学生使用证据。

## Supabase 与个人内容

工具栏“节点图”可查看当前教材的全部默认解读和已保存个人节点，支持搜索、平移、缩放和拖动。选择节点只切换解读，点击“定位”并加载成功后，桌面同时显示图与教材，窄屏切到教材。分隔条可拖动或用方向键、Home、End 调整；视图控件可关闭或重开教材和图，保留会话中的位置与草稿。默认关联保留查看理由；目标只有教材原文时继续跳转原文。保存后的引用以玫红色无箭头弧线显示，默认关联保留箭头。目标详情的“引用此处”可返回实际引用者；重复引用和双方互引共用一条个人连线，删除最后一处才撤销。

默认解读无需登录。点击工具栏“登录”，用邮箱接收登录链接；登录后，笔记和个人补充保存到该账号，在其他设备登录同一邮箱可读取。MCP 登录仅供开发工具使用，不会代替读者登录。当前项目地址和公开客户端密钥在 `src/reader/supabase.ts`；可用 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 覆盖，浏览器不得使用 service-role 密钥。

本地开发模式另有“测试账号登录”：打开“登录”浮层后切换，输入专用测试账号的邮箱与密码。它使用同一 Supabase Auth 和个人数据权限，不依赖邮件发送；生产构建不显示该入口。测试账号由管理员单独提供，凭据不纳入 Git。02 本轮按 DonQ 的后续决定使用此入口验收，SMTP 与真实邮件送达留待正式开放前配置。

首次登录会把本浏览器的旧个人内容导入该账号，并绑定旧内容的来源。原 localStorage 内容保留；后续换账号不会再次导入给另一人。仍打开的旧版页面继续保存时，新版会保留原始副本并提示，在“查看升级前副本”中比较、复制；旧副本不会覆盖云端较新的记录。保存失败或其他页面已更新时，编辑器保留草稿，待复制或处理后再刷新。续读位置仍保存在本浏览器。

数据库结构及权限见 `supabase/migrations/`；真实数据库回滚检查见 `supabase/tests/reader-content.sql`。发布默认内容时，先应用迁移，再生成 SQL 并通过管理员连接执行：

```sh
node --experimental-strip-types scripts/prepare-cloud-content.mjs /tmp/reader-publish.sql
node --experimental-strip-types scripts/check-cloud-content.mjs
```

发布按内容哈希更新同一教材，不改个人记录。上线地址须加入 Supabase Auth 的回跳白名单，并核对邮件发送配置；本地已配置的回跳地址不自动适用于新域名。

当前项目尚未启用自定义 SMTP。[Supabase 默认发信服务](https://supabase.com/docs/guides/auth/auth-smtp)仅向项目成员发送邮件；向普通读者开放邮箱登录前，须配置发信服务并实测送达与回跳。自动回归拦截邮件请求，不代表已完成邮件送达验收。

## 浏览器回归

以下脚本导出检查函数，供已打开本地阅读器的 ego-browser Page 调用。直接用 `node` 执行脚本只会加载模块，不会运行这些检查。使用 ego-browser skill 建立自己的页面，再以绝对 `file:` URL 导入所需模块，传入该页面；参数和前置状态以函数定义为准。

| 修改范围 | 现有入口 |
| --- | --- |
| 完整题目及跨页原文框 | [check-complete-location.mjs](scripts/check-complete-location.mjs)：`checkCompleteLocation(page)` 检查两行题干、跨页续题及关闭后的清除；教材可见且内容已载入 |
| 目录选择与面板调宽 | [check-directory-selection.mjs](scripts/check-directory-selection.mjs)：`checkDirectorySelection(page)` 使用图谱 QA 启动服务；[check-panel-width.mjs](scripts/check-panel-width.mjs)：`checkPanelWidth(page)` 验证右栏调宽及图标 |
| 教材目录与节点目录 | [check-navigation-directories.mjs](scripts/check-navigation-directories.mjs)：`checkNavigationDirectories(page)`，图谱打开且教材隐藏 |
| 图节点自动定位原文 | [check-graph-auto-locate.mjs](scripts/check-graph-auto-locate.mjs)：`checkGraphAutoLocate(page)`，开发环境、图谱打开且教材隐藏 |
| 页码位置、原位输入、侧栏开合 | [check-page-navigation.mjs](scripts/check-page-navigation.mjs)：`checkBookPageControls(page)`、`checkPageNavigation(page, expanded)` |
| 页底预览与入口点击 | [check-related-return.mjs](scripts/check-related-return.mjs)：`checkPreviewEntry(page, 文件页序, 条目ID)`，可传各章真实标记 |
| 单条与分组入口、关联返回 | [check-related-return.mjs](scripts/check-related-return.mjs)：`checkReviewCase(page, index)`、`checkAccordion(page, id)`；`reviewCases` 是第一章关联清单，不代表全书全集 |
| 多层返回、退出、失败和取消 | 同模块的 `checkReviewChain`、`checkReviewExit`、`checkReviewFailures`、`checkRelatedReturn` |
| 方法开合、续读与完整路径 | 同模块的 `checkOnDemandMethod`、`checkMethodReturnChain`、`checkReaderJourney` |
| 滚走后定位并保留上下文 | 同模块的 `checkLocate`、`checkLocateGroup`、`checkLocateReturn` |
| 图谱折叠控件、右下角搜索与教材展开 | [check-graph-controls.mjs](scripts/check-graph-controls.mjs)：`checkGraphControls(page, { narrow })`，检查视口边界、键盘搜索、设置折叠与桌面分屏／窄屏切换 |
| 图搜索、键盘选择及连续拖动截图 | [check-supplement-graph.mjs](scripts/check-supplement-graph.mjs)：`graphState`、`searchGraph`、`checkGraphSelection`、`captureGraphDrag`；先从工具栏打开节点图。`startGraphProbe`／`graphEmphasis`／`stopGraphProbe` 仅在专属测试浏览器检查 Pixi 明暗层级；`checkRepeatedGraphOriginal` 检查重复原文定位、失败重试和返回层级 |
| 图与教材分屏、恢复与原文重试 | [check-split-reading.mjs](scripts/check-split-reading.mjs)：`splitReadingState`、`checkSplitKeyboardResize`、`checkReadingViewRecovery`；先完成一次图中定位。`checkSplitOriginalRetry` 检查重复原文、失败重试和两层返回；在独立测试 origin 使用已安装的图探针核对视野，分屏实现使用该入口替代旧的 `checkRepeatedGraphOriginal` |
| 云端笔记与个人补充的异步保存 | [check-async-save.mjs](scripts/check-async-save.mjs)：`startAsyncSaveServer(port)`、`assertUnusedAsyncOrigin(page, { testOrigin })`，再运行 `checkAsyncNoteSave`、`checkAsyncPersonalSave` |
| 逐实例笔记链接与原子保存 | [check-stable-note-links.mjs](scripts/check-stable-note-links.mjs)：`startStableLinksServer`、`startStableLinksCheck`，以及真实编辑历史、创建和保存检查；需新的合成账号与独立 origin，前置状态见函数定义 |
| 反向引用、个人连线与保存投影 | [check-bidirectional-links.mjs](scripts/check-bidirectional-links.mjs)：`startBidirectionalLinksServer`、`startBidirectionalLinksCheck`、`savedReferenceState`、`referenceView`、`checkIncomingNavigation`；使用新的 06 合成账号与独立 origin，比较保存快照、反向列表和图中两类边 |
| 首次导入、真实旧版页面后到保存与重开 | [check-content-migration.mjs](scripts/check-content-migration.mjs)：`startContentMigrationServer`、`checkContentMigration(task, { testOrigin, credentials })`；须提供修改存储前冻结的实际旧版构建 |
| 云端修订冲突、网络失败与浏览器存储故障 | [check-content-migration-extra.mjs](scripts/check-content-migration-extra.mjs)：`checkContentMigrationExtras(task, result)`，使用上项返回的 QA 结果 |
| 账号隔离、旧账号延迟响应与失效登录链接 | [check-content-auth.mjs](scripts/check-content-auth.mjs)：`startContentAuthServer`、`checkContentAuth`、`checkExpiredEmailCallback`；另用独立空 origin，失效链接检查拦截发送请求，不发邮件 |
| 开发模式测试密码登录 | [check-test-login.mjs](scripts/check-test-login.mjs)：`checkTestPasswordLogin(page, { testOrigin, credentials })`，专用账号验证错误密码重试、保存、刷新、退出与重新登录；`checkProductionPasswordLoginHidden(page)` 核对生产构建隐藏测试入口；不发邮件 |

`check-related-return.mjs` 的题目、关联样本和位置查找绑定第一章；依赖这些数据的检查不能直接传入其他章 ID。其他章节须使用该章真实入口与位置，沿相同阅读路径单独核验，不以第一章用例代替。`checkPreviewEntry` 只使用传入的文件页序与标记 ID，可跨章检查。

按实际改动选取入口，核对原文位置、展开项、方法状态、面板滚动、焦点和返回层级；动作预期见架构说明。复用公共交互检查不代表已经点击全书每条链接。

涉及个人内容或阅读记录写入的检查，使用独立测试 origin 和自己的浏览器页面，不接管用户验收页。要求 `{ testOrigin }` 的函数须显式传入；先检查各函数的存储及草稿前置条件，结束后恢复原始状态。多个检查不要并发修改同一页面或存储。

云端检查还须使用可清理的专用 QA 账号。`check-related-return.mjs` 中直接读写旧 localStorage 的笔记、草稿和跨标签检查只适用于冻结的旧版；新版存储行为使用上表的云端入口。测试脚本不得打印账号凭据或清空浏览器全局存储。

## 验证记录

命令从 `package.json` 读取，按改动运行受影响检查；通过后仅因新改动、失败或未决疑点追加。当前没有仓库 CI 或启用的 Git hook，本轮不新增；浏览器路径按任务调用现有函数。

交付记录保留检查对象、文件版本或哈希、结果与未验证范围。共享源码在检查期间变化时，标明受影响证据并复核相关路径；工具超时与可复现的产品失败分别记录。

| 证据 | 能说明什么 |
| --- | --- |
| 自动结构、类型和构建检查 | 覆盖引用、记录校验及构建等被检查的性质；不证明数学或解释质量 |
| 原页与内容语义审核 | 来源、数学条件、解释增量及原文区域的对应判断 |
| 浏览器操作、DOM 与像素检查 | 分别记录实际点击往返、界面状态和可见布局；按钮或目标存在不等于已操作通过，DOM 通过不等于截图已核验 |
| 真机与真人观察 | 分别记录设备阅读表现及学生实际理解；窄屏仿真、角色模拟不能替代 |

任务规定的抽查与未覆盖范围须明确列出，不把少量成功路径外推为全书验证。学习效果的判定仍按 SPEC 与 CONTEXT，不将内容审核结论当作学生使用证据。

## TypeScript 配置

[tsconfig.json](tsconfig.json) 按 Matt Pocock 的
[The TSConfig Cheat Sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet)
配置基础选项与严格检查，使用适合打包工具的 `module: Preserve`、`noEmit`，
并启用浏览器 DOM 类型和 React JSX。

核心严格选项：`strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`。
基础配置直接保存在项目中。

## 项目依据

- [需求规格](docs/SPEC.md)
- [项目背景](docs/CONTEXT.md)
- [系统架构设计](docs/ARCHITECTURE.md)（含当前实现范围）
- [领域术语](GLOSSARY.md)
