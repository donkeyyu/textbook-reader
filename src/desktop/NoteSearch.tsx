import { useMemo, useRef, useState } from 'react';
import type { LinkEntry } from '../../desktop/links';
import { searchNotes } from '../../desktop/note-projection';
import { Candidate } from './NoteLinks';

export function NoteSearch({ entries, disabled, onOpen }: { entries: LinkEntry[]; disabled: boolean; onOpen: (path: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchNotes(entries, query), [entries, query]);
  function close() { setOpen(false); toggle.current?.focus(); }
  return <div className="note-search" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown' && event.target === input.current) { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('.note-search-results button')?.focus(); }
  }}>
    <button ref={toggle} disabled={disabled} aria-expanded={open} onClick={() => { setOpen(!open); }}>搜索笔记</button>
    {open && <div className="note-search-panel" role="search" aria-label="搜索已保存笔记">
      <label>名称、正文或标签<input ref={input} autoFocus type="search" aria-label="搜索本地笔记" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} /></label>
      <p role="status">{query.trim() ? `${results.length} 篇已保存笔记` : '输入文字搜索已保存内容，草稿不计入。'}</p>
      <div className="note-search-results" aria-label="本地搜索结果">{results.slice(0, limit).map((entry) => <button key={entry.path} className="note-link-candidate" disabled={disabled} onClick={() => { close(); void onOpen(entry.path); }}><Candidate entry={entry} />{entry.tags.length > 0 && <small>标签：{entry.tags.join(' · ')}</small>}</button>)}</div>
      {results.length > limit && <button onClick={() => setLimit(limit + 60)}>显示更多结果</button>}
      <button onClick={close}>收起搜索</button>
    </div>}
  </div>;
}
