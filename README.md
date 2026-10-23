# 课本解读

初中数学教材解读项目。当前可上下连续阅读人教版七年级上册全部 202 个 PDF 页面。左侧导航可收起，支持缩略图、页码输入和上下页跳转。

## 本地开发

使用 Node.js 22.12+（22.x）或 24+，以及 npm。

```sh
npm ci
npm run prepare:textbook
npm run dev
```

```sh
npm run typecheck # 类型检查
npm test          # 页目录与滚动定位检查
npm run build     # 类型检查并构建到 dist/
npm run preview   # 预览构建结果
```

当前使用 Vite、React 和 TypeScript。

教材页图保留在本地，不纳入 Git。准备命令需要 `cwebp`，读取 `materials/textbooks/人教版-数学-七年级上册.pdf` 及 `materials/indexes/人教版-数学-七年级上册/` 中已核对的索引和 PNG 页图。命令校验 PDF 与全部页图的哈希，再生成 202 页 WebP、缩略图、来源记录及 `src/textbook/book.json`；无需再次渲染 PDF。来源见 [项目背景](docs/CONTEXT.md)。换教材时须重新核对内容与定位，不能仅替换文件名。

从封面打开，所有页面按 PDF 实际页序连续排列。上下滚动会更新当前页及左侧选中项。输入页序后回车跳转；收起导航后，页码输入与总页数保留在工具栏。桌面可展开或收起侧栏，手机使用浮动导航。页图按需加载，并预留原图比例，避免加载时挤动阅读位置。

当前阅读器使用七年级上册，不含解读。旧九年级教材的运行资源与配方法解读已移除；规格中的配方法章节仍保留为教学参考。通用内容包校验与全书解读尚未实现。

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
