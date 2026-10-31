import { MathText } from '../text/MathText';

// 七年级上册印刷第81页例4：同一个圆孔从完整三角形中扣除。
export function TriangleAreaDiagram() {
  return <figure className="area-diagram">
    <svg viewBox="0 0 352 82" role="img" aria-label="面积拆分示意：三角形面积减去圆孔面积，得到三角尺面积。图形不按比例绘制。">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M8 14V76H98Z" fill="#b9e2eb" />
        <circle cx="174" cy="55" r="13" fill="#f4d9e5" />
        <path d="M254 14V76H344Z M295 55a13 13 0 1 0-26 0a13 13 0 1 0 26 0Z" fill="#b9e2eb" fillRule="evenodd" />
        <path d="M121 48h14M216 44h14m-14 8h14" fill="none" strokeLinecap="round" />
      </g>
    </svg>
    <div className="area-diagram-labels" aria-hidden="true"><span>三角形面积</span><span>圆孔面积</span><span>三角尺面积</span></div>
    <figcaption><MathText text={String.raw`$S=\frac{1}{2}ab-\pi r^2$`} /></figcaption>
  </figure>;
}
