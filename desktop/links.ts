import { parser } from '@lezer/markdown';
import { isMap, isScalar, isSeq } from 'yaml';
import { parse } from './format.ts';
import { notePath } from './note-path.ts';

export type WikiLink = { from: number; to: number; raw: string; target: string; alias?: string };
export type NoteReference = WikiLink & { property?: (string | number)[] };
export type LinkEntry = { path: string; references: NoteReference[]; summary: string; anchors: unknown[]; problem?: string };
export type LinkIndex = { entries: LinkEntry[]; problems: string[] };
export type LinkResolution = { kind: 'resolved' | 'ambiguous' | 'missing' | 'invalid'; candidates: LinkEntry[] };
const escaped = (text: string, at: number) => {
  let count = 0;
  while (at > 0 && text[--at] === '\\') count++;
  return count % 2 === 1;
};
const decode = (text: string) => text.replace(/\\([[\]|#^\\])/g, '$1');
const encode = (text: string) => text.replace(/[[\]|#^\\]/g, '\\$&');

export function linkPath(target: string) {
  if (/[. ]$/.test(target)) throw new Error('路径末尾不能有空格或点。');
  if (/\.md$/i.test(target) && !target.endsWith('.md')) throw new Error('仅支持小写 .md 扩展名。');
  const path = target.endsWith('.md') ? target : `${target}.md`;
  notePath(path);
  return path;
}

// Ranges are in the supplied Markdown string, never in rendered text.
export function wikiLinks(source: string): WikiLink[] {
  const excluded: { from: number; to: number }[] = [];
  const definitions = new Set<string>();
  const label = (text: string) => text.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  parser.parse(source).iterate({ enter(node) {
    if (node.name === 'LinkReference') {
      const reference = /^\s*\[([^\]]+)\]:/.exec(source.slice(node.from, node.to));
      if (reference) definitions.add(label(reference[1]!));
    }
    const ordinaryLink = node.name === 'Link' && !(source[node.from - 1] === '[' && source[node.to] === ']');
    if (ordinaryLink || ['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'CommentBlock', 'Comment', 'ProcessingInstruction', 'Image', 'LinkReference', 'Autolink'].includes(node.name)) {
      excluded.push({ from: node.from, to: node.to }); return false;
    }
  } });
  // Lezer marks unresolved shortcut labels as Link nodes. A nested [[...]]
  // can therefore hide its surrounding ordinary Markdown link from that tree.
  // Track balanced labels as well, without reading brackets inside code/HTML.
  const openings: number[] = [];
  for (let at = 0; at < source.length; at++) {
    const literal = excluded.find((range) => at >= range.from && at < range.to);
    if (literal) { at = literal.to - 1; continue; }
    if (escaped(source, at)) continue;
    if (source[at] === '[') openings.push(at);
    else if (source[at] === ']' && openings.length) {
      const from = openings.pop()!;
      if (source[at + 1] === '(') {
        let depth = 1, end = at + 2;
        for (; end < source.length && depth; end++) if (!escaped(source, end)) {
          if (source[end] === '(') depth++;
          if (source[end] === ')') depth--;
        }
        if (!depth) excluded.push({ from, to: end });
      } else if (source[at + 1] === '[') {
        const end = source.indexOf(']', at + 2);
        if (end >= 0 && !source.slice(at + 2, end).includes('[') && definitions.has(label(source.slice(at + 2, end) || source.slice(from + 1, at)))) excluded.push({ from, to: end + 1 });
      }
    }
  }
  const pattern = /\[\[((?:\\.|[^\]\\\n])+)\]\]/g;
  const brackets = [...source.matchAll(pattern)].map((match) => ({ from: match.index, to: match.index + match[0].length }));
  // TeX can contain double brackets too. Respect code boundaries when pairing
  // math delimiters, so a dollar inside a code span cannot hide later links.
  let boundary = 0;
  for (const range of [...excluded, { from: source.length, to: source.length }].sort((a, b) => a.from - b.from)) {
    if (range.from < boundary) continue;
    const text = source.slice(boundary, range.from);
    const math = /\$\$((?:\\.|[^\\$])+?)\$\$|\\\[(?!\[)([\s\S]+?)\\\]|\$((?:\\.|[^\\$\n])+?)\$|\\\(([\s\S]+?)\\\)/g;
    for (const match of text.matchAll(math)) if (!escaped(text, match.index) && !brackets.some((bracket) => boundary + match.index >= bracket.from && boundary + match.index < bracket.to)) excluded.push({ from: boundary + match.index, to: boundary + match.index + match[0].length });
    boundary = range.to;
  }
  const links: WikiLink[] = [];
  for (const match of source.matchAll(pattern)) {
    const from = match.index, raw = match[0], to = from + raw.length;
    if (escaped(source, from) || excluded.some((range) => from < range.to && to > range.from)) continue;
    const text = match[1]!;
    let divider = -1, unsupported = false;
    for (let at = 0; at < text.length; at++) {
      if (escaped(text, at)) continue;
      if (text[at] === '|' && divider < 0) divider = at;
      else if (divider < 0 && ['#', '^', '['].includes(text[at]!)) unsupported = true;
    }
    if (unsupported) continue;
    const target = decode(divider < 0 ? text : text.slice(0, divider));
    const alias = divider < 0 ? undefined : decode(text.slice(divider + 1));
    if (target) links.push({ from, to, raw, target, alias });
  }
  return links;
}

export function noteReferences(source: string): NoteReference[] {
  // Body links remain readable while a YAML draft is invalid; no invalid header
  // is used to invent property relationships.
  const start = /^(?:\uFEFF)?---\r?\n/.exec(source);
  const end = start && /^(?:---|\.\.\.)\r?$(?:\n)?/m.exec(source.slice(start[0].length));
  const offset = start ? end ? start[0].length + end.index + end[0].length : source.length : 0;
  const links: NoteReference[] = wikiLinks(source.slice(offset)).map((item) => ({ ...item, from: item.from + offset, to: item.to + offset }));
  try {
    const { doc } = parse(source);
    function visit(node: unknown, property: (string | number)[]) {
      if (isScalar(node) && typeof node.value === 'string') links.push(...wikiLinks(node.value).map((item) => ({ ...item, property })));
      else if (isSeq(node)) node.items.forEach((item, index) => visit(item, [...property, index]));
      else if (isMap(node)) for (const pair of node.items) if (isScalar(pair.key) && (typeof pair.key.value === 'string' || typeof pair.key.value === 'number')) visit(pair.value, [...property, pair.key.value]);
    }
    if (isMap(doc.contents)) for (const pair of doc.contents.items) if (isScalar(pair.key) && typeof pair.key.value === 'string' && pair.key.value !== '_textbook') visit(pair.value, [pair.key.value]);
  } catch { /* Invalid YAML stays in the editor, without property relations. */ }
  return links;
}

export function linkEntry(path: string, source: string): LinkEntry {
  let body = source, anchors: unknown[] = [], problem: string | undefined;
  try { const data = parse(source); body = data.body; anchors = Array.isArray(data.data._textbook?.anchors) ? data.data._textbook.anchors : []; }
  catch (cause) { problem = (cause as Error).message; }
  return { path, references: noteReferences(source), anchors, summary: body.replace(/[`#>*_[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180), problem };
}

export function resolveLink(target: string, entries: LinkEntry[]): LinkResolution {
  let path: string;
  try { path = linkPath(target).normalize('NFC'); }
  catch { return { kind: 'invalid', candidates: [] }; }
  const explicit = target.includes('/') || target.endsWith('.md');
  const candidates = entries.filter((entry) => (explicit ? entry.path : entry.path.split('/').at(-1)!).normalize('NFC') === path);
  return { kind: candidates.length === 1 ? 'resolved' : candidates.length ? 'ambiguous' : 'missing', candidates };
}

export function pathLink(path: string, alias?: string) {
  notePath(path);
  return `[[${encode(path)}${alias === undefined ? '' : `|${encode(alias)}`}]]`;
}

// Used by candidate repair and available to rename/move (09). Callers resolve
// against the pre-operation index; this function never guesses an identity.
// For a batch, replace body ranges descending first, then ranges descending in
// each property string: serializing YAML can move absolute body offsets.
export function replaceReference(source: string, reference: NoteReference, replacement: string, expectedSource?: string) {
  if (expectedSource !== undefined && source !== expectedSource) throw new Error('内容已改变，请重新选择链接。');
  if (!reference.property) {
    if (source.slice(reference.from, reference.to) !== reference.raw) throw new Error('链接已改变，请重新选择。');
    return source.slice(0, reference.from) + replacement + source.slice(reference.to);
  }
  const parsed = parse(source);
  const scalar = parsed.doc.getIn(reference.property, true);
  if (!isScalar(scalar) || typeof scalar.value !== 'string' || scalar.value.slice(reference.from, reference.to) !== reference.raw) throw new Error('属性链接已改变，请重新选择。');
  scalar.value = scalar.value.slice(0, reference.from) + replacement + scalar.value.slice(reference.to);
  return `${parsed.prefix}---${parsed.newline}${parsed.doc.toString({ lineWidth: 0 }).replace(/\n/g, parsed.newline)}---${parsed.newline}${parsed.body}`;
}

export function backlinks(path: string, entries: LinkEntry[]) {
  return entries.flatMap((entry) => {
    const references = entry.references.filter((reference) => {
      const result = resolveLink(reference.target, entries);
      return result.kind === 'resolved' && result.candidates[0]!.path === path;
    });
    return references.length ? [{ entry, references }] : [];
  });
}
