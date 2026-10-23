# 索引记录约定

## 准备信息

脚本生成的 `manifest.json` 记录处理版本、PDF 哈希、总页数、选中页序，
以及每页图片和文本的相对路径、SHA-256、提取状态和工具警告。
这些信息由脚本维护；发现身份不符时重新准备，不手工改写哈希。

## index.jsonl

每个选中 PDF 页面一行 JSON，按 `physical_page` 升序排列。
准备脚本生成 `unreviewed` 草稿；查看页图后填写以下字段。

| 字段 | 含义 |
| --- | --- |
| `physical_page` | 从 1 开始的 PDF 页序；保留脚本生成值 |
| `document_sha256` | 原 PDF 的 SHA-256；保留脚本生成值 |
| `page_image_sha256` | 本页渲染图的 SHA-256；保留脚本生成值 |
| `review_state` | `unreviewed`、`reviewed` 或 `unresolved` |
| `printed_page` | 已核对的原样印刷页码字符串；否则为 `null` |
| `printed_page_state` | `verified`、`absent` 或 `unverified` |
| `headings` | 原页可见标题的字符串数组，无标题时为空 |
| `summary` | 页面主题和结构的简短描述 |
| `content_types` | 从 `text`、`formula`、`table`、`figure`、`other` 中选取 |
| `anchors` | 按阅读顺序排列的内容定位数组 |
| `issues` | 未核实信息或问题的字符串数组；无问题时为空 |

每个 anchor 有三个必填字符串：`kind` 为调用方选用的标签，
`label` 为可辨认的内容标签，`locator` 为页内位置描述。
保留教材的真实标签；下面只是格式示意，不是某本教材的索引结果：

```json
{"kind":"example","label":"例1","locator":"正文下半部，解答续于已核对的下一 PDF 页"}
```

`reviewed` 表示已查看页图，且摘要与定位内容有原页支持，不表示教学内容已审核。
`unverified` 页码保持 `null`，在 `issues` 说明原因；
`absent` 只用于已看到本页确实没有印刷页码的情况。

`unresolved` 页面至少有一个 issue；摘要、标题、内容类型和 anchors 保持空，
页码保持 `null` 和 `unverified`，避免把未确认内容作为索引结果使用。
检查器接受明确的缺口，同时报告它们；所有页面均被查看才报告
`all_pages_reviewed: true`，这不等于印刷页码均已核实。

摘要和 anchors 保存导航信息。全文、OCR、公式转写、坐标和补充解释
如有需要另存，并引用对应 PDF 哈希、PDF 页序和页图哈希。

## 范围与复用

`check` 使用 manifest 的选中页集合检查索引，缺页、重复或额外页均报错。
`scope: partial` 表示准备范围小于全书；`scope: full` 仅说明覆盖所有 PDF 页序。
同时查看 `unresolved_pages`，才能判断视觉核对是否完成。

分批准备的结果各自保留 manifest，分别运行检查，再按 PDF 哈希和页序合并。
合并时核对各批集合的并集是否覆盖约定范围，检查跨批重复和续页关系。
复制到其他机器后，使用原 PDF 与保留的图片和文本重新运行检查；
重新渲染产生不同哈希时，重新核对对应索引，不能只替换哈希。
