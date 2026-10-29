// 按五槽位与公式规则盘点全书补充条目，供逐章修订排期；不修改任何内容。
// 用法：node --experimental-strip-types scripts/check-supplement-rules.mjs [--list] [--chapter=3]
import { chapterSources } from '../src/textbook/chapters.ts';

const args = process.argv.slice(2);
const list = args.includes('--list');
const only = args.find((value) => value.startsWith('--chapter='))?.split('=')[1];

const visible = (text) => text.replace(/\$[^$]*\$/g, '■');
// 正文里还留着没进 $…$ 的公式字符：π、度数、上下标、单位之类。汉字关系里的 =、×、÷ 按约定仍作正文，不算在内。
const flaggedBare = /[πθαβ°′″∠℃≈²³¹⁰⁴⁵‰ⁿᵃ∶]|cm2|cm3|m2|m3/;
// 汉字关系被拆成一个个运算符公式：长$×$宽。引号里单独讨论的符号（“$-$”）不在此列。
// 只看真正的公式段，避免把 $360^\circ$÷$n$ 里夹在中间的那个运算符当成公式。
const spansOf = (field) => field.split(/(\$[^$]*\$)/).filter((_, order) => order % 2 === 1);
const operatorSpan = /^\$[=×÷·−+±≈≠≤≥∶]\$$/;
const withoutQuotes = (field) => field.replace(/“[^”]*”/g, '“”');
// 实际交给 MathJax 渲染的字段：气泡、正文、逐题清单。关系说明与标题是纯文本，不算在内。
const rendered = (note) => [note.preview, ...note.paragraphs, ...(note.questionGuide?.knowledgePoints ?? []),
  ...(note.questionGuide?.method ?? []), ...(note.questionGuide?.cautions ?? [])];
const rules = {
  'title-question': (note) => /[？?]/.test(note.title),
  'preview-long': (note) => visible(note.preview).length > 40,
  'preview-multi': (note) => (note.preview.match(/。/g) ?? []).length > 1,
  'preview-anaphora': (note) => /两块|它们|该式|上述|这个值|此处|这一点|这两个|前面/.test(visible(note.preview)),
  'body-missing': (note) => note.paragraphs.length === 0,
  'body-long': (note) => note.paragraphs.length > 3,
  'related-many': (note) => note.related.length > 2,
  'plain-math': (note) => rendered(note).some((field) => flaggedBare.test(visible(field))),
  'relation-split': (note) => rendered(note).some((field) => spansOf(withoutQuotes(field)).some((span) => operatorSpan.test(span))),
  'math-unbalanced': (note) => rendered(note).some((field) => field.split('$').length % 2 === 0),
};

const rows = [];
for (const { chapter } of chapterSources) {
  if (only && !chapter.chapter.includes(only)) continue;
  const notes = chapter.supplements;
  const counts = Object.fromEntries(Object.entries(rules).map(([name, test]) => [name, notes.filter(test).length]));
  rows.push({ chapter: chapter.chapter, notes: notes.length, guides: notes.filter((note) => note.questionGuide).length, counts });
  if (list) {
    for (const note of notes) {
      const hits = Object.entries(rules).filter(([, test]) => test(note)).map(([name]) => name);
      if (hits.length) console.log(`${chapter.chapter}\t${note.id}\t${hits.join(',')}\t${visible(note.preview).slice(0, 40)}`);
    }
  }
}

const names = Object.keys(rules);
console.log(`\n${'章节'.padEnd(22)}${'条数'.padStart(6)}${'逐题'.padStart(6)}${names.map((name) => name.padStart(19)).join('')}`);
for (const row of rows) {
  console.log(`${row.chapter.padEnd(20)}${String(row.notes).padStart(8)}${String(row.guides).padStart(8)}${names.map((name) => String(row.counts[name]).padStart(19)).join('')}`);
}
const total = rows.reduce((sum, row) => sum + row.notes, 0);
console.log(`\n合计 ${total} 条；${names.map((name) => `${name} ${rows.reduce((sum, row) => sum + row.counts[name], 0)}`).join('，')}`);
