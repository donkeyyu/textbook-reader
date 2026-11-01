import { parser } from '@lezer/markdown';

export function markdownBlocks(source: string, offset = 0) {
  const blocks: { from: number; to: number; source: string; type: string }[] = [];
  const cursor = parser.parse(source).cursor();
  if (cursor.firstChild()) do {
    blocks.push({ from: cursor.from + offset, to: cursor.to + offset, source: source.slice(cursor.from, cursor.to), type: cursor.name });
  } while (cursor.nextSibling());
  return blocks;
}

export function referenceDefinitions(source: string) {
  return markdownBlocks(source).filter((block) => block.type === 'LinkReference').map((block) => block.source).join('\n');
}

export function callout(source: string) {
  const match = /^>\s*\[!([\w-]+)\]([+-])?\s*([^\n]*)(?:\n|$)/.exec(source);
  if (!match) return null;
  return { type: match[1]!.toLowerCase(), fold: match[2], title: match[3]!.trim(),
    body: source.slice(match[0].length).replace(/^> ?/gm, '') };
}

// Markdown must not consume TeX punctuation. Code nodes and escaped dollars are
// literal and cannot pair with a delimiter outside their syntax boundary.
export function protectMath(source: string) {
  const formulas = new Map<string, { value: string; display: boolean }>();
  const ranges: { from: number; to: number }[] = [];
  parser.parse(source).iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'LinkReference', 'URL', 'LinkTitle'].includes(node.name)) ranges.push({ from: node.from, to: node.to });
  } });
  const marker = `textbook-math-${crypto.randomUUID()}-`;
  function protect(text: string) {
    const pattern = /\$\$((?:\\.|[^\\$])+?)\$\$|\\\[([\s\S]+?)\\\]|\$((?:\\.|[^\\$\n])+?)\$|\\\(([\s\S]+?)\\\)/g;
    let result = '', end = 0, match;
    while ((match = pattern.exec(text))) {
      let slashes = 0;
      for (let at = match.index - 1; at >= 0 && text[at] === '\\'; at--) slashes++;
      if (slashes % 2) { pattern.lastIndex = match.index + 1; continue; }
      const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
      if (!value.trim()) continue;
      const key = `${marker}${formulas.size}`;
      formulas.set(key, { value, display: match[1] !== undefined || match[2] !== undefined });
      result += text.slice(end, match.index) + `\`${key}\``;
      end = match.index + match[0].length;
    }
    return result + text.slice(end);
  }
  let rendered = '', end = 0;
  for (const range of ranges.sort((a, b) => a.from - b.from)) {
    if (range.from < end) continue;
    rendered += protect(source.slice(end, range.from)) + source.slice(range.from, range.to);
    end = range.to;
  }
  return { source: rendered + protect(source.slice(end)), formulas };
}

// Map stripped callout quote prefixes back to the original source. Wiki links
// cannot span lines, so each endpoint belongs to the same retained line.
export function calloutPosition(source: string, at: number) {
  let original = source.indexOf('\n') + 1, rendered = 0;
  for (const line of source.slice(original).split('\n')) {
    const prefix = /^> ?/.exec(line)?.[0].length ?? 0;
    const length = line.length - prefix;
    if (at <= rendered + length) return original + prefix + at - rendered;
    original += line.length + 1; rendered += length + 1;
  }
  return source.length;
}
