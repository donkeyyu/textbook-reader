# Markdown 笔记桌面首版 · 任务索引

需求基线：[项目规格 R15](../../docs/SPEC.md#r15-本地-markdown-笔记方向已确认暂不实现)。本文件仅组织执行，不复制需求。

2026-11-01，DonQ 批准创建 12 张票及初始依赖关系，仅授权创建任务，暂不开始实现。任务均为 enhancement，状态 ready-for-agent；该状态表示规格可执行，不表示依赖已完成或已开始工作。

范围：Electron 复用 React/Vite；macOS 开发验证且支持 Windows；教材首次下载后离线可读；本地统一 Markdown 笔记。排除旧个人内容迁移、学生笔记云端备份、同步恢复、Git、插件、多窗口和聚类等后续功能。

| 任务 | 直接阻塞票 |
| --- | --- |
| [01 桌面打开笔记库并保存第一篇笔记](issues/01-desktop-vault.md) | 无 |
| [02 外部编辑与自动保存冲突保护](issues/02-external-edit-conflicts.md) | 01 |
| [03 下载当前教材并离线阅读](issues/03-offline-textbook.md) | 01 |
| [04 导入 AI 初始内容，直接编辑统一笔记](issues/04-initial-unified-notes.md) | 03、05 |
| [05 正文三模式与文件头独立切换](issues/05-editor-modes.md) | 02 |
| [06 顶部笔记位置与教材框选往返](issues/06-anchors-roundtrip.md) | 04、05 |
| [07 自定义章节在同教材笔记间复用](issues/07-custom-catalog.md) | 06 |
| [08 路径链接、重名选择与反向引用](issues/08-path-links.md) | 05 |
| [09 笔记改名和移动后维护引用](issues/09-rename-links.md) | 02、08 |
| [10 将默认知识关联接入统一笔记](issues/10-default-relations.md) | 04、06、08 |
| [11 搜索与知识图统一指向本地笔记](issues/11-search-graph.md) | 04、08 |
| [12 双平台首版交付与完整离线路径验收](issues/12-desktop-release-verification.md) | 07、09、10、11 |

按依赖已完成的前沿领取，不要求机械地按编号串行。首次可领取 01；技术选择在对应票内落实。旧领域词汇中的附属笔记与逐实例绑定描述的是旧系统，新桌面目标以 R15 为准；现有 proposed ADR 不自动升级为已批准决定。

## 审查记录

2026-11-01：本轮仅审查和修正文档，未开始功能实现。对照 R15 补齐时间维护、本机状态恢复、只读与属性保护、标签检索、属性内链接及双平台验收。04 新增 05 为前置，先固定 callout 格式再导入；01 提供最小安装产物，12 完成发布与全路径验收。上述调整用于落实已有需求，不新增首版功能。

每票的 `Blocked by` 与本表保持一致；依赖完成以票内记录的实现和验收证据为准，`Status` 仍只表达分流状态。
