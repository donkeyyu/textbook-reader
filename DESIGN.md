---
name: 课本解读
description: Apple 风格的极简教材阅读界面；按现有实现记录。
colors:
  accent: '#0066cc'
  text: '#1d1d1f'
  background: '#f5f5f7'
  surface: '#fff'
  secondary: '#6e6e73'
  separator: '#e5e5e7'
  hover: '#ededf0'
  disabled: '#9b9b9f'
  input-border: '#d2d2d7'
  error: '#b42318'
  selection: '#cce4ff'
  scrollbar: '#c9c9ce'
  marker-hover: '#f5f5f7d9'
  location-tint: '#0066cc0a'
  supplement-surface: '#f4f8ff'
  supplement-arrival: '#dceaff'
typography:
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  book-title:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 18px
    fontWeight: 600
    letterSpacing: -.025em
  label:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 13px
  mobile-book-title:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 16px
    fontWeight: 600
  page-number-and-error:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 12px
  supplement-heading:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.5
  mobile-supplement-heading:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.5
  supplement-body:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 15px
    lineHeight: 1.9
  supplement-preview:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 14px
    lineHeight: 1.7
  related-purpose:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 13px
    lineHeight: 1.7
  supplement-marker:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 22px
    lineHeight: 1
  mobile-supplement-marker:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 20px
    lineHeight: 1
rounded:
  control: 6px
  icon: 8px
  message: 10px
spacing:
  compact: 4px
  small: 8px
  control-gap: 16px
  panel: 24px
  wide: 32px
  desktop: 40px
components:
  icon-button:
    textColor: '{colors.secondary}'
    rounded: '{rounded.icon}'
    padding: '0'
    width: 36px
    height: 36px
  icon-button-hover:
    backgroundColor: '{colors.hover}'
    textColor: '{colors.text}'
  text-button:
    textColor: '{colors.accent}'
    padding: 4px 0
  page-input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 4px
    width: 42px
    height: 30px
  page-thumbnail:
    textColor: '{colors.secondary}'
    rounded: '{rounded.control}'
    padding: 8px 0
  supplement-marker:
    rounded: '{rounded.control}'
    padding: '0'
    width: 36px
    height: 36px
  supplement-preview:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.message}'
    padding: 16px 20px 12px
    width: 280px
  supplement-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    padding: 28px 24px 40px
    width: 350px
---

# Design System: 课本解读

## Overview

**Creative North Star: "Apple 风格的极简阅读"**

沿用 DonQ 指定的 Apple 风格与最少必要元素。白色和浅灰区分教材与阅读底，蓝色标出操作和当前页。七年级上册的 202 页原页是主体；界面不显示版本信息，不增加卡片或装饰。第一章现有 12 条补充，原页对应位置以 💡 进入，解读按需展开。

产品依据见 [PRODUCT.md](PRODUCT.md) 与 [SPEC.md](docs/SPEC.md)。本文件按 [style.css](src/style.css)、[Reader.tsx](src/reader/Reader.tsx) 和 [Supplement.tsx](src/reader/Supplement.tsx) 记录；页面契约见 [教材阅读页](.impeccable/surfaces/src-main-tsx.md)。

## Colors

`accent` 是唯一操作强调色，用于重试、当前页、关联入口、返回与焦点。`surface`、`background` 区分白色纸页与浅灰阅读底；`text`、`secondary` 建立文字层级。教材定位使用蓝色细描边和低透明度底色；💡 悬停或展开时有浅灰透明底。其余颜色仅用于分隔、禁用、页码错误、选择与滚动条。

## Typography

界面使用系统无衬线字体。桌面书名为 18px、移动书名为 16px，字重均为 600；页码输入与总数为 13px，缩略图页码与输入错误为 12px，加载提示和重试为 14px。页码使用等宽数字。教材文字来自原页图像，不套用界面字体。

解读标题桌面为 18px、手机为 17px，字重 600、行高 1.5；正文为 15px、行高 1.9。预览文字为 14px、行高 1.7；关联目的为 13px、行高 1.7；关联按钮为 14px、行高 1.6，附属印刷页码为 12px。💡 桌面字号 22px、手机 20px，行高 1。手机返回按钮为 13px。

## Layout

工具栏桌面高 72px，手机高 64px。桌面左侧导航宽 152px，可由顶部图标按钮收起；收起后页码输入、总数及上下页操作移入工具栏。教材按 PDF 页序上下连续排列，最大宽 690px，页间距 24px。滚动时当前页码与缩略图选中项同步。各页按原图尺寸预留比例，避免图片加载改变页面位置。

宽度不超过 1000px 时，阅读区内边距为 24px。不超过 760px 时，导航默认收起，展开为 152px 浮动侧栏，跳页后关闭；阅读区内边距为 16px 12px、页间距为 16px。手机工具栏保留页码输入及总数，上下页按钮放在展开的导航中。教材区填满工具栏下方的可用高度，独立连续滚动。

桌面展开解读后，右侧增加独立滚动的 350px 白色栏；761–1000px 宽度下为 310px。手机解读位于教材下方，使用可用区域的 45%、最少 180px，两区各自滚动。面板关闭后教材恢复原阅读宽度，并保留阅读位置。预览优先放在整张教材页外的留白处，宽 220–280px；右侧不足时使用左侧留白。两侧都不足时，预览在阅读区下方独立显示，保持教材宽度不变，不覆盖正文。预览高度受视口限制，内容过长时可滚动。

## Elevation & Depth

纸页、导航与解读栏无阴影。加载／错误提示与悬浮预览使用轻阴影，值见 sidecar 的 `extensions.shadows`。底部预览与手机下方解读使用 240ms 上滑淡入（14px），背景由 #dceaff 收敛到 #f4f8ff，保留 2px 蓝色上边线。只在出现或切换内容时播放一次；减少动态效果模式取消位移和透明度变化，仅保留 120ms 背景色反馈。

## Shapes

小圆角只用于控件与提示；纸页保持直角。页码输入框有细边框，当前缩略图使用蓝色外描边。普通按钮焦点描边为 2px、偏移 4px；输入框偏移 2px。

## Components

- 图标按钮：灰色图标、透明底，悬停出现浅灰底；禁用时减淡。导航开关在桌面和手机均可用。
- 页码输入：居中显示当前页，旁列总数 202；错误时边框与说明变红。侧栏收起后仍可输入跳页。
- 缩略图导航：图像框为 80 × 112px，保持原图比例；当前项图像有 2px 蓝色描边、偏移 3px，页码同步变蓝。
- 加载失败：页内保留图像占位，显示简短错误和蓝字重试；跳转失败保留原阅读位置。
- 解读标记：原页留白处显示无常驻外框的 💡，桌面触区 36 × 36px，手机 32 × 32px；位置由核对过的归一化坐标给出。悬停或键盘聚焦显示短预览，同时以蓝色细矩形框和半透明浅蓝填充标出对应原文区域；预览关闭时撤销预览框。预览内显示灰色非交互提示“点击灯泡展开解读”；点击标记直接展开，键盘使用 Enter 或空格。
- 解读栏：白底、细分隔线，含标题、关闭按钮、短段落及必要的关联入口。关联目的与按钮相邻，页码使用已核对的印刷页码；没有印刷页码时标明 PDF 页序。
- 定位与返回：关联跳转以蓝色细框标明原文区域；抽屉内顶部出现返回入口，恢复来源阅读位置及解读上下文。“返回”和“关闭”同行，标题位于下一行；无返回时，标题与“关闭”同行。直接点击任何灯泡会清除返回记录并重置面板滚动。高亮层不拦截教材操作。

## Do's and Don'ts

- Do 沿用真实教材图像，保持正文可读。
- Do 保留键盘焦点、当前页和错误状态；宽度改变时保留阅读位置。
- Don't 增加额外信息、布局或装饰。
- Don't 将阅读区包装成卡片。
