Status: ready-for-agent
Category: enhancement

# 01: 保存完成后才确认笔记已保存

**Blocked by:** None (can start immediately).

**What to build:** 在现有阅读器中完成异步保存的准备改造。读者持续编辑笔记、切换解读或关闭面板时，只有保存成功的内容才显示为已保存，较新草稿不会被旧请求清除。现有同步存储继续可用，本任务不提前迁库。

- [x] 保存调用支持等待结果，确认与具体内容修订对应；失败保留草稿及可重试入口。
- [x] 连续输入、延迟或逆序完成不覆盖较新内容；切换节点或关闭面板不丢待保存内容。
- [x] 默认笔记自动保存与个人补充显式保存均沿用各自已有交互。
- [x] 浏览器验证成功、失败及切换路径；现有同步保存行为仍通过。

规格覆盖：US35–36；T10 的异步保存部分。此项是明确缺口的前置改造，不扩展为阅读器整体重构。

依据：[详细规格](../spec.md)、[审查记录](../review.md)。规格中的实施建议仍是工程建议，不提升为用户已确认的技术选型。

验证：运行受影响测试、类型检查与构建，并完成本票浏览器路径；仅为存储迁移和链接身份补充数据层测试。

## Comments

- DonQ 已批准拆分并授权发布。03 已加入节点距离、拖动效果及参考实现的验收要求。
- 2026-10-25，01 实现完成，留待主会话终审与提交。改动限于 `MarkdownEditor.tsx`、`PersonalPanel.tsx`、`Reader.tsx` 和新增 `scripts/check-async-save.mjs`；未修改存储实现、教材内容或其他票。已有未提交修改继续保留。
- 编辑器接受同步或异步保存，只确认匹配的请求；保存期间保持未保存状态，失败保留草稿和重试。读者层按调用顺序写入，并在每次执行时读取最新成功快照，从而阻止逆序写入及跨面板旧快照覆盖。个人补充保存、删除的界面副作用等待成功；已卸载编辑器不再结束新一轮编辑，旧保存也不重开已关闭的面板。保留原有确认放弃流程；取消放弃会保留待保存草稿。
- 浏览器证据：ego-browser TaskSpace `ticket-01-async-save-20261025`（13），独立 origin `http://127.0.0.1:5181`，桌面视口 1772×909。`checkAsyncNoteSave` 通过连续修订、单一在途写入、旧成功不清除新草稿或错误、失败重试、延迟清空、关闭与关联切换保护，以及确认关闭后重开期间的写入顺序。`checkAsyncPersonalSave` 通过标题与正文在保存期间继续编辑、失败重试、只改标题、刷新读取、取消标题后重开并同步保存、旧编辑器完成不关闭新编辑、延迟删除及删除重试。
- 同步回归：现有 `checkNoteAutosave`、`checkDraftDuringNavigation` 通过。覆盖连续输入、清空、预览、CodeMirror 实例及 Undo、存储失败重试、外部修订冲突，以及加载教材期间失败草稿不被迟到跳转卸载。测试在结束后恢复个人存储，未接管用户验收页面。
- 检查：`npm test` 23/23；`npm run typecheck`；`npm run build`；`node --check scripts/check-async-save.mjs`；`git diff --check` 均通过。构建仍有已有的大 chunk 提示。未新增数据层测试；异步故障由专用 Vite 测试服务器临时包装真实 `savePersonal` 注入，应用代码不含故障开关，也不宣称已验证未来数据库迁移或学生学习效果。
- 重放：从项目目录用 `node --input-type=module -e 'const { startAsyncSaveServer } = await import("./scripts/check-async-save.mjs"); await startAsyncSaveServer();'` 启动专用服务器，再从 ego-browser 按 README 的绝对模块导入入口依次调用 `checkAsyncNoteSave(page, { testOrigin })` 与 `checkAsyncPersonalSave(page, { testOrigin })`。个人补充检查要求空的个人存储；默认端口 5181，须与用户验收 origin 分离。

- 主会话终审：`65a84a0`（`fix(reader): await persistence before confirming saves`）。仅提交异步保存源码和新增检查脚本，既有未提交修改仍保留。独立提交候选在临时目录通过 23 项测试、类型检查、构建与脚本导入；主会话在独立 origin `http://127.0.0.1:5191` 用 ego-browser 验证首次保存延迟期间继续输入，编辑器身份及较新草稿保留，最终保存显示正确内容。检查环境已清理；一次快照参数错误已纠正，不属于产品失败。
