---
version: 1
slug: "src-main-tsx"
primary_target: "src/main.tsx"
related_targets: ["src/style.css","src/reader/Reader.tsx"]
---

# 教材阅读页

Mode: Read. 按 DonQ 本轮指令使用最新抓取的七年级上册 202 页，支持上下连续滚动、可收起的左侧导航与快速页码跳转。页码按 PDF 文件页序显示。

## Direction contract

THESIS: 完整教材是页面主体。没有欢迎区、统计卡片或装饰。

OWN-WORLD: 用户指定 Apple 风格与极简元素；白色、浅灰阅读底、系统中文字体、蓝色操作。仅临时加载／错误提示使用轻阴影。

STORY: 从封面开始，连续滚动读完整本教材；用缩略图或页码定位，随时收起导航扩大阅读区。

FIRST VIEWPORT: 桌面顶部书名与导航开关；左侧 152px 页导航；中央真实原页。左栏顶部输入当前页，旁列总页数；收起后移入工具栏。手机默认收起导航，展开时浮动显示。

FORM: 延续用户确定的方向，直接修改现有 React 工程，不增加额外构图。全书按原图比例预留空间，读到哪里，页码和选中缩略图跟到哪里。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Scope

七年级上册全部 202 页连续阅读与导航。旧九年级运行资源及配方法解读已移除；本轮没有七年级解读。教材身份保留在离线来源记录，版本信息不显示在界面。内容范围与待决事项以 docs/SPEC.md 为准。
