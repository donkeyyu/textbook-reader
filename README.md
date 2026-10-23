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

从封面打开，所有页面按 PDF 实际页序连续排列。上下滚动会更新当前页及左侧选中项。输入页序后回车跳转；收起导航后，页码输入与总页数保留在工具栏。桌面可展开或收起侧栏，手机使用浮动导航。页图按需加载，并预留原图比例，避免加载时挤动阅读位置。

六章共接入 958 条补充和 960 个经原图核对的位置，覆盖 PDF 第 8–199 页的逐页取舍记录。入口对应段落、关键语句、例题步骤或题目；2 个位置仅作为关联回顾目标。数量描述当前交付，不是各章的固定配额。

| 章节 | 逐题清单 | 补充条数 | 定位数 |
| --- | ---: | ---: | ---: |
| 第一章 有理数 | 88 | 127 | 128 |
| 第二章 有理数的运算 | 169 | 242 | 242 |
| 第三章 代数式 | 68 | 108 | 108 |
| 第四章 整式的加减 | 74 | 108 | 108 |
| 第五章 一元一次方程 | 126 | 187 | 187 |
| 第六章 几何图形初步 | 127 | 186 | 187 |

共 652 项逐题清单，覆盖例题、练习、习题、复习题和明确作答的思考、探究、活动。每题显示考查知识点、思路与方法、注意事项及相关知识入口；同题小问逐一涵盖，跨页题只计一次。一般概念及步骤解读继续保留，标题不重复标注当前位置页码。

教材旁的 💡 按定位 JSON 放置。悬浮或聚焦可预览，并用细矩形框和半透明浅蓝填充标出对应原文；预览内以灰色提示“点击灯泡展开解读”，点击 💡 查看正文。相邻入口在当前尺寸下重叠时合并为带数量的灯泡，点击后以折叠面板列出题号或标题，点击标题展开或收起；展开后定位到该题的原文，缩放后重新判断重叠。桌面在右栏阅读，窄屏在下方面板阅读。关联入口说明回顾目的，跳到对应原文区域；抽屉中的“返回”恢复来源位置和已展开的解读。旧九年级运行资源与配方法解读仍已移除，规格中的配方法章节只作教学参考。

当前内容通过静态 JSON 接入，并检查来源身份、位置和关联引用。六章分别维护 `chapter-N.json` 和定位文件，由 `src/textbook/chapters.ts` 统一注册；第一章定位沿用 `locations.json`，其余章节使用 `chapter-N.locations.json`。各章逐题覆盖均已完成原图核对。通用内容编译器尚未实现；补充内容的学习效果尚无学生使用证据。

浏览器回归检查 `scripts/check-related-return.mjs` 供已打开本地阅读器的 ego-browser Page 调用：`reviewCases` 自动读取第一章全部关联，`checkReviewCase(page, index)` 检查每个入口与位置、滚动和焦点恢复；`checkAccordion(page, id)` 检查分组条目的键盘展开、收起、切换及标题可见性；`checkReviewChain`、`checkReviewExit`、`checkReviewFailures` 覆盖多层往返、退出、失败重试、取消和快速重复点击。`checkRelatedReturn(page)` 使用“猜数范围→数轴大小顺序”检查无独立解读的关联目标不会重复入栈。

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
