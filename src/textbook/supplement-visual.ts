export type SupplementVisual =
  | { kind: 'triangle-area' | 'triangle-height' | 'area-unit' }
  | { kind: 'steps' | 'compare'; title: string; items: { label: string; math?: string; text: string }[]; caption: string }
  | { kind: 'number-line'; title: string; min: number; max: number; points: { value: number; label: string }[]; caption: string }
  | { kind: 'segment'; title: string; points: { position: number; label: string }[]; extend: 'none' | 'left' | 'right' | 'both'; caption: string };

export function isSupplementVisual(value: unknown): value is SupplementVisual {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const text = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
  if (typeof v.kind === 'string' && ['triangle-area', 'triangle-height', 'area-unit'].includes(v.kind)) return true;
  if (!text(v.title) || !text(v.caption)) return false;
  if (v.kind === 'steps' || v.kind === 'compare') {
    return Array.isArray(v.items) && v.items.length >= 2 && v.items.length <= 4 && v.items.every(
      (i) => i && text(i.label) && text(i.text) && (i.math === undefined || text(i.math)));
  }
  if (!Array.isArray(v.points) || v.points.length < 2 || v.points.length > 5) return false;
  if (v.kind === 'number-line') {
    const { min, max } = v;
    return typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max) && min < max &&
      v.points.every((p) => p && text(p.label) && Number.isFinite(p.value) && p.value >= min && p.value <= max) &&
      new Set(v.points.map((p) => p.value)).size === v.points.length;
  }
  if (v.kind === 'segment') {
    return typeof v.extend === 'string' && ['none', 'left', 'right', 'both'].includes(v.extend) && v.points.length <= 4 &&
      v.points.every((p, i, points) => p && text(p.label) && Number.isFinite(p.position) && p.position >= 0 && p.position <= 1 && (i === 0 || p.position > points[i - 1].position));
  }
  return false;
}
