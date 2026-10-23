# 课本解读

初中数学教材解读项目。当前仅完成工程初始化，教材阅读与解读功能待开发。

## 本地开发

使用 Node.js 22.12+（22.x）或 24+，以及 npm。

```sh
npm ci
npm run dev
```

```sh
npm run typecheck # 类型检查
npm run build     # 类型检查并构建到 dist/
npm run preview   # 预览构建结果
```

当前使用 Vite、React 和 TypeScript。

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
