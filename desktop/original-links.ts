import { parser } from '@lezer/markdown';
import { resolveAnchor, type Catalog, type AnchorTarget } from './anchors.ts';
const prefix = 'textbook:';
export const originalLink = (anchors: unknown[]) => prefix + encodeURIComponent(JSON.stringify(anchors)).replace(/[()]/g, (character) => `%${character.charCodeAt(0).toString(16)}`);
export const isOriginalLink = (href: string) => href.startsWith(prefix);
export function originalHrefs(source: string): string[] {
  if (!source.includes(prefix)) return [];
  const hrefs = new Set<string>();
  parser.parse(source).iterate({ enter(node) {
    if (node.name !== 'URL' || !['Link', 'LinkReference'].includes(node.node.parent?.name ?? '')) return;
    const href = source.slice(node.from, node.to).replace(/^<|>$/g, '');
    if (isOriginalLink(href)) hrefs.add(href);
  } });
  return [...hrefs];
}
export function originalTargets(href: string, catalog: Catalog | null, onWarnings?: (problems: string[]) => void): AnchorTarget[] {
  if (!isOriginalLink(href)) throw new Error('教材原文入口无效。');
  if (!catalog) throw new Error('教材尚未下载或目录不可用，请先在书架添加对应版本；当前笔记已保留。');
  let anchors: unknown;
  try { anchors = JSON.parse(decodeURIComponent(href.slice(prefix.length))); } catch { throw new Error('教材原文位置无法读取，当前笔记已保留。'); }
  if (!Array.isArray(anchors) || !anchors.length) throw new Error('教材原文位置为空，当前笔记已保留。');
  const warnings: string[] = [];
  const targets = anchors.map((anchor) => {
    const result = resolveAnchor(anchor, catalog);
    if (!result.target) throw new Error(result.problems.join('；') || '教材原文位置无效。');
    warnings.push(...result.problems);
    return result.target;
  });
  onWarnings?.([...new Set(warnings)]);
  return targets;
}
