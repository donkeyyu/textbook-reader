# 第88页样板的五槽位推广 2026-10-30

## 范围与依据

- 依据：SPEC C2（2026-10-29 五槽位决定）、C3（LaTeX）、C5（题目覆盖）、R1（标题保留题号，不标页码）。
- 样板：PDF 第88页（印刷第81页）7 条重写，见 `docs/qa/supplement-review-examples-2026-10-29.md`。
- 推广范围：全书 6 章 971 条补充（逐题条目 666 条）。
- 本轮只调整写法与取舍，未新增教材事实；数学条件仍以 2026-10-25 至 2026-10-29 的原页核对为准。

## 本轮改动

| 槽位 | 处理 |
| --- | --- |
| 标题 | 问句和议题式标题改为陈述结论的句子；保留题号、节号与主题，不标页码；保持纯文本 |
| 气泡 | 压成一句（不超过 40 可见字符），直接回应当前疑问，不与正文首句重复 |
| 正文 | 原「知识」「注意事项」按理解顺序合成，每则 1–3 段；原文已讲清的内容不再复述 |
| 方法提示 | 仅题目引导条目保留，默认折叠；只写学生要做的判断与步骤，不代写答案 |
| 关联 | 收缩到 0–2 条；逐题条目至少保留 1 条已核对目标 |

逐章涉及条目数（与 `HEAD` 比较）：

| 章节 | 条数 | 标题 | 气泡 | 正文 | 关联 |
| --- | --- | --- | --- | --- | --- |
| 第一章 有理数 | 128 | 26 | 2 | 76 | 29 |
| 第二章 有理数的运算 | 247 | 76 | 65 | 175 | 5 |
| 第三章 代数式 | 111 | 39 | 9 | 73 | 24 |
| 第四章 整式的加减 | 109 | 45 | 2 | 75 | 16 |
| 第五章 一元一次方程 | 187 | 57 | 4 | 126 | 12 |
| 第六章 几何图形初步 | 189 | 56 | 6 | 118 | 12 |

`docs/qa/supplement-review-examples-2026-10-29.md` 提出的问题已处理：

- 第三章第88页 7 条按示例重写；粗算一条说明「接近不能保证每一步都对」。
- 第一章：`ch1-why-negative` 改为「与 0 ℃ 各差 3 ℃」，`ch1-growth-rate-question` 把零增长的判断交回学生，`ch1-exercise-1-1-4` 不再写成「两种电荷可以抵消」，章引盈亏与产量、练习水面与面粉质量、增长率的手机销量说明删除教材未给定的前提。
- 同类代答（章引盈亏、作物变化、水位练习、面粉质量练习、习题1.1第2题）改为只给符号约定与回读方法；作物、水位、面粉三处的遗留见下节「复审修正」。

## 已运行检查

- `node --experimental-strip-types scripts/check-supplement-rules.mjs`：971 条；`title-question`、`preview-long`、`preview-multi`、`preview-anaphora`、`body-missing`、`body-long`、`related-many`、`plain-math`、`relation-split`、`math-unbalanced` 均为 0。
- `npm test`：52 项通过，含五槽位结构、逐题覆盖与方法对应、第88页样板断言、公式定界符平衡。
- `npm run typecheck`、`npm run lint`：无警告与错误。
- `scripts/prepare-cloud-content.mjs` 可生成发布 SQL：971 个节点，修订号 `6ab92cb2…`。

## 发布

- 已通过 Supabase 管理连接把 971 条写入 `reader_books`，修订号 `6ab92cb2…`，节点数 971。
- 写入方式：云端已有的「知识／注意事项」按本轮规则在库内合成正文（627 条经 md5 与本地结果逐一核对一致），只另行传入本轮真正新写的 449 条字段（标题 299、气泡 88、正文 16、方法 5、关联 98）。
- `node --experimental-strip-types scripts/check-cloud-content.mjs`：`fullSourceEquality: true`，`anonymousPersonalRead: denied`。
- 临时用于写入的 3 个 `tmp_five_*` 函数已删除，库内无残留。

## 复审修正

`docs/qa/supplement-rereview-2026-10-30.md` 的 8 项意见已逐条修改，另按同一类句式粘连补修 2 处：

| 意见 | 处理 |
| --- | --- |
| 1 乘0后果写反 | `ch5-nonzero` 标题改为「两边乘0会抹掉原方程的限制」，正文保留可逆性解释。 |
| 2 练习给出不适用顺序 | `ch5-q-p131-practice1` 标题改为「练习1：移项集中同类项，再合并求解」，并删去正文重复的符号说明。 |
| 3 标题漏必要对象与条件 | `ch1-number-line-distance`、`ch1-absolute-zero`、`ch1-absolute-negative`、`ch2-product-negative-parity` 按建议补回条件或对象。 |
| 4 探究入口提前给结论 | `ch2-q-p38-subtract-inquiry` 标题改为「探究：用加法检验减法改写」；`ch2-q-p39-smaller-subtract-larger` 气泡改为「用数轴位置或加法检验，判断差的符号。」 |
| 5 同类代答未清完 | 章引作物题正文改为只给基准与符号约定，不再写出最终正负记录；`ch1-practice-p5-1` 气泡改为「先沿用题目给出的约定」；`ch1-practice-p5-2` 气泡与正文不再逐一给出三个记录的含义。 |
| 6 列表合并丢句界 | `ch6-q-p184-example4`、`ch6-q-p185-e2` 补齐句号；同句式扫描另补 `ch6-p183-complements-think`、`ch6-q-p185-e7`。 |
| 7 旁问依据留在折叠方法里 | `ch4-q-42-negative-product-question` 把结合律分组与系数来源写入正文，方法槽改为自行取 $y$ 值核对；不保留 `continuous`。 |
| 8 空格数量写错 | `ch1-practice-p5-1` 正文改为「所填的数表示水位变化了多少」。 |

复审列为后续精简项的 `ch3-same-letter-substitution` 两段重复表述也一并合并。

### 修正后的检查与发布

- `node --experimental-strip-types scripts/check-supplement-rules.mjs`：971 条，10 项报警仍为 0。
- `npm test` 52 项通过；`npm run typecheck`、`npm run lint` 无警告与错误。
- 只把这 17 条的差异字段写入 `reader_books`，修订号更新为 `79ac7d1b…`。
- `node --experimental-strip-types scripts/check-cloud-content.mjs`：`fullSourceEquality: true`，`anonymousPersonalRead: denied`。

## 未验证与遗留

- 尚无学生使用证据，学习效果仍属未验证。
- 正文改写以原「知识」「注意事项」为底稿，未对 971 条逐条重新推导数学结论；已改写的标题与正文仍按 2026-10-25 的原页核对负责。
- 未做浏览器回归；发布后已打开的阅读器页面需强刷才会取到新内容。
