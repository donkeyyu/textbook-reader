---
version: 1
slug: "src-main-tsx"
primary_target: "src/main.tsx"
related_targets: ["src/style.css","src/reader/Reader.tsx","src/reader/supplements/SupplementPanel.tsx"]
---

# 教材阅读页

Mode: Read. 本页从真实教材原页进入解读、关联查阅和返回。页面由 `src/reader/Reader.tsx` 实现，`src/main.tsx` 负责挂载。

## 按任务读取

- 行为和范围：[SPEC.md](../../docs/SPEC.md) 的 R1–R11；教材覆盖现状见 [README](../../README.md)。
- 视觉和组件：[DESIGN.md](../../DESIGN.md)；具体尺寸与样式取 `src/style.css`，不在本入口复制参数。
- 交互状态：[ARCHITECTURE.md](../../docs/ARCHITECTURE.md#阅读状态与跳转)。
- 验证：[README 的浏览器回归](../../README.md#浏览器回归)；只将实际完成的检查记为通过。

本文件只维护阅读入口。[旧生成快照](../../docs/archive/impeccable/design.json)已归档，不能用来恢复旧页码布局、配色或内容范围。
