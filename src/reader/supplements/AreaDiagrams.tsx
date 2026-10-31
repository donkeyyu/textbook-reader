import type { ComponentType } from 'react';
import { MathText } from '../text/MathText';

function TriangleAreaDiagram() {
  return <figure className="area-diagram" data-diagram="triangle-area">
    <svg viewBox="0 0 352 120" role="img" aria-label="面积拆分：两条直角边为a、b的三角形，减去半径为r的圆孔，得到三角尺。示意图不按比例绘制。">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M18 14V86H108Z" fill="var(--diagram-triangle)" />
        <path d="M18 76h10v10" fill="none" />
        <circle cx="174" cy="62" r="14" fill="var(--diagram-circle)" />
        <path d="M248 14V86H338Z M290 62a14 14 0 1 0-28 0a14 14 0 1 0 28 0Z" fill="var(--diagram-triangle)" fillRule="evenodd" />
        <path d="M174 62h14M119 54h14M214 50h14m-14 8h14" fill="none" strokeLinecap="round" />
        <circle cx="174" cy="62" r="1.5" fill="currentColor" />
      </g>
      <g fill="currentColor" fontSize="18" fontStyle="italic" textAnchor="middle">
        <text x="7" y="56">a</text><text x="63" y="106">b</text><text x="182" y="53">r</text>
      </g>
    </svg>
    <div className="area-diagram-terms">
      <div><span>三角形面积</span><MathText text={String.raw`$\frac{1}{2}ab$`} /></div>
      <div><span>圆孔面积</span><MathText text={String.raw`$\pi r^2$`} /></div>
      <div><span>三角尺面积</span><MathText text="$S$" /></div>
    </div>
    <figcaption><MathText text={String.raw`$S=\frac{1}{2}ab-\pi r^2$`} /></figcaption>
    <small>补充示意 · 不按实际尺寸比例绘制</small>
  </figure>;
}

function TriangleHeightDiagram() {
  return <figure className="area-diagram" data-diagram="triangle-height">
    <svg className="area-diagram-detail" viewBox="0 0 280 190" role="img" aria-label="两个全等直角三角形沿斜边拼成长方形，长为b、宽为a。斜线两侧各占面积的一半。">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M48 24V144H240Z" fill="var(--diagram-triangle)" />
        <path d="M48 24H240V144Z" fill="var(--diagram-copy)" />
        <path d="M48 132h12v12M228 24v12h12" fill="none" />
        <path d="M35 24v120m-4-120h8m-8 120h8M48 158h192m-192-4v8m192-8v8" fill="none" />
      </g>
      <g fill="currentColor" fontSize="18" textAnchor="middle">
        <text x="20" y="90" fontStyle="italic">a</text><text x="144" y="178" fontStyle="italic">b</text>
        <text x="94" y="115">原三角形</text><text x="191" y="62">另一块</text>
      </g>
    </svg>
    <div className="area-diagram-explanation">两块全等，沿斜边拼合；每块都占长方形的一半。</div>
    <figcaption><MathText text={String.raw`$S_{\text{三角形}}=\frac{ab}{2}=\frac{1}{2}ab$`} /></figcaption>
    <small>补充示意 · a 与 b 互相垂直</small>
  </figure>;
}

function AreaUnitDiagram() {
  return <figure className="area-diagram" data-diagram="area-unit">
    <svg className="area-diagram-detail" viewBox="0 0 280 226" role="img" aria-label="边长1厘米的正方形，每条边分为10个1毫米，共有10行、每行10个小方格。每格1平方毫米，共100平方毫米。">
      <rect x="64" y="36" width="160" height="160" fill="var(--diagram-triangle)" stroke="currentColor" strokeWidth="1.5" />
      <rect x="64" y="36" width="16" height="16" fill="var(--diagram-circle)" />
      <g stroke="currentColor" strokeWidth=".8" opacity=".6">
        {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${80 + i * 16} 36v160M64 ${52 + i * 16}h160`} />)}
      </g>
      <g stroke="currentColor" strokeWidth="1.3" fill="none">
        <path d="M64 24h160m-160-4v8m160-8v8M52 36v160m-4-160h8m-8 160h8" />
      </g>
      <g fill="currentColor" fontSize="15" textAnchor="middle">
        <text x="144" y="16">1 cm = 10 mm</text>
        <text transform="translate(36 130) rotate(-90)">10 mm</text>
        <text x="144" y="219">10 行 × 每行 10 格</text>
      </g>
    </svg>
    <div className="area-diagram-explanation"><MathText text={String.raw`每个小方格：$1\ \mathrm{mm}\times1\ \mathrm{mm}=1\ \mathrm{mm}^2$`} /></div>
    <figcaption><MathText text={String.raw`$1\ \mathrm{cm}^2=100\ \mathrm{mm}^2$`} /></figcaption>
    <small>补充用例 · 分格表示面积单位的换算</small>
  </figure>;
}

// 第88页的三个样板共用正文插图入口；未配置的条目保持纯正文。
const diagrams: Record<string, ComponentType> = {
  'ch3-q-p88-example4': TriangleAreaDiagram,
  'ch3-triangle-base-height': TriangleHeightDiagram,
  'ch3-area-value-unit': AreaUnitDiagram,
};

export function SupplementDiagram({ supplementId }: { supplementId: string }) {
  const Diagram = diagrams[supplementId];
  return Diagram ? <Diagram /> : null;
}
