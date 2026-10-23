---
name: index-pdf-content
description: 为本地 PDF 建立可核对的内容索引，支持指定页范围或全书索引、标题与内容定位、逐页视觉核对及覆盖检查。用于教材等文档的内容索引；单次阅读、PDF 制作和排版检查使用 PDF skill。
---

# PDF 内容索引

将 PDF 页面整理成后续阅读、内容编写和定位可用的导航元数据。
页图负责核对，原生文本负责检索；索引摘要只描述主题与结构。

本技能从 research-kernel 的 `pdf-content-indexing` 提炼而来，保留来源绑定、
视觉核对和覆盖检查，移除财报词典、财务选页协议与内核依赖。

## 确定范围

从请求确定 PDF、索引目的和 PDF 页序范围。页序从 1 开始。
指定几页或一章时只承诺该范围；全书索引才使用全部页面。
扫描检索命中页得到的是候选集，不能据此声称其他页面没有相关内容。

处理教材时，读取 [教材索引](references/textbook.md)，
遵循项目已有的版本和来源记录。其他 PDF 可直接使用下述通用流程。

## 准备页面

脚本使用 Python 3.11+ 标准库。`pdfinfo`、`pdftoppm` 为必需工具，
`pdftotext` 可选；缺少它或提取失败时继续用页图，并记录文本不可用。
可复用本机或 Codex 提供的 Poppler，无需安装 research-kernel。

在仓库根目录运行；在其他项目使用时替换脚本路径：

```sh
python3 .agents/skills/index-pdf-content/scripts/pdf_index.py prepare \
  materials/textbooks/人教版-数学-七年级上册.pdf \
  /tmp/textbook-index-sample --pages 8-10
```

`--pages` 接受 `8-10,15` 或 `all`，均指 PDF 页序。
准备目录包含 `manifest.json`、`images/`、`text/` 和待填写的 `index.jsonl`。
脚本渲染指定页面，保留原生文本和工具警告，记录 PDF、图片、文本的 SHA-256。
它不会识别章节、公式或题目，也不会修改原 PDF。

已有准备目录先核对身份及文件：

```sh
python3 .agents/skills/index-pdf-content/scripts/pdf_index.py check \
  materials/textbooks/人教版-数学-七年级上册.pdf /tmp/textbook-index-sample
```

核对通过后可继续填写索引。PDF、页范围或处理版本不匹配时使用新目录；
文件丢失或损坏时重新准备受影响的工作范围，保留仍被下游引用的证据。

## 逐页建立索引

填写前读取 [索引记录约定](references/index-format.md)。
按 PDF 页序查看每一张范围内的页图，比较需要使用的原生文本，并填写 `index.jsonl`。

- 保留可见标题、编号和题号。摘要说明本页讲什么、有哪些结构。
- 以 `anchors` 记录需要再次找到的内容；标签和定位描述应足以回到原页。
  只有使用场景需要时才另行记录坐标。
- 对正文、公式、表格和插图分别识别。原生文本漏字、乱码或符号错误时以页图为准。
  OCR 或公式转写如有需要，另行保存并核对，不将其混入导航摘要。
- 已查看并可描述的页面标为 `reviewed`。无法核对的页面标为 `unresolved`，
  写明问题并清空未获支持的内容；保留其他页面的有效结果。

长文档可分批准备和查看，记录各批精确页集合。合并前核对 PDF 哈希，
检查重复、缺页和跨页内容的连续性。机器检查不能证明已经看过页图。

## 检查与交付

```sh
python3 .agents/skills/index-pdf-content/scripts/pdf_index.py check \
  materials/textbooks/人教版-数学-七年级上册.pdf /tmp/textbook-index-sample \
  --index /tmp/textbook-index-sample/index.jsonl
```

检查覆盖集合、来源及页图身份、记录状态和基本结构。
`unresolved` 可以作为明确的缺口交付；`unreviewed` 不能作为已完成记录。
公式、标题含义、定位准确性及印刷页码仍由原页核对。

交付索引路径、PDF 身份、实际页范围、未解决页和未核实事项。
将需要长期保留的 `manifest.json` 与索引放入项目指定资料目录，
保持图片和文本相对路径，或保留可重新核对的本地准备目录。
沿用项目对 PDF、页图与文本的保留规则；索引任务不包含公开分发教材。

这些字段是本技能的文件约定，不自动成为产品数据库或前端接口要求。
