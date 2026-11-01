import { pathLink } from './links.ts';
import { validRect } from './anchors.ts';
import { originalLink } from './original-links.ts';
import type { InitialPackage, InitialAnchor } from './initial-package.ts';

type Relation = { locationId: string; label: string; purpose: string };
type Supplement = { id: string; locationId: string; related: Relation[] };
type Part = { page: number; sourceImageSha256?: string; region: { x: number; y: number; width: number; height: number } };
type Source = { content: { documentSha256: string; pageCount: number; supplements: Supplement[] }; locations: Record<string, Part & { additionalRegions?: Part[] }> };
export type ConvertedRelation = { sourceId: string; locationId: string; label: string; purpose: string; targets: string[]; anchors: InitialAnchor[]; problem?: string };

// Source IDs and exact location IDs are authoritative. Titles never select targets.
export function initialRelations(pack: InitialPackage): Map<string, ConvertedRelation[]> {
  const source = pack.source as Source;
  if (source.content?.documentSha256 !== pack.textbook || !Array.isArray(source.content.supplements) || !source.locations) throw new Error('初始关联来源不匹配。');
  const entries = new Set(pack.entries.map((entry) => entry.sourceId));
  const byLocation = new Map<string, string[]>();
  for (const note of source.content.supplements) byLocation.set(note.locationId, [...byLocation.get(note.locationId) ?? [], note.id]);
  return new Map(source.content.supplements.filter((note) => entries.has(note.id)).map((note) => [note.id, note.related.map((relation) => {
    const targets = byLocation.get(relation.locationId) ?? [];
    const location = source.locations[relation.locationId];
    const parts = location ? [location, ...location.additionalRegions ?? []] : [];
    const verified = parts.length > 0 && parts.every((part) => Number.isSafeInteger(part.page) && part.page > 0 && part.page <= source.content.pageCount && /^[a-f0-9]{64}$/.test(part.sourceImageSha256 ?? '') && part.region && validRect([part.region.x, part.region.y, part.region.width, part.region.height]));
    return { sourceId: note.id, ...relation, targets, anchors: verified ? parts.map((part) => ({ textbook: pack.textbook, pdf_page: part.page, rects: [[part.region.x, part.region.y, part.region.width, part.region.height]] })) : [], ...(!targets.length && !verified ? { problem: '原文位置未经核实，未生成精确跳转。' } : {}) };
  })]));
}
const markdownLabel = (value: string) => value.replace(/[\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
export function relationBody(relations: ConvertedRelation[], paths: Map<string, string | null>): string {
  if (!relations.length) return '';
  return '## 关联阅读\n\n' + relations.map((relation) => {
    const links = relation.targets.length ? relation.targets.map((id) => {
      const target = paths.get(id);
      return target ? pathLink(target, relation.label) : `${relation.label}（目标笔记缺失或身份不明，未链接）`;
    }).join('、') : relation.problem ? `${relation.label}（${relation.problem}）` : `[${markdownLabel(relation.label)}](${originalLink(relation.anchors)})`;
    return `- ${links}：${relation.purpose}\n`;
  }).join('') + '\n';
}
