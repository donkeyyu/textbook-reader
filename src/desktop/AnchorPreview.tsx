import type { Catalog } from '../../desktop/anchors';
import { resolveAnchor } from '../../desktop/anchors';
import { getTextbook } from '../textbook/library';
import { getPage } from '../textbook/catalog';

export function AnchorPreview({ anchor, catalog, onLocate }: { anchor: unknown; catalog: Catalog | null; onLocate?: () => void }) {
  const { target } = resolveAnchor(anchor, catalog);
  const textbook = target && getTextbook(target.textbook);
  const page = textbook && textbook.pages[target!.page - 1];
  if (!target?.rects.length || !page) return null;
  return <span className="anchor-previews">{target.rects.map(([x, y, width, height], index) => <span key={index} className="anchor-preview" role={onLocate ? "button" : "img"} tabIndex={onLocate ? 0 : undefined} onClick={onLocate} onKeyDown={(event) => { if (onLocate && ["Enter", " "].includes(event.key)) { event.preventDefault(); onLocate(); } }} aria-label={`文件第 ${target.page} 页区域 ${index + 1}`} style={{ aspectRatio: `${width * page.width} / ${height * page.height}` }}>
    <img src={getPage(target.page).image} alt="" loading="lazy" style={{ width: `${100 / width}%`, maxWidth: 'none', left: `${-x / width * 100}%`, top: `${-y / height * 100}%` }} />
  </span>)}</span>;
}
