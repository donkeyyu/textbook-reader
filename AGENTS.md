# 课本解读 · Agent 工作约定

本项目围绕真实教材，帮助学生理解知识、理解例题变换的理由，并回到教材巩固关联知识。当前聚焦初中数学。称呼项目负责人为 DonQ，默认用简洁中文沟通。

## 活跃版本与目录

本目录是旧网页版备份，保留文件，不作为活跃开发、运行或验收目录。
当前活跃项目是基于网页版前端改造的 Electron 本地版，位于
[`../textbook-reader-modes/`](../textbook-reader-modes/AGENTS.md)。
处理当前产品任务时，先切到该目录并读取其 `AGENTS.md`、规格和源码；仅在 DonQ 明确要求维护旧版时修改本目录。

## 按任务加载

- **理解定位、评估价值或讨论范围**：读取 [CONTEXT.md](docs/CONTEXT.md)，区分已确认方向与待验证假设。
- **编写解读、建立知识关联、设计阅读交互或实现功能**：先读取 [SPEC.md](docs/SPEC.md) 的需求层级和范围，再读取对应章节，按其层级使用内容标准和验收条件；参考样例不自动成为通用要求。
- **设计或审查界面、修改阅读布局或交互**：使用 [reader-ui-design](.agents/skills/reader-ui-design/SKILL.md) 判断空间与操作取舍，再查 [DESIGN.md](DESIGN.md) 对应组件及 [README 的浏览器回归入口](README.md#浏览器回归)。
- **实现或审查小岛书桌风格**：使用 [island-reader-style](.agents/skills/island-reader-style/SKILL.md) 统一视觉规则。
- **使用教材事实**：查看实际教材页面，核对版本、印刷页码和题号；文件位置见 CONTEXT.md 的“参考材料”。文本提取用于检索，原页用于核对公式和排版。

## 工作流程

1. 明确本次任务对应的规格条目，以及所需教材证据。完成条件：任务范围与待核对来源可以列明。
2. 完成授权范围内的内容或实现。新增建议、假设和用户已确认决定分别标明；只有已获授权的范围、教学目标或交互规则变更才更新为 SPEC.md 的要求。
3. 按受影响的验收条件检查。内容检查覆盖数学条件、教材对应关系、解释增量；交互检查覆盖本次修改影响的完整阅读路径。
4. 交付结果，说明已检查的行为和仍未验证的事项。以学习效果为结论时，需有学生使用证据，不能以原型运行通过代替。

## 维护原则

- 文档分工：AGENTS.md 管工作方式；CONTEXT.md 管背景、依据与未决问题；SPEC.md 管需求和验收。一项规则只在其所属文档维护。
- 依据源码说明实现事实，依据 SPEC.md 的需求层级判断目标；实现中已有的行为不自动构成用户决定。
- 在现有实现基础上做最小必要改动。技术栈、运行方式和命令从项目配置读取；尚未存在的配置不写成既定事实。
- 独立工作确有收益时可使用 subagents，并核对结果；另建用户可见任务仅在 DonQ 要求时进行。

## Agent skills

### PDF content indexing

建立或更新教材内容索引、页码映射和题目定位时，读取
[index-pdf-content](.agents/skills/index-pdf-content/SKILL.md)。

### Textbook download

从国家中小学智慧教育平台获取教材时，读取
[fetch-textbook](.agents/skills/fetch-textbook/SKILL.md)。

### Issue tracker

任务使用本地 Markdown；创建、读取或更新任务时，读取
[issue-tracker.md](docs/agents/issue-tracker.md)。

### Triage labels

使用默认五种分流状态；分流任务时，读取
[triage-labels.md](docs/agents/triage-labels.md)。

### Domain docs

采用 single-context 布局；探索领域概念或架构决策时，读取
[domain.md](docs/agents/domain.md)。

### Textbook supplements

编写或审核教材补充理解素材时，使用
[textbook-supplements](.agents/skills/textbook-supplements/SKILL.md)。
