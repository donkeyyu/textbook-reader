# 21 阅读路径验证

2026-10-25。产品工程可执行部分已通过；21整票和整体规格未完成。真实手机仍无可操作设备。最终共享工作区的类型检查与构建由主会话统一执行，本票未代记通过。

使用 Ego TaskSpace 38 的自有页面、独立构建与5219预览源。基线HEAD、源码/教材文件哈希及实际运行JS/CSS哈希见[version.json](version.json)。桌面1400×1000、窄屏390×844、末页边界320×1200始终使用同一最终构建；测试时运行产品源码与共享工作区一致；并行教材内容以固定构建哈希为准。主会话另同步source.json生成元数据及catalog.test.ts检查，属于测试/元数据集成变更，不改变本票运行产品源码，不重跑浏览器。运行JS SHA-256为`c05b5066d5f34c709fc6d58b434db5784b6d10edeb7fbc6b810e794013d6511e`。浏览器自报Chrome/154.0.0.0、MacIntel；390px是桌面视口仿真，不是手机。[浏览器元数据与工具限制](browser.json)。

| 项目 | 结果与证据 |
| --- | --- |
| A1–A4 找页 | 桌面、窄屏在导航展开/收起下通过印刷3→文件10、首/中/末文件页、无印刷页码、空值/格式/无结果/越界、切换模式与Escape焦点恢复。[desktop.json](desktop.json)、[journeys.json](journeys.json) |
| Q1 连续链路 | 两种尺寸均以印刷6进入文件13，打开习题解读，自主以Space展开方法，关联查阅、返回，再刷新续读。返回前后解读、合并入口选项、方法、原页区域、面板滚动、来源链接焦点一致。桌面面板滚动13px，窄屏830px，均准确恢复；刷新只保留教材位置，重新进入方法收起。[journeys.json](journeys.json) |
| C1–C3 与草稿 | 方法默认/鼠标/Enter/Space/直接重开/关闭/刷新、单条与合并入口切题、两层关联返回、方法开合保留同一编辑器与草稿均通过。取消放弃的确认替身始终返回false。[desktop.json](desktop.json)、[journeys.json](journeys.json) |
| 失败与取消 | 图片decode拒绝后来源保留，重试可达，返回链无重复；取消后忽略晚到结果；快速重复点击无重复返回层。两种尺寸通过。[desktop.json](desktop.json)、[journeys.json](journeys.json) |
| B1–B3 续读/隔离 | 真实关闭桌面标签后，在390×844新标签恢复文件50的0.369565位置，窄屏刷新相同；坏JSON、其他教材身份及第203页从封面打开且可继续跳页。读/写拒绝只产生一条提示，尝试次数分别0/1，仍可阅读，已保存笔记原始记录不变。[storage.json](storage.json) |
| B4 初始化/节流/离开保存 | 复用[02验证](../02/verification.md)与既有测试证据；本轮未改该生命周期，不重复计为本轮浏览器执行。当前版本的刷新、关闭重开与跨尺寸路径已另行执行。 |
| 上下分区 | 窄屏把手键盘调整到50%，原页位置保持，教材/面板可视高度370/368px，无水平溢出，原页位图实际宽1304px。[journeys.json](journeys.json) |
| Q3 真实手机 | 未验证：没有可操作设备。普通正文、分数、几何图、入口触控与上下分区的手机可读性/点选均待实机记录。 |
| 像素检查/原生离开确认框 | 未验证：截图返回Unable to capture screenshot。额外的CDP Page.reload未暴露beforeunload确认框，不能把合成事件检查算作真实确认框验证。取消标题编辑与beforeunload处理器取消事件的回归已通过。[browser.json](browser.json) |

本轮确认并修复四项问题：

1. **末页位置被误拒绝。** 旧版本在320×1200下产生合法fraction=-1.51378，却报“阅读位置无效”并停止后续保存。[旧版复现](baseline-failure.json)。移除错误的-1下界，保留有限数与其他校验，不裁剪位置。几何回归覆盖真实教材尺寸、准确恢复与后续保存。浏览器修正后保存/刷新同为-1.5127907，随后第50页仍能保存。[storage.json](storage.json)。
2. **只改标题时保护失效。** 旧版取消无提示、beforeunload处理器未拦截；现在个人补充标题变化参与编辑器脏状态、取消确认和离开处理。[旧版复现](baseline-drafts.json)，两种尺寸回归通过。
3. **加载期间新草稿被卸载。** 旧版挂起decode后输入的文本被晚到导航清除；现在正文或标题编辑取消待完成导航，现有请求身份检查忽略晚到结果。[旧版复现](baseline-drafts.json)，两种尺寸回归通过。
4. **旧标签覆盖新个人内容。** 旧API在两次独立读取后依次保存，最终仅剩B的笔记。现在每次保存比较本标签的已读版本与当前存储；已变化则保留草稿并提示复制后刷新。单元测试覆盖覆盖笔记、复活已删补充及后续正常保存；两张真实标签页验证冲突提示、A的存储不变及B的草稿保留。[storage.json](storage.json)。不新增同步系统。

已完成23项`npm test`，[输出](tests.txt)；独立`npx vite build --outDir /tmp/textbook-reader-21-20261025/final`通过，保留既有大包提示；浏览器脚本语法与受影响文件diff空白检查通过。统一类型检查、最终集成构建及其验收勾选留给主会话。没有学生/家长使用证据，不作学习效果结论。

复跑使用当前仓库的`scripts/check-page-navigation.mjs`和`scripts/check-related-return.mjs`。后者新增`checkReaderJourney`、`checkTitleDraft`、`checkDraftDuringNavigation`、`checkStalePersonalWrite`。使用新独立outDir与未占用端口；存储故障和个人内容fixture只在自己的测试源运行。`checkTitleDraft`需要文件13上名为QA title的已保存个人补充；`checkStalePersonalWrite`需要两页先加载同一个人内容版本。

Ego 0.6.0.16会在高层Page调用前恢复桌面尺寸，本票保留[最小CDP适配](cdp-page.mjs)以复跑固定视口。字段输入/选择及部分边界按钮用DOM事件；完整Q1链路用原生CDP鼠标、Enter/Space，所有断言读取实际运行界面。草稿文本输入和撤销用原生CDP；末尾定位用DOM Range。[工具失败与恢复](tool-notes.md)。浏览器操作示例（需先启动自己的固定预览服务）：

```javascript
const task = await taskSpace('21-recheck-unique-name');
const raw = task.page('p1');
await raw.goto('http://127.0.0.1:5219');
const { driver } = await import('file:///Users/chengqiyu/dev/课本解读/.scratch/textbook-preview-review/evidence/21/cdp-page.mjs');
const { checkReaderJourney } = await import('file:///Users/chengqiyu/dev/课本解读/scripts/check-related-return.mjs');
const page = driver(raw);
await page.viewport(1400, 1000);
await checkReaderJourney(page);
await page.viewport(390, 844);
await checkReaderJourney(page);
await task.finish({ keep: [] });
```

实际修改的产品/回归文件：`src/reader/reading-record.ts`、`src/reader/session.test.ts`、`src/reader/personal.ts`、`src/reader/personal.test.ts`、`src/reader/MarkdownEditor.tsx`、`src/reader/PersonalPanel.tsx`、`src/reader/Reader.tsx`、`scripts/check-related-return.mjs`。另更新本票及本证据目录。未修改教材内容、需求规格、其他票或索引，未stage/commit。版本哈希用于界定实际验收版本；并行内容修订由各内容票核验，不把本票结果外推为全部内容审核通过。

已收尾：TaskSpace 38执行finish且未保留页面；只停止本票5217/5218/5219服务，并删除自己的临时构建、源码副本和逐轮脚本。保留有效JSON结果、版本、回归入口与最小固定视口适配。未重置浏览器或清除其他存储。
