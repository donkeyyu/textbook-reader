# 统一笔记与模式切换原型

日期：2026-11-01。工具：内置 image_gen。

参考 current-reader-reference.png（当前前端实拍）；产物 prototype-unified-note.png。

展示合并后的可编辑笔记、正文前的笔记位置、编辑／预览／实时预览，以及独立的文件头源码／属性预览。AI 初始版本云端备份不设同步或恢复入口。图片仅为静态设计提案，生成的教材文字、公式及源码片段不作为内容或格式验收依据。只读模式属性的具体外观为原型建议，仍待规格确定。

## 完整提示词

Use case: ui-mockup. Make a high-resolution Chinese product UI design board based STRICTLY on attached CURRENT FRONTEND SCREENSHOT. Preserve its cream paper, warm brown text, thin tan dividers, pale blue controls, lavender chapter navigation, existing global toolbar, actual textbook page visual. No invented new sidebar system. Board title “统一笔记 · 三种编辑模式”, subtle “基于现有阅读页的静态原型”.
Layout: one wide LARGE top screenshot (about 55% board height) showing textbook + unified note in LIVE PREVIEW; two lower medium screenshots of same note in SOURCE EDIT and READ ONLY PREVIEW. Top main screen: same global toolbar “数学 · 七年级上册”, 搜索, 知识图, plus notebook icon “笔记”, settings/filter, bookshelf and account. Remove dev preview banner. Left narrow actual chapter tree; middle reference textbook white page with blue “1.2 有理数及其大小比较”, matching highlighted yellow side note; mint rectangle resize handles. Center page navigation “14 / 202”. Right note panel about 48% of app width. NO tabs 解读/笔记, NO separate 我的笔记 area, NO AI chat, NO login prompt. AI-origin content is directly editable in this ONE note.
Right panel header: note title “小数也可以表示有理数”, icons locate, full screen, close. Immediately below a compact horizontal editor-mode segmented control exact labels “编辑 | 预览 | 实时预览”, selected “实时预览”. Then TOP metadata/frontmatter section label “文件属性”, with SMALL SEPARATE selector “源码 | 属性预览”, selected “属性预览”. In this top metadata section, prominent “笔记位置” row with dropdowns “数学 七年级上册”, “第一章 有理数”, “1.2 有理数及其大小比较”; second concise row “课本第 7 页 · 区域 1” with tiny region thumbnail and “＋ 添加位置”. User tags 数学 有理数 and “＋ 添加属性” below in compact rows. Internal IDs/timestamps hidden in visual form. Then a subtle divider and single borderless paper editor, short paragraph “有限小数可以写成分数，形式不同，数值相同。” Formula 0.25 = 25/100 = 1/4 rendered, pale mint callout heading “理解”, short prose, and inline [[分数与有理数]] with caret to show editing. Single flowing document not nested form cards. Place small board annotation outside screenshot “AI 提供初始内容，学生直接编辑同一篇笔记”.
Bottom left screenshot labelled “编辑 · 文件头源码”: same warm app, note-only full width, same title and mode selector “编辑 | 预览 | 实时预览” with 编辑 active. Header frontmatter selector “源码 | 属性预览” with 源码 active. Show readable monospaced YAML at very top of editable document, exactly:
---
_textbook:
  schema_version: 1
  id: "note-demo"
  anchors:
    - textbook: "math-g7-v1"
      pdf_page: 14
tags: [数学, 有理数]
---
Then raw Markdown '# 小数也可以表示有理数', '> [!explanation] 理解', '有限小数可以写成分数。', '[[分数与有理数]]'. Small outside annotation “正文模式与文件头展示独立切换”. This is a short visible source excerpt, not a complete schema.
Bottom right screenshot labelled “预览 · 只读阅读”: same title and same three-mode selector with 预览 active, compact top “笔记位置” breadcrumb “数学 七年级上册 › 第一章 › 课本第 7 页”, tags, then beautiful rendered note with formula, mint 理解 callout, rendered link. No caret, add-property controls, resize handles or editable dropdowns in read-only view. Show “展开教材” upper left so note returns to split view.
Whole board: high fidelity clean typography, generous readable spacing, controls consistent across states, no duplicated 解读/笔记 distinction anywhere, no secondary note editor, no cloud sync or restore buttons, no backup action, no AI regenerate button. Metadata is BEFORE body in ALL states. Distinguish the two switching groups with proximity and labels. Reference screenshot is authoritative visual anchor; do not copy old imaginary prototypes. Actual textbook text may be abbreviated but preserve page composition. Static proposal only.
