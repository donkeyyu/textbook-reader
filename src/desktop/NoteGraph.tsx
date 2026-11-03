import type { Catalog } from '../../desktop/anchors';
import { useMemo, useRef, type ReactNode } from 'react';
import { LocateIcon } from '../ui/LocateIcon';
import type { LinkIndex } from '../../desktop/links';
import { projectNotes } from '../../desktop/note-projection';
import { useSupplementGraph } from '../reader/graph/useSupplementGraph';
import { Candidate } from './NoteLinks';
import '../reader/graph/graph.css';

export function NoteGraph({ catalog, index, selected, visible, onSelect, onSearch, controls, listOpen, onCloseList }: {
  controls?: ReactNode; listOpen: boolean; onCloseList: () => void;
  catalog: Catalog | null; index: LinkIndex; selected: string | null; visible: boolean;
  onSelect: (path: string | null) => boolean; onSearch: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const settings = useRef<HTMLDetailsElement>(null);
  const data = useMemo(() => projectNotes(index.entries), [index.entries]);
  const graph = useSupplementGraph(host, data.nodes, data.edges, selected, visible, onSelect, false);
  const selectedEntry = index.entries.find((entry) => entry.path === selected);
  return <section className="supplement-graph note-graph" hidden={!visible} aria-label="本地笔记知识图" data-node-count={data.nodes.length} data-edge-count={data.edges.length}>
    <div className="graph-viewport" ref={host} tabIndex={0} aria-label="本地笔记图画布" aria-describedby="note-graph-help" onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      const delta = event.shiftKey ? 100 : 40;
      if (event.key.startsWith('Arrow')) { event.preventDefault(); graph.pan(event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0, event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); graph.zoom(1.25); }
      else if (event.key === '-') { event.preventDefault(); graph.zoom(.8); }
      else if (event.key === '0') { event.preventDefault(); graph.fit(); }
      else if (event.key === '/') { event.preventDefault(); onSearch(); }
    }}>
      {graph.error && <p className="graph-error" role="alert">{graph.error}</p>}
      {!graph.ready && !graph.error && <p className="graph-error" role="status">正在打开本地笔记图…</p>}
      {graph.ready && !data.nodes.length && <p className="graph-error">笔记库还没有可读取的 Markdown 文件。</p>}
    </div>
    <div className="graph-corner-controls">
      <details className="graph-settings" ref={settings} onToggle={(event) => { if (event.currentTarget.open && listOpen) onCloseList(); }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
      }}>
        <summary aria-label="图谱设置" title="图谱设置">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="9" cy="7" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><circle cx="15" cy="17" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /></svg>
          <span>图谱设置</span>
        </summary>
        <div className="graph-settings-content">
          <div className="graph-footer"><span>{data.nodes.length} 篇笔记 · {data.edges.length} 条链接</span>
            <div className="graph-zoom" aria-label="图缩放">
              <button type="button" aria-label="缩小本地笔记图" title="缩小" onClick={() => graph.zoom(.8)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
              <output aria-label="本地笔记图缩放比例">{Math.round(graph.scale * 100)}%</output>
              <button type="button" aria-label="放大本地笔记图" title="放大" onClick={() => graph.zoom(1.25)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
              <button type="button" aria-label="显示全图" title="全图" onClick={graph.fit}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              {selected && <button type="button" aria-label="定位当前笔记" title="当前笔记" onClick={() => graph.focus(selected)}><LocateIcon /></button>}
            </div>
          </div>
          {selectedEntry && <div className="note-graph-current"><Candidate catalog={catalog} entry={selectedEntry} /></div>}
          <p>箭头表示已保存的笔记链接。可用搜索或笔记列表打开笔记。</p>
        </div>
      </details>
      {controls}
    </div>
    {(data.conflicts.size > 0 || index.problems.length > 0) && <div className="note-graph-problems" role="note">{data.conflicts.size > 0 && <p>{data.conflicts.size} 篇笔记存在 ID 冲突，按各自路径显示。请打开副本后修复身份。</p>}{index.problems.map((problem) => <p key={problem}>{problem}</p>)}</div>}
    <ul hidden className="graph-legend"><li data-supplement-type="personal" /></ul>
    <p id="note-graph-help" className="sr-only">点击节点打开同一篇本地笔记。拖动空白平移，滚轮缩放，拖动节点调整布局。方向键平移，加减键缩放，0 显示全图，斜线键搜索。</p>
  </section>;
}
