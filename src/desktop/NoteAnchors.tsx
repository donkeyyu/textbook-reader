import { useState, type ReactNode } from 'react';
import { anchorKey, anchorObject, changeAnchors, readAnchors, resolveAnchor, type AnchorTarget, type Catalog } from '../../desktop/anchors';
import { AnchorPreview } from './AnchorPreview';

export function NoteAnchors({ source, readOnly, catalog, onChange, onLocate, onSelect, catalogTools }: { catalogTools?: ReactNode; source: string; readOnly: boolean; catalog: Catalog | null; onChange: (source: string) => void; onLocate: (target: AnchorTarget) => void; onSelect: (index?: number) => void }) {
  const [error, setError] = useState('');
  let anchors: unknown, problem = '';
  try { anchors = readAnchors(source); } catch (cause) { problem = (cause as Error).message; }
  function mutate(operation: Parameters<typeof changeAnchors>[2]) {
    try { onChange(changeAnchors(source, anchorKey(anchors), operation)); setError(''); } catch (cause) { setError((cause as Error).message); }
  }
  const options = (value: unknown, choices: { id: string; title: string }[], grouped = false) => <><option value="">未设置</option>{value !== undefined && !choices.some((item) => item.id === value) && <option value={String(value)}>{String(value)}（未匹配）</option>}{grouped ? ['教材索引', '自定义目录'].map((label) => <optgroup label={label} key={label}>{choices.filter((entry) => ('source' in entry && entry.source === 'custom') === (label === '自定义目录')).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</optgroup>) : choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</>;
  return <section className="note-anchors" aria-label="笔记位置"><strong>笔记位置</strong>{catalogTools}
    {!catalog && <p role="note">当前教材目录不可用。原值已保留，请先添加教材。</p>}
    {problem ? <p role="note">{problem} 位置写入已暂停。</p> : <>
      {anchors !== undefined && !Array.isArray(anchors) && <p role="note">anchors 不是列表，原值已保留；请在源码中修复。</p>}
      {Array.isArray(anchors) && anchors.map((anchor, index) => {
        const item = anchorObject(anchor), resolved = resolveAnchor(anchor, catalog);
        const bookMatched = !!catalog && !!item && item.textbook === catalog.textbookId;
        return <details key={index} className="note-anchor"><summary>位置 {index + 1} · {bookMatched ? catalog?.title : <>未匹配教材 {item?.textbook !== undefined && <span>{String(item.textbook)}</span>}</>}{resolved.chapter ? ` · ${resolved.chapter.title}` : ''}{resolved.section ? ` · ${resolved.section.title}` : ''}{resolved.page ? ` · 文件第 ${resolved.page.page} 页${resolved.page.printedPage === null ? '' : `（印刷第 ${resolved.page.printedPage} 页）`}` : ' · 无有效页面'}{resolved.problems.length ? ' · 请核对' : ''}</summary>
          {resolved.target && <button type="button" onClick={() => onLocate(resolved.target!)}>定位位置 {index + 1}</button>}
          <AnchorPreview anchor={anchor} catalog={catalog} onLocate={resolved.target ? () => onLocate(resolved.target!) : undefined} />
          {resolved.problems.map((problem) => <p role="note" key={problem}>{problem}</p>)}
          {item && resolved.problems.length > 0 && <pre>{JSON.stringify(item, null, 2)}</pre>}
          {!item ? <pre>{JSON.stringify(anchor)}</pre> : readOnly ? null : <div className="anchor-fields">
            <label>教材<select aria-label={`位置 ${index + 1} 教材`} value={String(item.textbook ?? '')} onChange={(event) => mutate({ index, patch: { textbook: event.target.value || undefined } })}>{options(item.textbook, catalog ? [{ id: catalog.textbookId, title: catalog.title }] : [])}</select></label>
            <label>章<select aria-label={`位置 ${index + 1} 章`} disabled={!bookMatched} value={String(item.chapter ?? '')} onChange={(event) => mutate({ index, patch: { chapter: event.target.value || undefined } })}>{options(item.chapter, bookMatched ? catalog!.chapters : [], true)}</select></label>
            <label>节<select aria-label={`位置 ${index + 1} 节`} disabled={!resolved.chapter} value={String(item.section ?? '')} onChange={(event) => mutate({ index, patch: { section: event.target.value || undefined } })}>{options(item.section, resolved.chapter ? catalog!.sections.filter((entry) => entry.chapterId === resolved.chapter!.id) : [], true)}</select></label>
            <label>文件页<select aria-label={`位置 ${index + 1} 文件页`} disabled={!bookMatched} value={String(item.pdf_page ?? '')} onChange={(event) => mutate({ index, patch: { pdf_page: event.target.value ? Number(event.target.value) : undefined } })}>{options(item.pdf_page === undefined ? undefined : String(item.pdf_page), bookMatched ? catalog!.pages.map((page) => ({ id: String(page.page), title: `文件 ${page.page}${page.printedPage === null ? '' : ` · 印刷 ${page.printedPage}`}` })) : [])}</select></label>
            {resolved.target && <button type="button" onClick={() => onSelect(index)}>编辑位置 {index + 1} 区域</button>}
            {item.rects !== undefined && <button type="button" onClick={() => mutate({ index, patch: { rects: undefined } })}>移除位置 {index + 1} 区域</button>}
          </div>}
          {!readOnly && <button type="button" onClick={() => mutate({ index, remove: true })}>移除位置 {index + 1}</button>}
        </details>;
      })}
      {(anchors === undefined || Array.isArray(anchors) && !anchors.length) && <span>未设置位置</span>}
      {!readOnly && (anchors === undefined || Array.isArray(anchors)) && <div className="anchor-actions"><button onClick={() => mutate({ append: [{}] })}>添加位置</button><button disabled={!catalog} onClick={() => onSelect()}>从教材框选添加</button></div>}
    </>}{error && <p role="alert">{error}</p>}
  </section>;
}
