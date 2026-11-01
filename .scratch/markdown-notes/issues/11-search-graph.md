# 11: 搜索与知识图统一指向本地笔记

Status: ready-for-agent
Category: enhancement

**What to build:** 笔记列表、搜索和知识图使用同一份本地笔记数据，用户可从任一入口打开并继续编辑。

**Blocked by:** 04：导入 AI 初始内容，直接编辑统一笔记；08：路径链接、重名选择与反向引用

## Acceptance criteria

- [x] 一篇 Markdown 对应一个节点，多 anchors 或跨教材归属不重复制造节点；缺少 ID 的手动文件可展示，不因投影写入 ID。
- [x] 搜索覆盖笔记名称、可搜索正文和顶层 tags 标签；标签修改后更新检索结果，不增加聚类功能。笔记列表、搜索结果、教材相关入口和图谱打开相同本地内容。
- [x] 图谱边与反向引用基于解析后的笔记链接；只有教材位置的关联不生成空节点。
- [x] 保存、外部新增或修改、删除后更新搜索与图谱；未保存草稿不伪装为已持久化内容，旧异步结果不复活被删除节点。
- [x] 重名候选展示教材上下文或摘要，缺失和歧义引用不形成错误连线；重复 ID 有可辨错误状态。
- [x] 选择、关闭、切换视图和返回沿用草稿保护并保留图视野，不因索引变化无故重置阅读位置。
- [x] 清理内存索引并重建可恢复相同内容投影；仅扫描不修改 Markdown。默认原文关系转换完成后由 12 联合验收。

## Scope and verification

依据：项目规格 R15（2026-11-01 已确认方案）。实现前阅读当前规格、适用项目约定与技能。实施授权与调度见[任务索引](../spec.md#实施调度2026-11-01)；执行时仅领取依赖已完成的任务。

本票需完成对应完整用户路径及有意义的失败场景验证；后续整体验收不替代本票验证。实施过程中确定的字段、交互边界和验证结果记录在本票，不将静态原型细节自动升级为需求。不得迁移旧个人内容、增加学生笔记云端备份或扩大首版范围。

## Comments

- 2026-11-01：按 DonQ 批准的 12 票拆分创建，尚未开始实现。
- 2026-11-01：文档审查修正：补齐 R15 已要求的 tags 标签检索；尚未开始实现。

- 2026-11-01，实施前协议：从已审查基线 `27807ab8e5afaee66e5508cf44d8ae2aee08a08f` 建立独立 `codex/markdown-notes-11` 工作树。笔记投影复用 08 的 `LinkIndex` 与按内容 revision 缓存的 `LinkEntry`，增加从已保存正文、顶层 `tags` 和实际路径提取的检索字段；不读取旧网页静态正文，不写回 Markdown。搜索按空白拆词，各词均需命中，忽略大小写并做 Unicode NFC 规范化；顶层 tags 接受字符串或字符串列表，不把保留对象及其他属性当标签。
- 图谱以实际库内路径作节点键；无 ID 与重复 ID 文件均保留各自节点，重复 ID 明确提示。边只来自 08 已解析为唯一目标的正文或用户属性链接，重复来源目标合并；缺失、歧义、越界链接与 anchors 不造节点。搜索候选展示完整路径、已有教材上下文和正文摘要。
- 入口协议：搜索及图节点复用 08 的 `navigate` / `protectDraft` / history / editor scene；打开目标前读取成功，保留来源草稿，返回恢复编辑现场。图开合保持挂载；改变选中、关闭编辑与切换视图经过草稿保护，取消保持现场。磁盘通知立即使未完成的旧索引请求失效；草稿只留编辑器，不进入搜索和图。真实 971 篇规模记录首次载入、单篇更新与删除成本，首版不增加数据库或聚类；网页图谱保持现有实现。

- 2026-11-01，实施说明：`LinkEntry` 增加 `id`、顶层 `tags` 和规范化 `searchText`，仍由 `Vault.index` 按文件 revision 复用；搜索不解析未保存草稿，也不查旧静态正文。`projectNotes` 以真实路径作键，主标签仅显示文件名，搜索候选与图设置保留路径和教材上下文。图的唯一有向边与反向引用共用链接解析规则，来源和目标重复引用合并；anchors 不造边。新增批量 `linkResolver` 避免每条引用再次扫描全库，仍保留 NFC 碰撞、大小写、扩展名、越库及歧义规则。
- 桌面入口统一：教材 Reader 在 `onOpenLocalNote` 场景不挂载旧静态 `ContentSearch` 与图谱按钮；教材视图的工作区顶部提供“搜索笔记／知识图”，由 `DesktopWorkspace.browseRequest` 打开本地投影。网页没有此回调，保留原入口。共享接入仅涉及 Reader 的查阅组条件、Workspace 的 `active` / `browseRequest`、DesktopApp 的导航接入，以及 Candidate 导出；06 的 anchors / `localTools` 和 09 的文件名展示改动由协调者合并，不在此替代。
- 草稿与视野：投影导航复用 08 的 `navigate`、`protectDraft`、history 和 editor scene；视图切换保留编辑器与图实例，图隐藏时停止布局与绘制。图空白关闭经现有草稿保护，取消不改变现场；关闭目标后空态仍有“返回来源”。教材重开当前笔记也会收起图。通用 Pixi hook 只增加默认开启的 `focusSelection` 参数，桌面传 false 保留视野，显式定位仍可用，网页默认行为保持。
- 异步边界：收到磁盘通知即使正在保存或忙碌，也立即使旧请求失效，并从当前投影移除已删除路径。实际 Electron 故障注入将一次已完成的旧 IPC 结果延迟到文件删除之后释放，核对搜索与真实 Pixi 节点均未复活。
- 检查：全量 `npm test` 104/104 通过；批量解析优化后受影响的链接与投影检查 7/7 再次通过。最终 lint、typecheck（包含在 desktop:build）及桌面构建通过。未加依赖、数据库、聚类、云端学生内容写入或迁移。日志：`/tmp/markdown-notes-11-tests.log`、`/tmp/markdown-notes-11-projection-tests.log`、`/tmp/markdown-notes-11-lint.log`、`/tmp/markdown-notes-11-build.log`。
- 08 真实 Electron 9 组回归通过，验证共享导航、反向引用、同名修复、草稿、外部冲突、缺失创建和离线重建。日志 `/tmp/markdown-notes-11-links-electron.log`，证据 `/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-links-check-vRPoGc`。
- 971 篇规模基准：使用真实初始包通过现有导入器生成的隔离库（1,377,053 bytes Markdown），每篇增加一条受控链接。`node --experimental-strip-types desktop/benchmark-search-graph.mjs` 可重跑。首次内存索引扫描 7052.1 ms / 解析 971 篇；无变化 1910.1 ms / 0 篇；单篇外改 1812.9 ms / 1 篇；删除 1753.0 ms / 0 篇，移除 1 篇。清空 Vault 内存并重建 6464.5 ms，内容投影一致且不写 Markdown。耗时包含安全文件扫描；未清操作系统缓存，同机有其他验证负载，不作为性能承诺。
- 图投影优化前约 946–1165 ms，批量解析后分别为首次 22.6 ms、无变化 19.0 ms、单篇外改 23.8 ms、删除 16.0 ms；搜索 0.7–1.4 ms。缓存和单条更新数由 LinkEntry 对象复用核对。日志 `/tmp/markdown-notes-11-benchmark.log`、`/tmp/markdown-notes-11-benchmark-after.log`；最终 JSON `/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-search-graph-benchmark-YzmnxM/result.json`。
- 验证边界：首次 HTTP 导入尝试在 120 秒检查时限内未完成，画面仍为“正在准备初始笔记”，没有据此声称通过或判定为锁屏。按协调者指示，后续规模 UI 检查复制已验证 QA 夹具 `/tmp/markdown-notes-04-performance/vault`（复制前及复制后核对 971 篇）和 `/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-initial-notes-RsAjiR/app-data/textbook-resources` 到新的临时目录；原夹具保持不变，不将复用资源称为新首次下载成功。Windows 实机归 13，生产下载源归 16，默认关系转换归 10，跨票完整联合验收归 17/12，云端初始归档归 18。

- 2026-11-01，11 专项真实 Electron 最终通过（6 组完整路径）。实际键盘输入、保存和文件读取验证正文与 tags 检索变化；同名候选显示教材位置和摘要；实际 Pixi 画布点击打开与返回，比较 world 的平移/缩放值保持一致；无效 YAML 草稿不进入投影，图空白关闭可取消，关闭目标后从空态返回来源恢复草稿、光标和撤销；外增/外改/删除、延迟旧 IPC、缺 ID 与重复 ID 均覆盖。971 篇副本中，从教材阅读页的统一搜索/图入口、教材标记和真实节点点击打开同一篇已编辑笔记；明确断言桌面旧静态查阅组未挂载。断网关闭并重开进程后重建 971 个实际 Pixi 节点，760px 窗口用斜线、向下键、Enter 搜索打开，搜索面板不越界，无渲染错误或外部 HTTP 请求。
- 最终证据目录：`/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-search-graph-check-eDqJb7`，`result.json` 记录复用夹具和计时；日志 `/tmp/markdown-notes-11-electron-final.log`。已视觉核对 `same-name-search.png`、`manual-duplicate-graph.png`、`971-content-graph.png`、`narrow-offline-search.png`、`narrow-offline-editor.png`。971 篇 UI 单次样本：已有资源重新添加 8929 ms、一次保存及位置记账 7561 ms、教材入口打开检索并显示结果 810 ms、教材入口打开并绘制图 1557 ms；与纯投影基准分开记录，不作为冷盘或响应时间保证。
- 精确重跑：`npm run desktop:build` 后，执行 `node desktop/check-search-graph.mjs <已验证971篇QA库> <对应app-data>`。脚本仅复制输入，不修改来源；原生选库受控，未重复 15 的原生窗口验证。早期脚本修正包括全文搜索包含来源中的链接文字（命中 3 篇）、按真实包标题识别画布标签，以及重启后使用新页面的定位器；最终结果不使用这些失败运行的截图作为通过证据。新增边界经独立只读审查，发现的同目标教材往返与空态返回入口已修复并加入真实回归。
- 本票职责已实现并验证，勾选不表示默认关联转换、跨票集成或双平台发布已通过；上述联合门槛继续保留，待协调者最终审查与合并。没有改动中央调度表、其他票或用户主工作区。

- 2026-11-01，协调者最终审查与集成：`e00b4f6` 合入 09 后保留文件名主标题、完整路径上下文和移动维护，保留保存记账结束后执行导航的修复。集成 56 项桌面测试、全量 lint/typecheck/桌面构建、真实 Electron 专项 6 组通过；包括 971 篇真实库副本、统一教材入口、实际画布节点点击及离线重启。证据 `/private/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-search-graph-check-jXhgVJ`；日志 `/tmp/markdown-notes-integration-11-{tests,lint,build,electron}.log`。06、10 后续接入仍由 17 做跨票联合复核。
