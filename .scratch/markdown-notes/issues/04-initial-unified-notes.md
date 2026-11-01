# 04: 导入 AI 初始内容，直接编辑统一笔记

Status: ready-for-agent
Category: enhancement

**What to build:** 明确添加教材时导入其 AI 初始笔记包，教材标记打开可直接编辑的同一篇本地笔记，云端初始版本保持独立。

**Blocked by:** 03：下载当前教材并离线阅读；05：正文三模式与文件头独立切换

## Acceptance criteria

- [x] 实施前固定初始笔记包与当前默认内容的转换、来源 ID/版本映射、重复导入识别方式；复用 05 已固定的 callout 标识与转换规则，原始内容的数学说明及方法折叠意图不丢失。
- [x] 明确添加教材时导入目录和初始 Markdown，保留标题、正文、类型所需信息、anchors 及 AI 来源引用；不在正常阅读、搜索或扫描时静默批量生成文件。
- [x] 同一教材位置的标记打开对应统一笔记；桌面不再呈现只读解读加独立附属笔记，用户修改的是本地同一篇内容。
- [ ] 本地笔记 ID 与 AI 来源 ID 分开（本地已完成）；云端来源 ID/版本的真实不可变记录核验转 [18](18-initial-archive-publication.md)，未部署、未验收，不伪造备份成功。
- [x] 本地编辑、改名与移动不覆盖云端初始版本；未提供恢复、同步或学生笔记云端备份入口。
- [x] 重复导入、失败后重试以及同名文件存在时不覆盖已有用户修改，不产生无法辨认的重复初始笔记。
- [x] 不读取后自动迁移旧云端个人笔记或个人节点，旧系统仍可访问；本地初始笔记下载后可离线读取与编辑。
- [x] 默认知识关联的完整转换由 10 承接；本票保留转换所需来源关系，不用空节点或丢弃原始关系掩盖尚未接入的部分。

## Scope and verification

依据：项目规格 R15（2026-11-01 已确认方案）。实现前阅读当前规格、适用项目约定与技能。实施授权与调度见[任务索引](../spec.md#实施调度2026-11-01)；执行时仅领取依赖已完成的任务。

本票需完成对应完整用户路径及有意义的失败场景验证；后续整体验收不替代本票验证。实施过程中确定的字段、交互边界和验证结果记录在本票，不将静态原型细节自动升级为需求。不得迁移旧个人内容、增加学生笔记云端备份或扩大首版范围。

## Comments

- 2026-11-01：按 DonQ 批准的 12 票拆分创建，尚未开始实现。
- 2026-11-01：文档审查修正：增加 05 为前置，避免导入格式与编辑渲染格式各自确定；尚未开始实现。

- 2026-11-01 协调者前置核对：当前 `scripts/prepare-cloud-content.mjs` 对 `reader_books` 按 book_id upsert，会替换 revision/content；它是当前发布内容，不是不可变历史归档。实施时须核对真实远端来源及固定版本，不能仅拼接本地 ID/摘要就声称云端备份已存在。生产部署若尚不可用，先完成可审查的实现并明确记录剩余发布门槛；不得改动旧个人内容。

### 2026-11-01 实施前协议

- 从 `601aee4f1eec6df0ebea21626fdfddbcc92a876c` 建立隔离树 `markdown-notes-04/课本解读`，分支 `codex/markdown-notes-04`。只实施 04；不修改主工作区、调度表或学生云端内容。
- 固定包由当前已提交默认内容及原定位索引生成；`version` 为规范化完整来源内容和定位的 SHA-256，`source_id` 为原 supplement ID，教材身份独立记录。源快照和 `related` 原样保留，供 10 转换。`_textbook.id` 为本库随机 UUID，与 `ai_source.source_id/version/textbook` 分开。
- 复用 05 的 explanation / hint / warning 协议：paragraphs 为理解，未吸收 knowledgePoints 为相关知识，method 为默认收起 hint，cautions 为 warning；continuous 原序连续展开，不改变数学说明。preview 不重复导入。原 HTML 不执行；当前内容图示由已有独立组件产生，需核对是否有来源内容未进入 Markdown，并明确记录。
- 仅明确添加动作执行导入。先持久化本库导入计划（每个来源的本地 ID 与选定路径），再独占创建 Markdown，最后逐项收据。重试按计划和收据识别；已编辑或移动笔记按稳定 ID 复用，不覆盖、不另造副本；冲突保留原件并提示。教材、目录、来源快照位于持久资料；扫描、阅读和搜索均不生成笔记。
- Reader 继续提供完整教材阅读。桌面标记转到同一笔记编辑器，取消旧只读解读及个人附属输入；保留返回教材的阅读现场。网页版不改变。08 拥有链接解析/反向引用，本票只加最小打开请求接入。
- 真实远端只读核对：`reader_books` revision `79ac7d1bcea53c7ddaa9789ab8b3895dcccc4121d458252d666caed8e626592f`，updated_at `2026-10-29T17:04:18.715342+00:00`，971 条。本地亦 971 条，但规范化内容摘要分别为 `2295073d1bd898c0254b6946c7c9dc33729559a30e73daf8b8b6917efa866d38` 与 `cabbb19b942a43f7c98fb265e94012147468a3d2eeacffc5903599f8aa668625`。不把可变发布记录伪称不可变备份。准备独立只增归档 SQL、固定版本包和精确来源映射；未部署/回读前明确标为 prepared，不声称云端已备份。缺少 Supabase 管理工具/CLI 时不改现有云端，只交付可审查发布产物及门槛。

### 2026-11-01 实现与交接

- 固定包 `resources/initial-notes/grade-7-volume-1.json` 含 971 篇，版本 `13a662b32ffc2e6651cd388998c7638aee926ac7749d85350892aa23b0a4f122`。版本摘要覆盖原始发布内容、所有引用位置、三幅静态图及转换结果；不把远端当前 revision 当作该包的不可变归档身份。
- `scripts/prepare-initial-notes.mjs` 从已提交教材内容与定位生成包及安全 SVG。所有 paragraphs、knowledgePoints、method、cautions 都保留原序和原文；continuous 保持连续展开，其他方法为 `[!hint]-`。没有来源 HTML 条目；三幅已有图示由原组件生成安全 SVG，说明文字与公式进入 Markdown。已视觉核对原 PDF 文件第 88 页／印刷第 81 页、例 4 与图 3.2-2；新增的说明来自既有组件，没有新增教材事实。
- 显式添加动作在下载、目录校验之后导入。Markdown 放 `数学·七年级上册/<章>/<标题>.md`；同名用清楚的数字后缀。持久资料为 `.textbook/textbooks/<教材ID>/initial-notes/{plan.json,source.json,receipts/<本地ID>.json}`。计划固定来源→本地 UUID/路径；source.json 保留完整来源与 related；每篇收据只在独占安装后写入。创建时间与更新时间取同一个 now。
- 已完成收据的文件不会被重写或重建，学生删除也不复活；改名/移动按稳定本地 ID 解析。中断后的未完成文件可按 ID 复用，不覆写其修改。重名、并发占用、格式异常、重复 ID、损坏记录、符号/硬链接与目录联接均保留原件并停在可解释的错误。导入计划丢失但已发现同版本来源笔记时停止创建副本，不静默重新导入。普通读取缺少计划只提示重新添加，不生成文件。
- 桌面沿用完整 Reader。单标记或分组选择打开笔记库中同一编辑器，三模式共用同一 source；切换教材保留 Reader 实例及页码/滚动现场。桌面不展示旧只读解读、附属个人输入或旧只读悬停正文，网页仍沿原行为。旧 03 成员缺少初始计划时，书架在打开失败后给出明确“重新添加教材”动作，不自动导入。
- 供协调者处理共享接入：`DesktopApp` 新增带 vaultToken 的 openRequest 属性，沿既有 protect/run 路径打开；`DesktopWorkspace` 保留两个实例、传打开请求；Reader 新增可选 onOpenLocalNote 与本地分组选择；main/preload 新增 `textbooks:notes`、`textbooks:note`，`add` 返回 initialNotes 摘要。未改 SourceEditor、contracts.ts 或 08 的链接/反向引用实现。`desktop/textbooks.ts` 仅导出并复用原有安全目录和原子文件助手，不改变资源清单及下载协议。

### 验证证据

- 最终 `npm test` 93/93 通过；`npm run lint`、`npm run typecheck`、`npm run desktop:build` 通过。最终全套测试日志 `/tmp/markdown-notes-04-tests-final.log`，lint/typecheck/build 日志分别 `/tmp/markdown-notes-04-{lint,typecheck,build}.log`。新增测试覆盖每一段数学内容、折叠意图、定位、独立身份、相同创建时间、完整 971 篇、外改/改名/移动/删除、重导入、收据前故障、同名、并发占用、重复 ID、目录链接与计划丢失保护。
- `node desktop/check-initial-notes.mjs` 真实 Electron 本机 HTTP 完整路径通过：选库→明确添加→真实文件系统失败→保留已导入后的学生修改→重试全量 971 篇→教材第 88 页标记→同一 Markdown→编辑保存→只读公式与静态图→返回同页→实时预览原位编辑保存→移出/重加不改文件→关闭→停止 HTTP/移除 URL/Electron offline 模拟→重开同篇→继续编辑→760px 预览→教材第 88 页。零 pageerror、渲染器 HTTP(S) 请求为 0；没有改宿主网络设置。只控制选库对话框返回值，非原生 OS 输入验收。
- Electron 证据：`/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-initial-notes-RsAjiR/`，含 result.json、import-failed.png、unified-preview.png、offline-unified-narrow.png、offline-textbook.png；运行日志 `/tmp/markdown-notes-04-electron.log`。该轮在锁屏提示前已启动，并在停止请求前自行完成；检测到锁屏后没有新启窗口验收。
- 性能仅记录实测，不宣称快速：单独全量导入 48,105ms；最终并行全套测试中的全量导入 70,430ms；Electron 含真实 HTTP、故障与重试为 79,308ms，最后一次标记打开 5,846ms，重加 16,775ms。导入过程中保留等待提示。
- ego-browser 独立空 origin `http://127.0.0.1:58204` 的原 `checkBookshelf` 全部通过，含网页添加/取消/阅读/续读/关联返回、损坏记录和失败路径；已结束该测试空间。截图 `/tmp/markdown-notes-04-web/`。教材源页视觉证据 `/tmp/markdown-notes-04-source/page-88.png`。
- 03 的既有 `desktop/check-textbooks.mjs` 仅更新预期以匹配初始笔记目录与统一编辑器入口，完整双库安装产物重跑留 17；本票的真实 Electron 完整路径由上面的专用脚本验证。没有声称做了新的 DMG、Windows 原生或学生学习效果验证。

### 云端发布准备与未执行项（转 18）

- 实际远端与本地只差三篇：`ch3-q-p88-example4`、`ch3-triangle-base-height`、`ch3-area-value-unit`。远端当前发布行仍未改变。匿名 Data API 查询 `reader_initial_versions` 返回 PGRST205（schema cache 中不可用）；目前没有已核验且合法可用的不可变初始记录，不能据此声称底层表结构已完成审查。
- 依据 Supabase / Postgres 技能及当前官方 RLS 文档准备独立只增归档：`scripts/initial-notes-archive-schema.sql` 为未执行草案，复合键 `(textbook,version)`，包身份约束、RLS、公开只读、publisher 仅 insert/select、update/delete 拒绝触发器。未使用 reader_books upsert，也未访问学生个人表。`supabase/tests/reader-initial-versions.sql` 是供 18 执行的整事务回滚检查，当前未运行。
- `package.archive.state`、`_textbook.ai_source.archive`、索引与 add 摘要均明确为 `unpublished`。source_id/version/textbook 是待发布固定包引用，不是已备份凭据。界面来源详情明确说明云端归档尚待核验。没有同步、恢复或学生笔记备份入口。
- 可重现准备：`node --experimental-strip-types scripts/prepare-initial-notes.mjs`。生成 `output/initial-notes/deploy-archive.sql`，不执行网络写入。该文件是可审查部署输入，18 需先按仓库实际数据库流程审查结构/授权与迁移，再以 `psql "$INITIAL_ARCHIVE_DATABASE_URL" --set=ON_ERROR_STOP=1 --file=output/initial-notes/deploy-archive.sql` 或已授权管理工具执行；当前没有管理工具/CLI/数据库连接，未部署。
- 部署后运行 `node --experimental-strip-types scripts/check-initial-archive.mjs`，匿名读取确切 `(textbook,version)` 并比较完整规范化包；只有一致才写 `output/initial-notes/verified-cloud-archive.json`。随后运行上述回滚 SQL、核对 advisors/真实权限，并由 18 管理发布凭据与状态接入。本票没有 verified-cloud-archive.json，不能把本地摘要视作云端备份。
- 云端归档部署与真实核验交 [18](18-initial-archive-publication.md)；Windows 13、生产教材下载源 16、macOS 完整安装集成 17、发布门槛 12 均未代验。这里只提交 04，不改 Status，不修改中央调度表，不自行合入。

- 可重建部署 SQL、真实远端原始响应/比较结果及本轮日志保留在 `/tmp/markdown-notes-04-delivery-lzy7qn8e/`（不入库）。重跑生成脚本仍输出到 `output/initial-notes/`。

### 2026-11-01 审查后性能修复计划

- 协调者指出 971 篇下标记打开实测 5,846ms；继续本票，暂不放行依赖。应用 complexity-optimizer：同一份真实笔记库复制为 `/tmp/markdown-notes-04-performance/vault`，移除原测试中额外的同名占位文件，保留全部 971 篇来源笔记。基线 `InitialNotes.note()` 每次公共 read 971 次，三轮 2,773.09 / 2,751.65 / 2,772.95ms；冷扫描 3,187.55ms、无变化扫描 880.22ms。基线数据与脚本位于 `/tmp/markdown-notes-04-performance/`。
- 最小改动拟增加 Vault `identities(onChange?)` 与 `readById(id,onChange?)`：先复用现有 scan 的文件戳/正文缓存，按 ID 分组，明确拒绝重复；最终只从磁盘核对所选文件的真实 ID。目标在扫描后改名/移走时最多重试一次新扫描，不按陈旧路径任意打开。扫描无变化不重读整库正文；不新增泛化缓存/监听框架。
- `InitialNotes.index/note/import` 复用身份索引；来源计划仍每次从持久文件读取校验。新增 API 的 onChange 与 08 links 的现有回调风格相同，避免一次查询消费外部变化后不通知编辑器。08 的链接索引代码不在本树修改。保存路径先量测；若同样受逐篇读取影响，则保存前继续新扫描，仅用该索引检查重复 ID，不削弱外改/不可读文件保护。

### 性能修复最终实现与回归

- `Vault.identities()` 使用现有 scan 的文件戳与已解析 Note.id，构成 ID→路径组；不再逐篇调用 read/inspect。`readById(id)` 新扫描后拒绝重复 ID，并从磁盘核对最终目标的实际 ID；扫描到读取之间移动/换身份时最多重扫一次。`InitialNotes.note()` 只查本篇计划与该 ID，不再先构建整包 index；index 与重复导入也复用身份索引。
- 保存实测同样有瓶颈，旧 `Vault.write` 重复检查每次调用公共 read 973 次（4,012.11 / 4,119.60 / 4,270.26ms）。现改为保存前新扫描与索引查重，保持原来的磁盘版本、写入前后检查、恢复记录和不可读文件处理；只在原保护检查点读取目标。
- 采用 `watch(refresh,onChange?)` 的单一扫描观察入口：任意 scan 发现变化便立即完整发布，包含 write/copy/import 内部扫描、操作成功或失败。main 的 save/copy/add 不再额外整库扫描并伪装 changed:[目标]。watcher 轮询只负责触发 scan；显式 list 仍发送当前完整快照以初始化重复 ID 提示。已删除本票 identities/readById/InitialNotes 的逐层 onChange 透传。协调者合并 08 时也应移除 main 的 links 旧重复转发，保留一个统一发送源。
- 教材打开请求将已解析 ID 传到 DesktopApp 的最终 read；若 IPC 往返中原路径换成另一身份，拒绝载入，避免把索引选定的笔记与同路径替换文件混同。这是共享 DesktopApp/DesktopWorkspace/DesktopTextbooks 的最小 expectedId 接入，不改变 08 的路径链接契约。
- 最终 96/96 测试、lint、typecheck、desktop:build 通过。新测试覆盖：971 篇热查只读最终一篇；立即外部改名/移动、旧路径替换、新重复 ID、删除、读取间移动/换身份；保存只读目标 3 次、外部新重复 ID 拒写、无效 UTF-8 无关文件不阻塞；保存成功/失败、复制失败、重复导入成功/失败均发布其他文件 B 的变化，且不依赖后续 watcher 扫描。日志 `/tmp/markdown-notes-04-performance/{tests-final,lint-final,build-final}.log`。
- 可重现后端测量脚本 `desktop/check-initial-notes-performance.mjs` 始终复制输入库，不改原库。固定 971 篇同一输入分别运行旧提交 1a2ff64 的已编译快照与最终实现，三轮中位数：查找 2,810.35ms→1,083.37ms，公共 read 971→1；保存 4,454.25ms→2,263.32ms，公共 read 973→3。实际精确汇总以 `/tmp/markdown-notes-04-performance/comparison.json` 为准；前/后原始结果目录分别为 `/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-identity-performance-fTiZ2K/` 与 `/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-identity-performance-HHncd6/`。测试同样实际验证改名、重复 ID 查询/保存拒绝及删除结果。
- 仍保留每次查询的 O(N) 文件名/文件戳检查，以立即发现新增外部重复 ID；未把它藏成无失效规则的长期缓存。O(N) 未变化正文读取/解析已消除。不改首次导入的写入/收据协议，不宣称已优化首导。
- 当前 Mac 再次核对仍锁屏，未启动新的窗口输入。上述为同规模后端/API 耗时，不能替代旧的 5,846ms 标记窗口数据。已准备真实 Electron 前后对比 `desktop/check-initial-notes-runtime-performance.mjs`，同一个克隆库、三次标记打开、三次实际键盘编辑保存、重加和截图。待解锁执行：`INITIAL_NOTES_BEFORE_APP=/tmp/markdown-notes-04-performance/before-app node desktop/check-initial-notes-runtime-performance.mjs /tmp/markdown-notes-04-performance/vault /private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-initial-notes-RsAjiR/app-data`。旧应用编译快照已在 before-app 保留；新构建在本工作树。窗口性能对比及新的 expectedId 客户端路径尚未执行，不据后端数字放行依赖。

- 2026-11-01 协调者最终本地审查：功能 `acda443`、身份索引与统一变化通知 `e08f898` 已合入；与08合并后删去重复通知回调。协调者执行44项受影响桌面测试、lint、typecheck与构建通过，沿用此前98项全套基线。跨票真实Electron检查发现保存正文后、位置记账结束前点击链接被run提前丢弃；`e508c53` 改为等待当前保存收尾并补跨票回归。最终971篇失败重试→教材标记→路径链接→返回来源→正文编辑→重加→断网重启全部通过，零pageerror/外部请求；证据 `/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-initial-notes-GTkg8f`，日志 `/tmp/markdown-notes-integration-initial-links-final.log`。已核对worker实际窗口比较的summary及截图，性能数字为并行负载下一轮样本，不作固定延迟承诺。本地职责通过，放行06与11；18云端归档和其余发布门槛仍未完成。
