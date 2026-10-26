import { parser } from '@lezer/markdown';
import type { NodeRef } from '../../textbook/content.ts';

export type LinkToken = { from: number; to: number; label: string };
export type LinkBinding = LinkToken & { id: string; target: NodeRef };
export type LinkDocument = { markdown: string; bindings: readonly LinkBinding[] };

const protectedNodes = new Set(['CodeBlock', 'FencedCode', 'InlineCode', 'HTMLBlock', 'HTMLTag',
  'CommentBlock', 'ProcessingInstructionBlock', 'Image', 'Autolink']);
const escaped = (text: string, at: number) => {
  let slashes = 0;
  while (at > 0 && text[--at] === '\\') slashes++;
  return slashes % 2 !== 0;
};
const decodeLabel = (text: string) => text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');

/** Read syntax only. A matching title never grants a target identity. */
export function linkTokens(markdown: string): LinkToken[] {
  const protectedRanges: { from: number; to: number }[] = [];
  parser.parse(markdown).iterate({ enter(node) {
    if (!protectedNodes.has(node.name) && !(node.name === 'Link' && (node.node.getChild('URL') || node.node.getChild('LinkLabel')))) return;
    protectedRanges.push({ from: node.from, to: node.to });
    return false;
  } });
  const tokens: LinkToken[] = [];
  let protectedIndex = 0;
  for (let from = 0; from < markdown.length - 1; from++) {
    while (protectedRanges[protectedIndex] && protectedRanges[protectedIndex]!.to <= from) protectedIndex++;
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && protectedRange.from <= from) { from = protectedRange.to - 1; continue; }
    if (!markdown.startsWith('[[', from) || escaped(markdown, from) || escaped(markdown, from + 1)) continue;
    for (let end = from + 2; end < markdown.length; end++) {
      const char = markdown[end];
      if (char === '\n' || char === '\r' || (char === '[' && !escaped(markdown, end))) break;
      if (char !== ']' || escaped(markdown, end)) continue;
      if (markdown[end + 1] === ']') {
        const label = decodeLabel(markdown.slice(from + 2, end));
        const to = end + 2;
        if (label.trim() && (!protectedRange || protectedRange.from >= to)) tokens.push({ from, to, label });
        from = to - 1;
      }
      break;
    }
  }
  return tokens;
}

export function linkText(title: string): string {
  return `[[${title.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&')}]]`;
}

export function linkQuery(markdown: string, cursor: number): { from: number; to: number; query: string } | null {
  const closed = linkTokens(markdown).find((token) => cursor >= token.from + 2 && cursor <= token.to - 2);
  if (closed) return { from: closed.from, to: closed.to, query: closed.label };
  const from = markdown.slice(0, cursor).lastIndexOf('[[');
  if (from < 0) return null;
  // A temporary label also permits the empty [[ query. Parsing the whole
  // document keeps incomplete queries inside code/HTML out of the picker.
  const probe = `${markdown.slice(0, cursor)}x]]${markdown.slice(cursor)}`;
  const token = linkTokens(probe).find((item) => item.from === from && item.to === cursor + 3);
  return token ? { from, to: cursor, query: token.label.slice(0, -1) } : null;
}

export function sameTarget(a: NodeRef, b: NodeRef): boolean {
  return a.bookId === b.bookId && a.source === b.source && a.id === b.id;
}

export function validBindings(markdown: string, value: unknown, bookId?: string): value is LinkBinding[] {
  if (!Array.isArray(value)) return false;
  const tokens = linkTokens(markdown);
  const ids = new Set<string>();
  const ranges = new Set<number>();
  return value.every((binding: unknown) => {
    if (!binding || typeof binding !== 'object') return false;
    const item = binding as LinkBinding;
    const target = item.target;
    if (typeof item.id !== 'string' || !/^[\w-]+$/.test(item.id) || ids.has(item.id) ||
      !Number.isSafeInteger(item.from) || !Number.isSafeInteger(item.to) || ranges.has(item.from) ||
      typeof item.label !== 'string' || !target || typeof target !== 'object' ||
      typeof target.bookId !== 'string' || !target.bookId || (bookId !== undefined && target.bookId !== bookId) ||
      !['default', 'personal'].includes(target.source) || typeof target.id !== 'string' || !target.id.trim() ||
      !tokens.some((token) => token.from === item.from && token.to === item.to && token.label === item.label)) return false;
    ids.add(item.id);
    ranges.add(item.from);
    return true;
  });
}

/** Drop unsafe ranges, keeping missing targets as durable, visibly broken links. */
export function matchingBindings(markdown: string, bindings: readonly LinkBinding[]): LinkBinding[] {
  const tokens = linkTokens(markdown);
  return bindings.filter((binding) => tokens.some((token) =>
    token.from === binding.from && token.to === binding.to && token.label === binding.label));
}
