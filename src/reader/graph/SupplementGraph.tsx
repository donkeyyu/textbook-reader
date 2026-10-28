import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentNode, PublishedContent } from '../../textbook/content.ts';
import { getLocation } from '../../textbook/supplements.ts';
import { getPage, pageLabel } from '../../textbook/catalog.ts';
import { supplementTypes } from '../supplement-types.tsx';
import { LocateIcon } from '../LocateIcon';
import { projectGraph } from './project-graph.ts';
import { useSupplementGraph } from './useSupplementGraph.ts';
import { GraphPreview } from './GraphPreview.tsx';
import { GraphDirectory, DirectoryResize } from './GraphDirectory';
import type { PersonalReferenceEdge } from '../links/project-references.ts';
import './graph.css';

export function SupplementGraph({ searchTarget, nodes, personalEdges, selectedKey, visible, onSelect, bookVisible, onToggleBook, chapters, sections }: {
  searchTarget: { key: string } | null;
  nodes: ContentNode[]; selectedKey: string | null; visible: boolean;
  personalEdges: readonly PersonalReferenceEdge[];
  chapters: PublishedContent['chapters']; sections: PublishedContent['sections'];
  onSelect: (key: string | null, preserveFocus?: boolean) => boolean; bookVisible: boolean; onToggleBook: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const settings = useRef<HTMLDetailsElement>(null);
  function closeDirectory() {
    setDirectoryOpen(false);
    document.getElementById('graph-directory-toggle')?.focus({ preventScroll: true });
  }
  const data = useMemo(() => projectGraph(nodes, personalEdges), [nodes, personalEdges]);
  const searchKeys = useMemo(() => new Set<string>(), []);
  const graph = useSupplementGraph(host, data.nodes, data.edges, selectedKey, visible, onSelect, searchKeys);
  useEffect(() => { if (searchTarget) graph.focus(searchTarget.key); }, [searchTarget]);
  const previewNode = visible && graph.preview ? nodes.find((node) => node.key === graph.preview!.key) : null;
  function chooseDirectory(key: string) {
    if (onSelect(key, true)) graph.reveal(key);
  }
  return <section id="supplement-graph" className="supplement-graph" aria-label="补充节点图" hidden={!visible}
    data-node-count={nodes.length} data-edge-count={data.edges.length}
    data-default-edge-count={data.defaultEdges.length} data-personal-edge-count={personalEdges.length}>
    <div className="graph-viewport" ref={host} tabIndex={0} aria-label="节点图画布"
      aria-describedby="graph-help" onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const delta = event.shiftKey ? 100 : 40;
        if (event.key.startsWith('Arrow')) {
          event.preventDefault(); graph.pan(event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0,
            event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0);
        } else if (event.key === '+' || event.key === '=') { event.preventDefault(); graph.zoom(1.25); }
        else if (event.key === '-') { event.preventDefault(); graph.zoom(.8); }
        else if (event.key === '0') { event.preventDefault(); graph.fit(); }
        else if (event.key === '/') { event.preventDefault(); document.getElementById('graph-search-toggle')?.click(); }
      }}>
      {graph.error && <p className="graph-error" role="alert">{graph.error}</p>}
      {!graph.ready && !graph.error && <p className="graph-error" role="status">正在打开节点图…</p>}
      {graph.ready && nodes.length === 0 && <p className="graph-error">当前教材还没有补充节点。</p>}
    </div>
    {previewNode && graph.preview && <GraphPreview node={previewNode} anchor={graph.preview} />}
    <div className="graph-directory-dock" onKeyDown={(event) => {
      if (event.key === 'Escape' && directoryOpen) { event.preventDefault(); event.stopPropagation(); closeDirectory(); }
    }}>
      <button id="graph-directory-toggle" type="button" className="icon-button graph-floating-button"
        aria-label={directoryOpen ? '收起节点目录' : '展开节点目录'} title="节点目录"
        aria-expanded={directoryOpen} aria-controls="graph-directory" onClick={() => {
          if (directoryOpen) closeDirectory();
          else {
            if (settings.current) settings.current.open = false;
            setDirectoryOpen(true);
          }
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 5h14M5 12h3m4 0h7M5 19h3m4 0h7M5 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id="graph-directory" className="graph-directory-panel" aria-label="节点目录" hidden={!directoryOpen}>
        <GraphDirectory active={directoryOpen && visible} nodes={nodes} chapters={chapters} sections={sections} selectedKey={selectedKey} onChoose={chooseDirectory} />
        <DirectoryResize />
      </div>
    </div>
    <div className="graph-corner-controls">
      <details className="graph-settings" ref={settings} onToggle={(event) => {
        if (event.currentTarget.open) { setDirectoryOpen(false); }
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}>
        <summary aria-label="图谱设置" title="图谱设置">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="9" cy="7" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><circle cx="15" cy="17" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /></svg>
          <span>图谱设置</span>
        </summary>
        <div className="graph-settings-content">
          <div className="graph-footer">
            <span aria-live="polite">{nodes.length} 节点 · {data.defaultEdges.length} 默认关联 · {personalEdges.length} 个人连线</span>
            <div className="graph-zoom" aria-label="图缩放">
              <button type="button" aria-label="缩小节点图" title="缩小节点图" onClick={() => graph.zoom(.8)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
              <output aria-label="图缩放比例">{Math.round(graph.scale * 100)}%</output>
              <button type="button" aria-label="放大节点图" title="放大节点图" onClick={() => graph.zoom(1.25)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
              <button type="button" aria-label="显示全图" title="全图" onClick={graph.fit}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {selectedKey && <button type="button" aria-label="定位当前节点" title="当前节点" onClick={() => graph.focus(selectedKey)}><LocateIcon /></button>}
            </div>
          </div>
          <ul className="graph-legend" aria-label="节点类型">{Object.entries(supplementTypes).map(([type, label]) =>
            <li key={type} data-supplement-type={type}><span className="graph-legend-dot" aria-hidden="true" />{label}</li>)}</ul>
          <div className="graph-edge-legend" aria-label="连线类型">
            <span><svg width="28" height="14" viewBox="0 0 28 14" fill="none" aria-hidden="true"><path d="M1 7h24m-5-4 5 4-5 4" stroke="currentColor" strokeWidth="1.5" /></svg>默认关联</span>
            <span data-supplement-type="personal"><svg width="28" height="14" viewBox="0 0 28 14" fill="none" aria-hidden="true"><path d="M1 11Q14 0 27 11" stroke="currentColor" strokeWidth="1.5" /></svg>个人引用</span>
          </div>
        </div>
      </details>
      <button id="graph-book-toggle" className="icon-button graph-floating-button" type="button"
        aria-label={bookVisible ? "隐藏教材" : "显示教材"} title={bookVisible ? "隐藏教材" : "显示教材"}
        aria-controls="textbook-view" aria-pressed={bookVisible} onClick={onToggleBook}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </button>
    </div>
    <p id="graph-help" className="sr-only">点击空白取消选中并关闭解读，拖动空白平移，滚轮缩放，拖动节点调整位置。悬停突出直接关联，按住 Ctrl 悬停预览。画布聚焦时方向键平移，加减键缩放，0 查看全图，斜线键搜索。搜索后按向下键或 Tab 选择结果，Enter 打开解读。</p>
  </section>;
}

export function GraphRelated({ nodeKey, nodes, onSelect, onLocate }: {
  nodeKey: string; nodes: ContentNode[]; onSelect: (key: string) => boolean;
  onLocate: (locationId: string, focusId: string) => void;
}) {
  const { relations } = useMemo(() => projectGraph(nodes), [nodes]);
  const related = relations.get(nodeKey) ?? [];
  const sourceId = nodes.find((node) => node.key === nodeKey)?.id;
  if (!related.length) return null;
  return <div className="supplement-related graph-related" aria-label="默认教材关联">
    <h3>相关知识</h3>
    {related.map((relation, index) => <div className="related-entry" key={`${relation.locationId}-${index}`}>
      <p>{relation.purpose}</p>
      {relation.targets.length ? <>
        <p className="graph-relation-label">{relation.label}{relation.targets.length > 1 ? '（选择解读）' : ''}</p>
        {relation.targets.map((target) => <button key={target.key} type="button" className="text-button related-target"
          data-graph-target={target.key} onClick={() => onSelect(target.key)}>
          <span className="related-title">{target.title}</span><span className="related-page">{pageLabel(getPage(getLocation(relation.locationId).page))}</span>
          <svg className="graph-related-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>)}
      </> : <button type="button" id={`related-${sourceId}-${relation.locationId}`} className="text-button related-target"
        onClick={() => onLocate(relation.locationId, `related-${sourceId}-${relation.locationId}`)}>
        <span className="related-title">{relation.label}</span><span className="related-page">{pageLabel(getPage(getLocation(relation.locationId).page))}</span>
        <svg className="graph-related-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>}
    </div>)}
  </div>;
}
