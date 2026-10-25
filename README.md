# 课本解读

初中数学教材解读项目。当前可上下连续阅读人教版七年级上册全部 202 个 PDF 页面。左侧导航可收起，支持缩略图、页码输入和上下页跳转。六章均已接入按教材位置展开的补充解读与关联回顾。

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

当前内容通过静态 JSON 接入，并检查来源身份、位置和关联引用。六章分别维护 `chapter-N.json` 和定位文件，由 `src/textbook/chapters.ts` 统一注册；第一章定位沿用 `locations.json`，其余章节使用 `chapter-N.locations.json`。各章逐题覆盖均已完成原图核对。通用内容编译器尚未实现；补充内容的学习效果尚无学生使用证据。

## 浏览器回归

以下脚本导出检查函数，供已打开本地阅读器的 ego-browser Page 调用。直接用 `node` 执行脚本只会加载模块，不会运行这些检查。使用 ego-browser skill 建立自己的页面，再以绝对 `file:` URL 导入所需模块，传入该页面；参数和前置状态以函数定义为准。

| 修改范围 | 现有入口 |
| --- | --- |
| 页码位置、原位输入、侧栏开合 | [check-page-navigation.mjs](scripts/check-page-navigation.mjs)：`checkToolbarPageControls(page)`、`checkPageNavigation(page, expanded)` |
| 页底预览与入口点击 | [check-related-return.mjs](scripts/check-related-return.mjs)：`checkPreviewEntry(page, 文件页序, 条目ID)`，可传各章真实标记 |
| 单条与分组入口、关联返回 | [check-related-return.mjs](scripts/check-related-return.mjs)：`checkReviewCase(page, index)`、`checkAccordion(page, id)`；`reviewCases` 是第一章关联清单，不代表全书全集 |
| 多层返回、退出、失败和取消 | 同模块的 `checkReviewChain`、`checkReviewExit`、`checkReviewFailures`、`checkRelatedReturn` |
| 方法开合、续读与完整路径 | 同模块的 `checkOnDemandMethod`、`checkMethodReturnChain`、`checkReaderJourney` |
| 滚走后定位并保留上下文 | 同模块的 `checkLocate`、`checkLocateGroup`、`checkLocateReturn` |
| 笔记、草稿与外部修订 | 同模块的 `checkNoteAutosave`、`checkMethodDraft`、`checkTitleDraft`、`checkDraftDuringNavigation`、`checkStalePersonalWrite` |

`check-related-return.mjs` 的题目、关联样本和位置查找绑定第一章；依赖这些数据的检查不能直接传入其他章 ID。其他章节须使用该章真实入口与位置，沿相同阅读路径单独核验，不以第一章用例代替。`checkPreviewEntry` 只使用传入的文件页序与标记 ID，可跨章检查。

按实际改动选取入口，核对原文位置、展开项、方法状态、面板滚动、焦点和返回层级；动作预期见架构说明。复用公共交互检查不代表已经点击全书每条链接。

涉及个人内容或阅读记录写入的检查，使用独立测试 origin 和自己的浏览器页面，不接管用户验收页。要求 `{ testOrigin }` 的函数须显式传入；先检查各函数的存储及草稿前置条件，结束后恢复原始状态。多个检查不要并发修改同一页面或存储。

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
