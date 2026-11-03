import type { Supplement } from '../../textbook/supplements';
import type { SupplementVisual } from '../../textbook/supplement-visual';
import { MathText } from '../text/MathText';
import { AreaUnitDiagram, TriangleAreaDiagram, TriangleHeightDiagram } from './AreaDiagrams';

// 已发布的旧版三条内容没有 visual 字段，保留原有图示，直到内容版本更新。
const legacyVisuals: Record<string, SupplementVisual> = {
  'ch3-q-p88-example4': { kind: 'triangle-area' },
  'ch3-triangle-base-height': { kind: 'triangle-height' },
  'ch3-area-value-unit': { kind: 'area-unit' },
};

export function SupplementDiagram({ note }: { note: Supplement }) {
  const visual = note.visual ?? legacyVisuals[note.id];
  if (!visual) return null;
  if (visual.kind === 'triangle-area') return <TriangleAreaDiagram />;
  if (visual.kind === 'triangle-height') return <TriangleHeightDiagram />;
  if (visual.kind === 'area-unit') return <AreaUnitDiagram />;
  if (!('title' in visual)) return null;
  return <figure className={`supplement-visual supplement-visual-${visual.kind}`} data-diagram={visual.kind}>
    <div className="supplement-visual-title"><MathText text={visual.title} /></div>
    {'items' in visual && <ol className="supplement-visual-items">
      {visual.items.map((item, index) => <li key={index}>
        <div className="supplement-visual-label"><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><MathText text={item.label} /></div>
        {item.math && <div className="supplement-visual-math"><MathText text={item.math} /></div>}
        <div className="supplement-visual-text"><MathText text={item.text} /></div>
      </li>)}
    </ol>}
    {visual.kind === 'number-line' && <>
      <svg viewBox="0 0 320 100" role="img" aria-label={`${visual.title}：${visual.points.map((p) => `${p.label}，位置${p.value}`).join('；')}。向右增大。`}>
        <path d="M20 50H302l-7-4m7 4-7 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {visual.points.map((point, index) => {
          const x = 36 + (point.value - visual.min) / (visual.max - visual.min) * 248;
          return <g key={point.value}>
            <path d={`M${x} 45v10`} stroke="currentColor" />
            <circle cx={x} cy="50" r="4" fill="currentColor" />
            <text x={x} y={index % 2 ? 82 : 28} textAnchor="middle" fill="currentColor" fontSize="20">{point.label}</text>
          </g>;
        })}
      </svg>
      <div className="supplement-visual-direction">数轴向右，数值增大</div>
    </>}
    {visual.kind === 'segment' && <svg viewBox="0 0 320 100" role="img" aria-label={`${visual.title}。从左到右：${visual.points.map((p) => p.label).join('、')}。${visual.extend === 'none' ? '不延长' : visual.extend === 'both' ? '向两侧延长' : visual.extend === 'left' ? '向左延长' : '向右延长'}。`}>
      <path d={`M${60 + visual.points[0]!.position * 200} 48H${60 + visual.points.at(-1)!.position * 200}`} stroke="currentColor" strokeWidth="2" />
      {(visual.extend === 'left' || visual.extend === 'both') && <>
        <path d={`M20 48H${60 + visual.points[0]!.position * 200}`} stroke="currentColor" strokeDasharray="5 4" />
        <path d="m27 44-7 4 7 4" fill="none" stroke="currentColor" />
      </>}
      {(visual.extend === 'right' || visual.extend === 'both') && <>
        <path d={`M${60 + visual.points.at(-1)!.position * 200} 48H300`} stroke="currentColor" strokeDasharray="5 4" />
        <path d="m293 44 7 4-7 4" fill="none" stroke="currentColor" />
      </>}
      {visual.points.map((p) => <g key={p.position}><circle cx={60 + p.position * 200} cy="48" r="3" fill="currentColor" /><text x={60 + p.position * 200} y="77" textAnchor="middle" fill="currentColor" fontSize="20">{p.label}</text></g>)}
    </svg>}
    <figcaption><MathText text={visual.caption} /></figcaption>
  </figure>;
}
