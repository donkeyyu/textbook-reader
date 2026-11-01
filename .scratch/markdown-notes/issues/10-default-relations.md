# 10: 将默认知识关联接入统一笔记

Status: ready-for-agent
Category: enhancement

**What to build:** 从初始笔记中的知识关联查阅其他笔记或教材原文，并返回原阅读任务，保留关系说明与查看目的。

**Blocked by:** 04：导入 AI 初始内容，直接编辑统一笔记；06：顶部笔记位置与教材框选往返；08：路径链接、重名选择与反向引用

## Acceptance criteria

- [ ] 转换模块实施前确定仅原文目标的持久表示，与笔记路径链接区分，不改变已确认 anchors 格式或伪造目标笔记。
- [ ] 两端有笔记的默认关联转换成可解析的正文链接，保留关系说明、阅读目的和原有必要方法提示。
- [ ] 只有原文位置的目标可跳转到正确教材版本、文件页序和框选区域，不生成空笔记或图谱节点。
- [ ] 链接两端标题重复、目标跨页及多区域时仍对应真实目标；未核实页码不展示为精确跳转。
- [ ] 从笔记进入目标再返回，恢复来源阅读位置与编辑草稿；目标失效或未下载时提示并保持来源上下文。
- [ ] 转换后对当前教材的关联覆盖与丢失项进行核对，不能用少量样例通过冒充全部默认关系已迁移。
- [ ] 重复导入不覆盖学生已有正文和链接；AI 初始版本留存不被学生本地编辑改变。

## Scope and verification

依据：项目规格 R15（2026-11-01 已确认方案）。实现前阅读当前规格、适用项目约定与技能。实施授权与调度见[任务索引](../spec.md#实施调度2026-11-01)；执行时仅领取依赖已完成的任务。

本票需完成对应完整用户路径及有意义的失败场景验证；后续整体验收不替代本票验证。实施过程中确定的字段、交互边界和验证结果记录在本票，不将静态原型细节自动升级为需求。不得迁移旧个人内容、增加学生笔记云端备份或扩大首版范围。

## Comments

- 2026-11-01：按 DonQ 批准的 12 票拆分创建，尚未开始实现。

### 2026-11-01 · 实施协议（转换前固定）

- 原文目标使用普通 Markdown 链接 `[显示名称](textbook:<encodeURIComponent(JSON.stringify(anchors))>)`；payload 是现有 anchors 对象列表，跨页分条、同页多框保留，不加笔记 ID。此链接不进入 wiki 路径索引，不生成笔记或图节点。跳转逐条经 `resolveAnchor` 校验当前目录版本、文件页序和区域，缺失或未核实则保留来源并提示。
- 有笔记的目标按包内 `source.content.supplements[].locationId → id → plan.notes.sourceId` 对应；正文链接用持久 plan 实际分配的路径（含同名后缀）及关系 label，purpose 紧邻入口。仅无对应笔记的教材位置才生成原文链接；目标笔记缺失、身份重复或已删除时写明缺失，不猜标题，不回退为伪造笔记。
- 包内容及版本不变：使用 04 已保存的原始 related/location 数据，在首次真正创建 Markdown 文件时追加关联。已存在 receipt 或尚未写 receipt 但已存在对应 ID 的文件均不补写、不覆盖正文。旧 plan、source 和 receipt 可直接打开/重试；以前创建但无关联的学生文件保留原状。未发布包仍为 unpublished，归档发布留 18。
- 中断重试时先读所有 receipt 和当前 ID→路径；已创建目标使用核对后的当前路径，已完成但删除的目标标为缺失。未创建目标采用首次 plan 路径并检查是否被占用；不把旧路径上的其他身份当成目标。首次导入同批目标使用计划分配路径，允许前向链接。
- 原文查阅复用现有 onLocate 分屏，单独标记定位来源，避免本笔记 anchors 失效清理误删关联目标；返回还原查阅前布局与高亮，编辑器保持挂载。笔记间往返复用 08 来源栈、草稿保护和阅读位置。

- 协调者早期审查后补充：原文返回不能用旧 locate 代替教材实际阅读位置。Reader 仅为本地工作区提供当前文件页及页内滚动比例的 capture 引用，返回沿现有异步图像解码跳转恢复该位置；旧高亮独立恢复。网页无 localTools 时行为不变。

### 2026-11-01 · 接续协议

- 接续会话仅在 `codex/markdown-notes-10-resume` 独立工作树上操作，基线 `e7339f4aa23458c0c9b77bc1a2af143e98b097b1`。冻结 tracked patch 与四个新增文件已按交接 manifest SHA-256 核对；主工作区与旧工作树不修改，中央调度表由协调者维护。
- 复用已通过且冻结源码未改变的全量与 HTTP 证据；本次针对尚未验收的长文返回与源链接失效路径增加隔离 Electron 回归。来源正文滚动在展开前捕获，返回布局完成后恢复；继续保留原文链接来源、草稿、教材实际页内位置的既有语义。
- 新回归脚本 `desktop/check-relation-context.mjs` 接收 `RELATIONS_FIXTURE`（`check-default-relations.mjs` 的证据目录），复制教材级资料及下载缓存到独立临时目录，只创建本次长文夹具，断网从真实 UI 走通查阅与返回。已有笔记全量覆盖由原 14 组 HTTP 回归及单元检查负责，此脚本不重复声称全量导入验收。

### 2026-11-01 · 实现与验收证据

- 固定包 971 篇初始笔记、1241 条默认关系全部逐项核对：410 条精确计划路径链接、831 条仅原文链接，0 丢失；图投影为 971 节点、410 边。原有必要正文、方法提示、未知字段及三个安全 SVG 保留。首次导入追加关系；已有收据、已有匹配身份正文与用户删除文件不覆盖或补回。
- 复用交接证据（冻结部分未改）：126 项全量测试 `/tmp/markdown-notes-10-all-tests.log`；25 项后续受影响测试 `/tmp/markdown-notes-10-tests.log`；原 build/lint `/tmp/markdown-notes-10-build.log`；真实 localhost HTTP 14 组 `/tmp/markdown-notes-10-electron-final.log`，结果、逐条覆盖 JSON 与截图在 `/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-default-relations-8eEpbE`。覆盖 405 下载资源、全量导入/关系、后缀同名目标、目标删除、跨页多框、版本/目录错误、无效草稿、断网窄屏、双库及教材第 88 页实际位置返回。首次下载使用本机真实 HTTP；生产源、云归档发布分别留 16、18。
- 接续重验：`npm run desktop:build` 通过（含前端/脚本/桌面类型检查与 62 文件安装清单校验），日志 `/tmp/markdown-notes-10-resume-build.log`。`lint:frontend`、`lint:desktop` 与新增回归脚本最终 lint 通过，日志 `/tmp/markdown-notes-10-resume-lint.log`、`/tmp/markdown-notes-10-resume-lint-final.log`。受影响 `initial-relations / initial-notes / anchors / links / note-projection` 共 23 项通过，日志 `/tmp/markdown-notes-10-resume-tests.log`。最初依赖符号链接指向网页旧依赖导致构建失败，改指向已有桌面依赖后通过，未修改依赖清单。
- 旧未通过记录 `/tmp/markdown-notes-10-context.log` 为修复前 1916→1879px 偏移，不能当通过证据。交接补丁已含来源各滚动容器捕获/返回恢复；新树运行隔离版 `/tmp/check-markdown-notes-10-resume-context.mjs` 已通过预览 1916→1916px、实时预览 3996.5→3996.5px，日志 `/tmp/markdown-notes-10-resume-context.log`、证据 `/tmp/markdown-notes-10-resume-context`。原证据目录只读，所有写入均在复制夹具。
- 持续回归命令：`RELATIONS_FIXTURE=<上述14组HTTP证据目录> node --experimental-strip-types desktop/check-relation-context.mjs`（先 `npm run desktop:build`）。六组通过，日志 `/tmp/markdown-notes-10-resume-regression.log`；证据 `/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-relation-context-xu8vNI` 含 `result.json`、两种模式跳转前/返回后截图及 `code-clears-highlight.png`，均已视觉核对。真实点击原文第 9 页后返回：预览 1916→1916px、实时预览 3694→3694px；教材实际第 88 页及 scrollTop 84928 恢复到 2px 内；60 段正文、无效 YAML 草稿与磁盘原文保持。删除、普通文字、行内代码、代码块四种源编辑均清除原文边界和返回条；渲染进程错误与 HTTP 请求均为 0。
- 新检查首次因完整笔记库首次索引超过操作超时而未通过；已缩小为仅复制教材级资料与缓存的单篇长文夹具，按真实 UI 添加书架并开始阅读后通过。此夹具只用于精确验证上下文恢复，不替代全量导入证据。
- 网页入口未接入本地协议，Reader 的 capture/request 扩展仅在传入本地工具时生效；本次 build、类型检查与既有网页全量测试证据通过，未另跑网页全部浏览器矩阵。macOS 最终安装包整体验收留 17；Windows 环境缺失留 13；首版发布门槛留 12。本票不宣称发布完成或学生学习效果已验证。
