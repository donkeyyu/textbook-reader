---
name: 课本解读
description: Apple 风格的极简教材阅读界面；按现有实现记录。
colors:
  accent: '#0066cc'
  accent-soft: '#eaf3ff'
  accent-hover: '#0055ad'
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
  marker-count:
    fontSize: 10px
    lineHeight: 14px
  supplement-heading:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif
    fontSize: 20px
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
  icon: 10px
  popover: 12px
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
    width: 40px
    height: 40px
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
    width: 46px
    height: 36px
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
    padding: 32px 28px 40px
    width: clamp(350px, 29vw, 420px)
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

解读标题桌面为 20px、手机为 17px，字重 600、行高 1.5；正文为 15px、行高 1.95。预览文字为 14px、行高 1.7；关联目的为 13px、行高 1.7；关联按钮为 14px、行高 1.6，附属印刷页码为 12px。💡 桌面字号 22px、手机 20px，行高 1。手机返回按钮为 13px。

## Layout

工具栏桌面高 72px；601–760px 高 64px；不超过 600px 时分两行，高 104px，完整保留书名及页码操作。桌面左侧导航宽 152px，可由顶部图标按钮收起；收起后页码输入、总数及上下页操作移入工具栏。教材按 PDF 页序上下连续排列，最大宽 690px，页间距 32px。滚动时当前页码与缩略图选中项同步。各页按原图尺寸预留比例，避免图片加载改变页面位置。

宽度不超过 1000px 时，阅读区内边距为 24px。不超过 760px 时，导航默认收起，展开为 152px 浮动侧栏，跳页后关闭；阅读区内边距为 16px 12px（不超过 600px 时为 16px 8px）、页间距为 16px。手机工具栏保留页码输入及总数，上下页按钮放在展开的导航中。教材区填满工具栏下方的可用高度，独立连续滚动。

宽度超过 1100px 时，右侧解读栏宽 clamp(350px, 29vw, 420px)，独立滚动。761–1100px 时，解读位于教材下方，默认占可用高度的 45%；导航仍在左侧，避免三栏挤压教材。手机解读位于教材下方，默认使用可用区域的 45%，两区各自滚动。面板关闭后教材恢复原阅读宽度，并保留阅读位置。预览优先放在整张教材页外的留白处，宽 220–280px；右侧不足时使用左侧留白。两侧都不足时，预览在阅读区下方独立显示，保持教材宽度不变，不覆盖正文。预览高度受视口限制，内容过长时可滚动。

## Elevation & Depth

纸页、桌面导航与解读栏无阴影；窄屏浮动导航以轻阴影区分遮挡层。加载／错误提示与悬浮预览使用轻阴影，值见 sidecar 的 `extensions.shadows`。底部预览与手机下方解读使用 240ms 上滑淡入（14px），背景由 #dceaff 收敛到 #f4f8ff，保留 2px 蓝色上边线。只在出现或切换内容时播放一次；减少动态效果模式取消位移和透明度变化，仅保留 120ms 背景色反馈。

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

## 2026-10-25 补充编辑控件

阅读页沿用原有布局，补充标记改用同一笔画的 SVG：灯泡表示概念与性质、箭头表示方法与推理、清单表示题目引导、回转箭头表示回顾与探究、笔表示个人补充；合并入口使用组合图标和原有数量。工具栏“显示”提供复选框图例，“添加补充”进入原页框选。右栏承载 Markdown 编辑和预览，默认补充末尾提供个人笔记。个人内容保存在本浏览器；界面不再显示存储位置提示。表单复用蓝色焦点、系统字体、白底和细灰边框；手机继续使用下方解读面板。

Markdown 输入使用 CodeMirror 6，提供语法高亮、撤销／重做、自动换行和列表续写。切换预览保留编辑器与撤销历史，Tab 可移到后续控件。

## 2026-10-25 视觉精修

保留教材主导的极简阅读方向。白色导航与浅灰阅读底明确分区；当前缩略图和导航开关使用浅蓝选中态。工具栏“添加补充”使用次级灰色文字和透明底；筛选入口只显示调节图标，保留可访问名称。筛选项高 44px，图标和文字在左侧，无框勾号在右侧；底层仍使用原生复选框。鼠标移出筛选区域自动关闭，入口到面板间保留连续命中区域；触屏仍点击开关，Escape 关闭并将焦点返回入口。控件以 160ms 色彩变化响应操作，折叠箭头以 220ms 旋转反馈状态；桌面解读与筛选以短距离淡入出现。减少动态效果时取消位移、旋转与过渡，只保留原有下方面板的短暂色彩反馈。

本轮核验：1440px、768px、390px、320px 布局与截图；关联跳转和返回、折叠解读、导航开合、首末页跳转、越界提示、筛选键盘关闭、个人补充编辑入口。视觉检查不代表已获得设计奖项或已证明学习效果。

解读的隐藏操作放在对应解读标题之后，标为“隐藏此解读”，可访问名称包含解读标题，与个人笔记区分开。空笔记直接显示 Markdown 输入区；已有笔记显示内容并保留编辑入口。保存、预览与未保存内容保护继续有效。

页码默认以“当前页/总页数”文字按钮呈现，点击或键盘激活后变为选中当前数字的输入框。回车提交有效页码后恢复文字；无效页码保留输入与错误提示；Escape 或失焦取消编辑。导航展开和收起共用此行为。

合并标记悬停或聚焦时，按各条原始区域分别显示细框与浅蓝填充，不用一个大框覆盖多条内容。离开或 Escape 清除预览；展开待选时保留各条框，选择后只保留选中条目的定位。

编辑器不显示“笔记 Markdown”等重复标签；标签仅供辅助技术识别输入框，预览与保存放在输入区下方同一行，分别靠左和靠右。

上下分区时，解读区上边缘中央显示 36px 横线把手，触区 72×28px，固定在分界处，不随解读正文滚动。鼠标或触屏拖动调整面板高度，范围为可用高度的 20%–80%；方向键每次调整 5%，Home/End 到边界。关闭面板后重置为 45%；宽屏左右布局不显示此高度把手。调整仅更新布局比例，保留编辑器和草稿。

个人笔记标题下直接显示最小 100px 高的输入区；预览、保存与可选取消合并为底部一行。文本增多后输入区可增长并滚动，Markdown 预览和错误提示不省略。

笔记编辑态的“保存”位于“我的笔记”标题右侧；保存后显示 Markdown 内容，同一位置变为“编辑”。笔记不提供“预览／继续编辑”切换。个人补充编辑器维持原有预览流程。

笔记编辑时，取消与保存同放在标题行右侧，保存为最右侧按钮；底部不再显示操作按钮。

点击教材原页或阅读区空白可收起下方解读及底部预览。标记点击、框选和滚动保持原操作；未保存内容先确认，取消时保留面板与草稿。宽屏右侧解读不受此规则影响。
