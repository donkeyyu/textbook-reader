import type { Catalog } from '../../desktop/anchors';
import { useMemo, useRef } from 'react';
import type { LinkIndex } from '../../desktop/links';
import { projectNotes } from '../../desktop/note-projection';
import { useSupplementGraph } from '../reader/graph/useSupplementGraph';
import { Candidate } from './NoteLinks';
import '../reader/graph/graph.css';

export function NoteGraph({ catalog, index, selected, visible, onSelect, onSearch }: {
  catalog: Catalog | null; index: LinkIndex; selected: string | null; visible: boolean;
  onSelect: (path: string | null) => boolean; onSearch: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
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
    <details className="note-graph-settings"><summary>图谱设置</summary><div>
      <p>{data.nodes.length} 篇笔记 · {data.edges.length} 条已解析链接</p>
      {selectedEntry && <div className="note-graph-current"><Candidate catalog={catalog} entry={selectedEntry} /></div>}
      <div className="note-graph-zoom"><button aria-label="缩小本地笔记图" onClick={() => graph.zoom(.8)}>−</button><output aria-label="本地笔记图缩放比例">{Math.round(graph.scale * 100)}%</output><button aria-label="放大本地笔记图" onClick={() => graph.zoom(1.25)}>+</button><button onClick={graph.fit}>显示全图</button>{selected && <button onClick={() => graph.focus(selected)}>定位当前笔记</button>}</div>
      <p>箭头表示已保存的笔记链接。使用搜索或左侧列表，可用键盘打开每篇笔记。</p>
    </div></details>
    {(data.conflicts.size > 0 || index.problems.length > 0) && <div className="note-graph-problems" role="note">{data.conflicts.size > 0 && <p>{data.conflicts.size} 篇笔记存在 ID 冲突，按各自路径显示。请打开副本后修复身份。</p>}{index.problems.map((problem) => <p key={problem}>{problem}</p>)}</div>}
    <ul hidden className="graph-legend"><li data-supplement-type="personal" /></ul>
    <p id="note-graph-help" className="sr-only">点击节点打开同一篇本地笔记。拖动空白平移，滚轮缩放，拖动节点调整布局。方向键平移，加减键缩放，0 显示全图，斜线键搜索。</p>
  </section>;
}
