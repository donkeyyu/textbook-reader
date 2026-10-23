# Issue tracker: Local Markdown

任务与功能规格保存在仓库的 `.scratch/` 下。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 功能规格：`spec.md`；项目需求基线仍由 `docs/SPEC.md` 维护。
- 每个任务一个文件：`issues/<NN>-<slug>.md`，编号从 `01` 开始。
- 任务开头用 `Status:` 记录分流状态，取值见 `triage-labels.md`。
- 分流后的任务用 `Category: bug` 或 `Category: enhancement` 记录类别。
- 评论和讨论追加到文件末尾的 `## Comments` 下。
- `.scratch/` 纳入 Git 管理，按需创建实际任务文件。

## Session 文件引用

- session 中交付任务时，提供指向实际文件的绝对路径 Markdown 链接。
- 文档之间使用相对链接，使引用随仓库迁移。
- 任务路径作为稳定标识；引用包含功能目录和完整文件名。
- 收到文件引用时，先读取文件，再继续工作；进度和结论写回任务。
- 仅提供编号时，在当前功能目录内解析；有歧义时确认所属功能。
- 文件移动或更名时，同步更新仓库内的引用。

## 技能操作映射

- “发布到 issue tracker”：创建对应规格或独立任务文件，并返回文件链接。
- “读取相关 ticket”：读取引用的任务文件，包括评论和相关文件链接。

## Wayfinding operations

以下约定用于 `/wayfinder` 的探索任务，其状态与分流状态分别解释。

- Map：`.scratch/<effort>/map.md`，记录 Notes、Decisions-so-far、Fog。
- 子任务：`issues/<NN>-<slug>.md`，正文记录待解决的问题。
- `Type:` 为 `research`、`prototype`、`grilling` 或 `task`。
- `Status:` 记录领取和完成状态：`claimed`、`resolved`；
  尚未领取的任务不设置这两个状态。
- `Blocked by: NN, NN` 记录依赖；全部依赖为 `resolved` 后可开始。
- 从未完成、未领取且无阻塞的任务中，按编号选择下一项。
- 开始工作前写入 `Status: claimed` 并保存。
- 完成后追加 `## Answer`，设置 `Status: resolved`，
  再向 map 的 Decisions-so-far 添加结论摘要和任务相对链接。
