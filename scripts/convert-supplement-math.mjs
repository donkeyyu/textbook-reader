// 把补充内容里用 Unicode 字符写出的算式改写为 LaTeX 行内公式 $…$，由 MathJax 渲染。
// 只处理实际呈现给学生的字段（气泡 preview、正文、逐题清单）；标题保持纯文本，关联说明没有公式渲染。
// 默认只打印改动供核对，加 --write 才写回章节 JSON；每段新公式都会先过一遍 MathJax 渲染校验。
// 用法：node --experimental-strip-types scripts/convert-supplement-math.mjs [--chapter=第一章] [--spans] [--write]
import { readFile, writeFile } from 'node:fs/promises';
import { chapterSources } from '../src/textbook/chapters.ts';
import { loadMath, renderMath } from '../src/reader/text/math.ts';

const args = process.argv.slice(2);
const write = args.includes('--write');
const spansOnly = args.includes('--spans');
const only = args.find((value) => value.startsWith('--chapter='))?.split('=')[1];

const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n' };
const SUBSCRIPT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const GREEK = { 'π': '\\pi', 'θ': '\\theta', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'λ': '\\lambda', 'μ': '\\mu', 'ω': '\\omega' };
const OPERATOR = { '×': '\\times', '÷': '\\div', '·': '\\cdot', '−': '-', '∶': ':', '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '±': '\\pm', '＋': '+' };
// 多字母单位按字面认；单字母单位 m、s、g、h、t、L 也可能是变量，看后面那段规则怎么判。
const UNIT_WORDS = new Set(['mm', 'cm', 'dm', 'km', 'kg', 'mg', 'min', 'mL', 'kW', 'kWh', 'hm']);
const UNIT_LETTERS = new Set(['m', 's', 'g', 'h', 't', 'L']);
// 关系符号与运算符：整段成不了算式时按它们切开，左右两边的符号段各自判断。
const RELATION = /^[=×÷·−+∶≈≠≤≥<>]$/;
// 不是算式的固定写法：图号、页码、课程标识、钟点、单元格地址。
const FIGURE = /^\d+(?:\.\d+)+-\d+$/;
const LABEL = /^[A-Za-z]{2,}-\d+$/;

const MATH_CHAR = new RegExp('[0-9A-Za-z.' + Object.keys(SUPERSCRIPT).join('') + Object.keys(SUBSCRIPT).join('') + Object.keys(GREEK).join('') + '\\-−+＋×÷·=<>≤≥≠≈±∶:^|()\\[\\]{}\\/°′″℃%∠ ]');
const MARK_OPEN = '\uE000';
const MARK_MID = '\uE001';
const MARK_CLOSE = '\uE002';

const isMathChar = (char) => char !== undefined && MATH_CHAR.test(char);

/** 分数写成 \frac：分母分子都是单个数字、字母或括号组，单位比值（km/h）保持原样。 */
function foldFractions(text) {
  const unit = (part) => UNIT_WORDS.has(part) || UNIT_LETTERS.has(part) || (part.length > 1 && /[a-z]/.test(part) && !/[0-9]/.test(part));
  const build = (whole, numerator, denominator) => {
    if (unit(numerator) && unit(denominator)) return whole;
    return `${MARK_OPEN}${numerator}${MARK_MID}${denominator}${MARK_CLOSE}`;
  };
  const patterns = [
    [/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, build],
    [/\(([^()]+)\)\s*\/\s*([A-Za-z0-9.]+)/g, build],
    [/([A-Za-z0-9.]+)\s*\/\s*\(([^()]+)\)/g, build],
    [/([0-9][0-9.]*[A-Za-z]?|[A-Za-z]+)\s*\/\s*([0-9][0-9.]*|[A-Za-z]+)/g, build],
  ];
  let out = text;
  for (let round = 0; round < 3; round++) {
    let next = out;
    for (const [pattern, replace] of patterns) next = next.replace(pattern, replace);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 一段算式 → TeX 记号；记号单独成项，方便把上标、度数、百分号贴到前一项上。 */
function tokenize(text) {
  const tokens = [];
  let index = 0;
  const push = (kind, tex) => tokens.push({ kind, tex });
  while (index < text.length) {
    const char = text[index];
    const rest = text.slice(index);
    if (char === MARK_OPEN) {
      const parts = rest.slice(1).split(MARK_CLOSE);
      const [numerator, denominator] = parts[0].split(MARK_MID);
      push('atom', `\\frac{${joinTokens(tokenize(numerator))}}{${joinTokens(tokenize(denominator))}}`);
      index += 1 + parts[0].length + 1;
      continue;
    }
    if (char === ' ') { push('space', ' '); index++; continue; }
    if (/\d/.test(char)) {
      const match = /^\d+(?:\.\d+)?/.exec(rest);
      push('number', match[0]);
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      const match = /^[A-Za-z]+/.exec(rest);
      const word = match[0];
      // m、s、g、h、t、L 既是单位又能作变量：前面有空格、或同一段里已经出现过单位时才当单位读（5 t、km/h），
      // “5t”“320t”这种紧贴数字的写法按变量处理。
      const spaced = tokens.at(-1)?.kind === 'space';
      const sawUnit = tokens.some((token) => token.kind === 'unit');
      const isUnit = UNIT_WORDS.has(word) || (word.length === 1 && UNIT_LETTERS.has(word) && (spaced || sawUnit));
      push(isUnit ? 'unit' : 'letters', isUnit ? `\\mathrm{${word}}` : word);
      index += word.length;
      continue;
    }
    if (GREEK[char]) { push('atom', GREEK[char]); index++; continue; }
    if (SUPERSCRIPT[char]) { push('superscript', SUPERSCRIPT[char]); index++; continue; }
    if (SUBSCRIPT[char]) { push('subscript', SUBSCRIPT[char]); index++; continue; }
    if (char === '°') {
      const unit = char === '°' && /^°[CF]/.test(rest) ? `^\\circ\\mathrm{${rest[1]}}` : null;
      push('degree', unit ?? '^\\circ');
      index += unit ? 2 : 1;
      continue;
    }
    if (char === '′') { push('atom', "'"); index++; continue; }
    if (char === '″') { push('atom', "''"); index++; continue; }
    if (char === '℃') { push('celsius', '^\\circ\\mathrm{C}'); index++; continue; }
    if (char === '%') { push('percent', '\\%'); index++; continue; }
    if (char === '∠') { push('atom', '\\angle '); index++; continue; }
    if (OPERATOR[char]) { push('operator', OPERATOR[char]); index++; continue; }
    if ('=<>+-()[]|{}'.includes(char)) { push('operator', char); index++; continue; }
    if (char === '/') { push('operator', '/'); index++; continue; }
    if (char === '^') { push('operator', '^'); index++; continue; }
    push('atom', char); index++;
  }
  return tokens;
}

/** 记号连成 TeX：上标、下标、度数、百分号贴到前一项；数与单位之间留一个空格。 */
function joinTokens(tokens) {
  let out = '';
  // 控制词后面紧跟字母会被读成另一个命令：\divn 要写成 \div n。
  const emit = (tex) => {
    if (/^[a-zA-Z]/.test(tex) && /\\[a-zA-Z]+$/.test(out)) out += ' ';
    out += tex;
  };
  let previous = null;
  for (const token of tokens) {
    if (token.kind === 'space') continue;
    const attach = /^(number|letters|unit)$/.test(previous?.kind ?? '');
    if (token.kind === 'superscript') { emit(`^{${token.tex}}`); previous = token; continue; }
    if (token.kind === 'subscript') { emit(`_{${token.tex}}`); previous = token; continue; }
    if (token.kind === 'degree' || token.kind === 'percent') { emit(token.tex); previous = token; continue; }
    if (token.kind === 'celsius') {
      if (attach) out += '\\ ';
      emit(token.tex);
      previous = token;
      continue;
    }
    if (previous?.kind === 'degree' && token.kind === 'number') out += '\\,';
    if (previous?.kind === 'atom' && /^'+$/.test(previous.tex) && token.kind === 'number') out += '\\,';
    // 数与单位之间留空格（400 m）；数内部的千位空格保持（4 600）。
    if (attach && (token.kind === 'unit' || (token.kind === 'number' && previous.kind === 'number'))) out += '\\ ';
    emit(token.tex);
    previous = token;
  }
  return out.replace(/\\,$/, '').trim();
}

/** 一个候选算式是否该包成公式：纯数字、图号、课程代号、悬空运算符都保持文字。 */
function worthConverting(candidate) {
  const text = candidate.trim();
  if (!text) return false;
  if (/^[\d.]+$/.test(text)) return false;
  if (/^\d{1,2}:\d{2}$/.test(text)) return false;
  if (/^[A-Z]\d+$/.test(text) || /^[A-Z]{2,}\d+$/.test(text)) return false;
  if (FIGURE.test(text) || LABEL.test(text)) return false;
  if (/^\(\d+\)$/.test(text)) return false;
  if (!/[0-9A-Za-zπθαβ°℃%]/.test(text)) return false;
  if (/[=×÷·∶<>\-−+±≈/^]$/.test(text)) return false;
  if (/^[=×÷·∶<>≤≥/]/.test(text)) return false;
  // 括号在汉字处被截断（2×(长+宽) 里的 2×( ）说明这个算式还没读完，整段留给正文。
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) return false;
  }
  if (depth !== 0) return false;
  return true;
}

/**
 * 整段成不了算式（汉字关系带出前导运算符、括号被汉字截断）时，按关系符号和运算符切开，
 * 只把其中真正的符号段排成公式：π× → $\pi$×，=360°÷n → =360°÷$n$。运算符留在正文。
 */
function wrapSegments(candidate) {
  return candidate
    .split(/([=×÷·−+∶≈≠≤≥<>])/)
    .map((part) => (part.length === 1 && RELATION.test(part)
      ? part
      : worthConverting(part) ? `$${joinTokens(tokenize(foldFractions(part))).trim()}$` : part))
    .join('');
}

/**
 * 只转换成段的符号算式和量。汉字写出的关系（长×宽、平均数=总量÷份数）整段保持文字：
 * 汉字不进公式，关系符号和运算符也不从这些句子里拆出来单独排版。
 * 但关系里出现的符号本身还是公式字符：圆面积=π×半径 里的 π、每份角度=360°÷n 里的 360° 和 n
 * 照样写成公式，不让希腊字母、度数、上下标留在正文的字体里。
 */
function convertText(text) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    if (!isMathChar(text[index])) { out += text[index]; index++; continue; }
    let end = index;
    while (end < text.length && isMathChar(text[end])) end++;
    const candidate = text.slice(index, end).trim();
    // 候选两侧是否紧贴汉字（含全角括号），用来判断单独符号该不该留作正文。
    const cjkPrev = /[\u4e00-\u9fff（）]/.test(text[index - 1] ?? '');
    const cjkNext = /[\u4e00-\u9fff（）]/.test(text[end] ?? '');
    // 引号里单独讨论的符号（如“−”“÷2”）也写成公式。
    const lone = /^[±+\-−×÷·≈≠≤≥∶°′″∠]$/.test(candidate);
    const quoted = text[index - 1] === '“' && text[end] === '”';
    // 正文里单独提到的比较号、角号（不相等时用≠表示、记作∠A）没有自己的算式上下文，仍当符号排版。
    const dangling = /^[±≈≠≤≥∠]$/.test(candidate) && (cjkPrev || cjkNext);
    const convert = worthConverting(candidate) || (quoted && (lone || /[=×÷·−+±≠≤≥∶≈]/.test(candidate))) || dangling;
    out += convert ? `$${joinTokens(tokenize(foldFractions(candidate))).trim()}$` : wrapSegments(candidate);
    index = end;
  }
  return out;
}

/** 已有公式原样保留，只处理公式外的文字。 */
function convertField(text) {
  const pieces = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/);
  return pieces.map((piece, order) => (order % 2 === 1 ? piece : convertText(piece))).join('');
}

const fieldsOf = (note) => [note.preview, ...note.paragraphs,
  ...(note.questionGuide?.knowledgePoints ?? []), ...(note.questionGuide?.method ?? []),
  ...(note.questionGuide?.cautions ?? [])];

const before = chapterSources.map(({ chapter }) => chapter.supplements.map((note) => fieldsOf(note)));
const after = before.map((notes) => notes.map((fields) => fields.map(convertField)));

const pairs = new Map();
let changedFields = 0;
let changedNotes = 0;
before.forEach((notes, chapter) => notes.forEach((fields, note) => {
  let dirty = false;
  fields.forEach((field, order) => {
    const next = after[chapter][note][order];
    if (next === field) return;
    dirty = true;
    changedFields++;
    if (spansOnly) {
      for (const match of next.matchAll(/\$[^$]+\$/g)) {
        if (!pairs.has(match[0])) pairs.set(match[0], field);
      }
    } else {
      console.log(`\n[${chapterSources[chapter].chapter.chapter}] ${chapterSources[chapter].chapter.supplements[note].id} #${order}`);
      console.log(`  前：${field}`);
      console.log(`  后：${next}`);
    }
  });
  if (dirty) changedNotes++;
}));

const produced = new Set();
for (const notes of after) for (const fields of notes) for (const field of fields) {
  for (const match of field.matchAll(/\$([^$]+)\$/g)) produced.add(match[1]);
}

if (spansOnly) {
  console.log(`\n新公式 ${produced.size} 条（唯一），涉及 ${changedNotes} 条补充、${changedFields} 个字段`);
  for (const [span, field] of pairs) console.log(span, '   ←  ', field.slice(0, 46));
}

await loadMath();
const broken = [];
for (const tex of produced) {
  if (/[\u4e00-\u9fff]/.test(tex)) broken.push(`含汉字 ${tex}`);
  const html = renderMath(tex);
  if (typeof html !== 'string' || /merror|data-mjx-error/.test(html)) broken.push(`渲染失败 ${tex}`);
}
const unbalanced = after.flat(2).filter((field) => field.split('$').length % 2 === 0);
const glued = after.flat(2).filter((field) => /\$\$/.test(field));
console.log(`\n改动 ${changedNotes} 条补充、${changedFields} 个字段；新公式 ${produced.size} 条`);
console.log(broken.length ? `校验问题 ${broken.length}：\n  ${broken.slice(0, 40).join('\n  ')}` : '校验通过：无汉字公式、全部可渲染、$ 成对');
if (unbalanced.length) console.log(`$ 不成对的字段 ${unbalanced.length} 个`);
if (glued.length) console.log(`相邻公式粘成 $$ 的字段 ${glued.length} 个：${glued.slice(0, 5).join(' | ')}`);

if (write) {
  if (broken.length || unbalanced.length || glued.length) {
    console.log('校验未通过，未写回。');
    process.exitCode = 1;
  } else {
    for (const [index, { chapter }] of chapterSources.entries()) {
      if (only && !chapter.chapter.includes(only)) continue;
      if (!before[index].some((fields, note) => fields.some((field, order) => field !== after[index][note][order]))) continue;
      const path = new URL(`../content/grade-7-volume-1/chapter-${index + 1}.json`, import.meta.url);
      const data = JSON.parse(await readFile(path, 'utf8'));
      data.supplements.forEach((note, noteIndex) => {
        const fields = fieldsOf(note);
        let cursor = 0;
        const take = () => after[index][noteIndex][cursor++];
        note.preview = take();
        note.paragraphs = note.paragraphs.map(() => take());
        if (note.questionGuide) {
          if (note.questionGuide.knowledgePoints) note.questionGuide.knowledgePoints = note.questionGuide.knowledgePoints.map(() => take());
          note.questionGuide.method = note.questionGuide.method.map(() => take());
          if (note.questionGuide.cautions) note.questionGuide.cautions = note.questionGuide.cautions.map(() => take());
        }
        if (fields.length !== cursor) throw new Error(`字段数不一致：${note.id}`);
      });
      await writeFile(path, `${JSON.stringify(data, null, 2).replace(/\n/g, '\r\n')}\r\n`);
      console.log(`写回 ${chapter.chapter}`);
    }
  }
}
