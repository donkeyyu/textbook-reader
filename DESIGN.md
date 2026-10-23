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
---

# Design System: 课本解读

## Overview

**Creative North Star: "Apple 风格的极简阅读"**

沿用 DonQ 指定的 Apple 风格与最少必要元素。白色和浅灰区分教材与阅读底，蓝色标出操作和当前页。七年级上册的 202 页原页是主体；界面不显示版本信息，不增加卡片、说明区或装饰。当前没有解读内容与解读栏。

产品依据见 [PRODUCT.md](PRODUCT.md) 与 [SPEC.md](docs/SPEC.md)。本文件按 [style.css](src/style.css) 和 [Reader.tsx](src/reader/Reader.tsx) 记录；页面契约见 [教材阅读页](.impeccable/surfaces/src-main-tsx.md)。

## Colors

`accent` 是唯一操作强调色，用于重试、当前页与焦点。`surface`、`background` 区分白色纸页与浅灰阅读底；`text`、`secondary` 建立文字层级。其余颜色仅用于分隔、悬停、禁用、页码错误、选择与滚动条。

## Typography

界面使用系统无衬线字体。桌面书名为 18px、移动书名为 16px，字重均为 600；页码输入与总数为 13px，缩略图页码与输入错误为 12px，加载提示和重试为 14px。页码使用等宽数字。教材文字来自原页图像，不套用界面字体。

## Layout

工具栏桌面高 72px，手机高 64px。桌面左侧导航宽 152px，可由顶部图标按钮收起；收起后页码输入、总数及上下页操作移入工具栏。教材按 PDF 页序上下连续排列，最大宽 690px，页间距 24px。滚动时当前页码与缩略图选中项同步。各页按原图尺寸预留比例，避免图片加载改变页面位置。

宽度不超过 1000px 时，阅读区内边距为 24px。不超过 760px 时，导航默认收起，展开为 152px 浮动侧栏，跳页后关闭；阅读区内边距为 16px 12px、页间距为 16px。手机工具栏保留页码输入及总数，上下页按钮放在展开的导航中。教材区填满工具栏下方的可用高度，独立连续滚动。

## Elevation & Depth

纸页和导航无阴影。仅加载／错误提示使用轻阴影，值见 sidecar 的 `extensions.shadows`。没有过渡动画。

## Shapes

小圆角只用于控件与提示；纸页保持直角。页码输入框有细边框，当前缩略图使用蓝色外描边。普通按钮焦点描边为 2px、偏移 4px；输入框偏移 2px。

## Components

- 图标按钮：灰色图标、透明底，悬停出现浅灰底；禁用时减淡。导航开关在桌面和手机均可用。
- 页码输入：居中显示当前页，旁列总数 202；错误时边框与说明变红。侧栏收起后仍可输入跳页。
- 缩略图导航：图像框为 80 × 112px，保持原图比例；当前项图像有 2px 蓝色描边、偏移 3px，页码同步变蓝。
- 加载失败：页内保留图像占位，显示简短错误和蓝字重试；跳转失败保留原阅读位置。

## Do's and Don'ts

- Do 沿用真实教材图像，保持正文可读。
- Do 保留键盘焦点、当前页和错误状态；宽度改变时保留阅读位置。
- Don't 增加额外信息、布局或装饰。
- Don't 将阅读区包装成卡片。
