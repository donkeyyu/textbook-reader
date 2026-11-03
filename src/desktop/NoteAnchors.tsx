import { useState, type ReactNode } from 'react';
import { anchorKey, anchorObject, changeAnchors, readAnchors, resolveAnchor, type AnchorTarget, type Catalog } from '../../desktop/anchors';
import { LocateIcon } from '../ui/LocateIcon';

export function NoteAnchors({ source, readOnly, catalog, onChange, onLocate, onSelect, catalogTools }: { catalogTools?: ReactNode; source: string; readOnly: boolean; catalog: Catalog | null; onChange: (source: string) => void; onLocate: (target: AnchorTarget) => void; onSelect: (index?: number) => void }) {
  const [error, setError] = useState('');
  let anchors: unknown, problem = '';
  try { anchors = readAnchors(source); } catch (cause) { problem = (cause as Error).message; }
  function mutate(operation: Parameters<typeof changeAnchors>[2]) {
    try { onChange(changeAnchors(source, anchorKey(anchors), operation)); setError(''); } catch (cause) { setError((cause as Error).message); }
  }
  const options = (value: unknown, choices: { id: string; title: string }[], grouped = false) => <><option value="">未设置</option>{value !== undefined && !choices.some((item) => item.id === value) && <option value={String(value)}>{String(value)}（未匹配）</option>}{grouped ? ['教材索引', '自定义目录'].map((label) => <optgroup label={label} key={label}>{choices.filter((entry) => ('source' in entry && entry.source === 'custom') === (label === '自定义目录')).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</optgroup>) : choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</>;
  return <section className="note-anchors" aria-label="笔记位置">
    {!catalog && <p role="note">当前教材目录不可用。原值已保留，请先添加教材。</p>}
    {!problem && <>
      {anchors !== undefined && !Array.isArray(anchors) && <p role="note">位置数据格式无效，原值已保留；请在文件头源码中修复。</p>}
      {Array.isArray(anchors) && anchors.map((anchor, index) => {
        const item = anchorObject(anchor), resolved = resolveAnchor(anchor, catalog);
        const bookMatched = !!catalog && !!item && item.textbook === catalog.textbookId;
        const location = [bookMatched ? catalog!.title : '教材未匹配', resolved.section?.title ?? resolved.chapter?.title,
          resolved.page ? resolved.page.printedPage === null ? `文件第 ${resolved.page.page} 页` : `第 ${resolved.page.printedPage} 页` : undefined].filter(Boolean).join(' · ');
        return <div key={index} className="note-anchor">
          <div className="anchor-location-row">
            {resolved.target ? <button className="anchor-location" type="button" title={`定位原文：${location}`} aria-label={`定位位置 ${index + 1}：${location}`} onClick={() => onLocate(resolved.target!)}><LocateIcon /><span>{location}</span></button> : <span className="anchor-location">{location}</span>}
            {!readOnly && resolved.target && <button className="anchor-edit-region" type="button" aria-label={`编辑位置 ${index + 1} 区域`} onClick={() => onSelect(index)}>调整框选</button>}
          </div>
          {resolved.problems.length > 0 && <p role="note">此位置需核对，原值已保留。请展开位置详情核对。</p>}
          <details className="anchor-settings"><summary>{readOnly ? '位置详情' : '修改位置'}</summary>
          {resolved.problems.map((problem) => <p role="note" key={problem}>{problem}</p>)}
          {!item ? <p>此位置无法编辑，请在文件头源码中修复。</p> : readOnly ? <p>{[resolved.chapter?.title, resolved.section?.title, resolved.page && `文件第 ${resolved.page.page} 页`].filter(Boolean).join(' · ') || '没有有效的章节或页面'}</p> : <div className="anchor-fields">
            <label>教材<select aria-label={`位置 ${index + 1} 教材`} value={String(item.textbook ?? '')} onChange={(event) => mutate({ index, patch: { textbook: event.target.value || undefined } })}>{options(item.textbook, catalog ? [{ id: catalog.textbookId, title: catalog.title }] : [])}</select></label>
            <label>章<select aria-label={`位置 ${index + 1} 章`} disabled={!bookMatched} value={String(item.chapter ?? '')} onChange={(event) => mutate({ index, patch: { chapter: event.target.value || undefined } })}>{options(item.chapter, bookMatched ? catalog!.chapters : [], true)}</select></label>
            <label>节<select aria-label={`位置 ${index + 1} 节`} disabled={!resolved.chapter} value={String(item.section ?? '')} onChange={(event) => mutate({ index, patch: { section: event.target.value || undefined } })}>{options(item.section, resolved.chapter ? catalog!.sections.filter((entry) => entry.chapterId === resolved.chapter!.id) : [], true)}</select></label>
            <label>文件页<select aria-label={`位置 ${index + 1} 文件页`} disabled={!bookMatched} value={String(item.pdf_page ?? '')} onChange={(event) => mutate({ index, patch: { pdf_page: event.target.value ? Number(event.target.value) : undefined } })}>{options(item.pdf_page === undefined ? undefined : String(item.pdf_page), bookMatched ? catalog!.pages.map((page) => ({ id: String(page.page), title: `文件 ${page.page}${page.printedPage === null ? '' : ` · 印刷 ${page.printedPage}`}` })) : [])}</select></label>
            {item.rects !== undefined && <button type="button" onClick={() => mutate({ index, patch: { rects: undefined } })} aria-label={`移除位置 ${index + 1} 区域`}>移除框选</button>}
          </div>}
          {!readOnly && <button type="button" onClick={() => mutate({ index, remove: true })} aria-label={`移除位置 ${index + 1}`}>移除位置</button>}
          </details>
        </div>;
      })}
      {(anchors === undefined || Array.isArray(anchors) && !anchors.length) && <span className="anchor-empty">未关联教材位置</span>}
      {!readOnly && (anchors === undefined || Array.isArray(anchors)) && <details className="anchor-add"><summary>添加位置</summary><div className="anchor-actions"><button disabled={!catalog} onClick={() => onSelect()}>从教材框选添加</button><button onClick={() => mutate({ append: [catalog ? { textbook: catalog.textbookId } : {}] })}>手动添加位置</button>{catalogTools}</div></details>}
    </>}{problem && <p role="alert">位置暂不可用，请修复文件头格式。</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
