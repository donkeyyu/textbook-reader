import { getTextbook } from '../textbook/library';
import { chapters, sections } from '../textbook/sections';
import { useEffect, useRef, useState } from 'react';
import { backlinks, linkPath, noteReferences, pathLink, resolveLink, type LinkEntry, type LinkIndex, type NoteReference } from '../../desktop/links';

function Candidate({ entry }: { entry: LinkEntry }) {
  return <><strong>{entry.path.slice(0, -3)}</strong>
    {entry.anchors.map((anchor, index) => {
      if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
      const item = anchor as Record<string, unknown>;
      if (typeof item.textbook !== 'string' || !item.textbook) return null;
      const textbook = getTextbook(item.textbook);
      if (!textbook) return <small key={index}>未核对的教材标识：{item.textbook} · 请按正文摘要区分</small>;
      const chapter = chapters.find((chapter) => chapter.id === item.chapter);
      const section = chapter && sections.find((section) => section.id === item.section && section.chapterId === chapter.id);
      const page = Number.isSafeInteger(item.pdf_page) && Number(item.pdf_page) > 0 ? textbook.pages[Number(item.pdf_page) - 1] : null;
      return <small key={index}>{textbook.title} · {textbook.edition}{chapter ? ` · ${chapter.title}` : ''}{section ? ` · ${section.title}` : ''}{page ? ` · 文件第 ${page.page} 页${page.printedPage === null ? '' : `（印刷第 ${page.printedPage} 页）`}` : ''}</small>;
    })}<small>{entry.summary || '无正文摘要'}</small>{entry.problem && <small>文件头有问题，属性关联尚未建立</small>}</>;
}

export function NoteLinks({ index, source, path, readOnly, request, onNavigate, onRepair, onCreate }: {
  index: LinkIndex; source: string; path: string; readOnly: boolean; request?: { reference: NoteReference; source: string; key: number };
  onNavigate: (path: string) => void; onRepair: (reference: NoteReference, replacement: string, expectedSource: string) => boolean; onCreate: (target: string, reference: NoteReference, replacement: string) => void;
}) {
  const references = noteReferences(source);
  const incoming = backlinks(path, index.entries);
  const [selected, setSelected] = useState<NoteReference | null>(null);
  const [selectedSource, setSelectedSource] = useState('');
  const [query, setQuery] = useState('');
  const [alias, setAlias] = useState('');
  const [repairError, setRepairError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  function choose(reference: NoteReference) { setRepairError(''); setSelectedSource(source); setSelected(reference); setQuery(reference.target); setAlias(reference.alias ?? reference.target); }
  useEffect(() => {
    if (request) { choose(request.reference); setSelectedSource(request.source); }
  }, [request]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  function close() { dialog.current?.close(); setSelected(null); }
  function open(reference: NoteReference) {
    const result = resolveLink(reference.target, index.entries);
    if (result.kind === 'resolved') onNavigate(result.candidates[0]!.path);
    else choose(reference);
  }
  const result = selected ? resolveLink(selected.target, index.entries) : null;
  const candidates = index.entries.filter((entry) => entry.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || entry.summary.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  let createPath = '';
  try { createPath = linkPath(query); } catch { /* Invalid paths never become create controls. */ }
  return <section className="note-links" aria-label="笔记关联">
    <details><summary>关联与反向引用 · {references.length} 处链接 · {incoming.length} 篇引用</summary>
      <div className="note-link-columns"><section><h2>当前内容中的链接</h2>
        {!references.length && <p>输入 [[ 搜索笔记。代码和标题、块级语法不建立关联。</p>}
        {references.map((reference, number) => {
          const result = resolveLink(reference.target, index.entries);
          return <div className="note-link-row" key={number}><button onClick={() => open(reference)}>{reference.alias ?? reference.target}<small>{reference.property ? `属性 ${reference.property.join(' / ')}` : '正文'} · {{ resolved: '可打开', ambiguous: '同名待选择', missing: '未找到', invalid: '路径无效' }[result.kind]}</small></button>
            {!readOnly && <button aria-label={`修复链接 ${number + 1}`} onClick={() => choose(reference)}>修复</button>}</div>;
        })}
      </section><section aria-label="已保存的反向引用"><h2>已保存的反向引用</h2><p>由磁盘内容重建，草稿不计入。</p>
        {incoming.map(({ entry, references }) => <button className="note-link-candidate" key={entry.path} onClick={() => onNavigate(entry.path)}><Candidate entry={entry} /><small>{references.length} 处引用</small></button>)}
        {!incoming.length && <p>尚无已保存的引用。</p>}
      </section></div>
      {index.problems.map((problem) => <p role="note" key={problem}>{problem}</p>)}
    </details>
    <dialog ref={dialog} className="vault-guard note-link-dialog" aria-label="选择笔记链接" onCancel={(event) => { event.preventDefault(); close(); }}>
      {selected && <><h2>{result?.kind === 'ambiguous' ? '同名笔记，请选择目标' : result?.kind === 'invalid' ? '链接路径无效' : '修复笔记链接'}</h2>
        <p>{selected.raw}{result?.kind === 'missing' ? ' · 未找到目标，尚未创建文件。' : ''}</p>
        <label>查找笔记<input aria-label="查找链接目标" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {!readOnly && <label>显示别名<input aria-label="链接显示别名" value={alias} onChange={(event) => setAlias(event.target.value)} /></label>}
        <div className="note-link-candidates">{(query === selected.target && result?.kind === 'ambiguous' ? result.candidates : candidates).map((entry) => <button className="note-link-candidate" key={entry.path} onClick={() => {
          if (readOnly) { onNavigate(entry.path); close(); }
          else if (onRepair(selected, pathLink(entry.path, alias || undefined), selectedSource)) close();
          else setRepairError('内容已改变，请取消后重新选择链接。');
        }}><Candidate entry={entry} /></button>)}{!candidates.length && result?.kind !== 'ambiguous' && <p>没有匹配笔记。可修改搜索文字以修复目标。</p>}</div>
        {repairError && <p role="alert">{repairError}</p>}
        <div><button onClick={close}>取消</button>{!readOnly && createPath && resolveLink(query, index.entries).kind === 'missing' && <button onClick={() => { if (onRepair(selected, pathLink(createPath, alias || undefined), selectedSource)) { onCreate(createPath, selected, pathLink(createPath, alias || undefined)); close(); } else setRepairError('内容已改变，请取消后重新选择链接。'); }}>创建“{createPath}”草稿</button>}</div>
      </>}
    </dialog>
  </section>;
}
