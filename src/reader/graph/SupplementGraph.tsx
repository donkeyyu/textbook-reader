import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentNode, PublishedContent } from '../../textbook/content.ts';
import { getLocation } from '../../textbook/supplements.ts';
import { getPage, pageLabel } from '../../textbook/catalog.ts';
import { supplementTypes, TypeMarker } from '../supplement-types.tsx';
import { projectGraph } from './project-graph.ts';
import { useSupplementGraph } from './useSupplementGraph.ts';
import { GraphPreview } from './GraphPreview.tsx';
import { GraphDirectory } from './GraphDirectory';
import type { PersonalReferenceEdge } from '../links/project-references.ts';
import './graph.css';

function nodeContext(node: ContentNode, chapters: PublishedContent['chapters'], sections: PublishedContent['sections']) {
  return [chapters.find((item) => item.id === node.chapterId)?.title ?? '未归属章节',
    sections.find((item) => item.id === node.sectionId)?.title,
    node.location ? pageLabel(getPage(node.location.page)) : node.summary.slice(0, 48)].filter(Boolean).join(' · ');
}

export function SupplementGraph({ nodes, personalEdges, selectedKey, visible, onSelect, bookVisible, onToggleBook, chapters, sections }: {
  nodes: ContentNode[]; selectedKey: string | null; visible: boolean;
  personalEdges: readonly PersonalReferenceEdge[];
  chapters: PublishedContent['chapters']; sections: PublishedContent['sections'];
  onSelect: (key: string | null) => boolean; bookVisible: boolean; onToggleBook: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const settings = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (searchOpen) search.current?.focus(); }, [searchOpen]);
  function closeDirectory() {
    setDirectoryOpen(false);
    document.getElementById('graph-directory-toggle')?.focus({ preventScroll: true });
  }
  function openSearch() {
    setDirectoryOpen(false);
    if (settings.current) settings.current.open = false;
    setSearchOpen(true);
    search.current?.focus();
  }
  function closeSearch() {
    setSearchOpen(false); setQuery('');
    document.getElementById('graph-search-toggle')?.focus({ preventScroll: true });
  }
  const data = useMemo(() => projectGraph(nodes, personalEdges), [nodes, personalEdges]);
  const matches = useMemo(() => query.trim() ? nodes.filter((node) =>
    node.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [], [nodes, query]);
  const searchKeys = useMemo(() => new Set(matches.map((node) => node.key)), [matches]);
  const graph = useSupplementGraph(host, data.nodes, data.edges, selectedKey, visible, onSelect, searchKeys);
  const previewNode = visible && graph.preview ? nodes.find((node) => node.key === graph.preview!.key) : null;
  function choose(key: string) {
    if (onSelect(key)) { graph.focus(key); setQuery(''); setSearchOpen(false); setDirectoryOpen(false); }
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
        else if (event.key === '/') { event.preventDefault(); openSearch(); }
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
            setSearchOpen(false); setQuery(''); setDirectoryOpen(true);
          }
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 5h14M5 12h3m4 0h7M5 19h3m4 0h7M5 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {directoryOpen && <div id="graph-directory" className="graph-directory-panel" aria-label="节点目录">
        <h2>节点目录</h2>
        <GraphDirectory nodes={nodes} chapters={chapters} sections={sections} selectedKey={selectedKey} onChoose={choose} />
      </div>}
    </div>
    <div className="graph-corner-controls">
      <details className="graph-settings" ref={settings} onToggle={(event) => {
        if (event.currentTarget.open) { setDirectoryOpen(false); setSearchOpen(false); setQuery(''); }
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
              <button type="button" aria-label="缩小节点图" onClick={() => graph.zoom(.8)}>−</button>
              <output aria-label="图缩放比例">{Math.round(graph.scale * 100)}%</output>
              <button type="button" aria-label="放大节点图" onClick={() => graph.zoom(1.25)}>+</button>
              <button type="button" onClick={graph.fit}>全图</button>
              {selectedKey && <button type="button" onClick={() => graph.focus(selectedKey)}>当前节点</button>}
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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M15 4v16" stroke="currentColor" strokeWidth="1.5" />{bookVisible && <path d="M16 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3Z" fill="currentColor" opacity=".25" />}</svg>
      </button>
    </div>
    <div className="graph-search-dock" onKeyDown={(event) => {
      if (event.key === 'Escape' && searchOpen) { event.preventDefault(); event.stopPropagation(); closeSearch(); }
    }}>
      <div id="graph-search-panel" className="graph-search-panel" hidden={!searchOpen}>
        <label className="graph-search"><span className="sr-only">搜索节点</span>
          <input ref={search} type="search" value={query} placeholder="输入解读或个人补充名称"
            onChange={(event) => setQuery(event.target.value)} aria-controls="graph-search-results"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); document.querySelector<HTMLButtonElement>('#graph-search-results button')?.focus(); }
            }} />
        </label>

      {query.trim() && <div className="graph-results" id="graph-search-results" aria-label="节点搜索结果">
        <p role="status">找到 {matches.length} 个节点</p>
        <ul>{matches.map((node) => <li key={node.key}>
          <button type="button" data-node-key={node.key} data-supplement-type={node.type}
            aria-current={selectedKey === node.key ? 'true' : undefined} onClick={() => choose(node.key)}>
            <TypeMarker type={node.type} /><span><strong>{node.title}</strong>
              <small>{supplementTypes[node.type]} · {nodeContext(node, chapters, sections)}</small></span>
          </button>
        </li>)}</ul>
      </div>}
      </div>
      <button id="graph-search-toggle" className="icon-button graph-floating-button" type="button" aria-label={searchOpen ? "关闭节点搜索" : "搜索节点"} title={searchOpen ? "关闭节点搜索" : "搜索节点（/）"}
        aria-expanded={searchOpen} aria-controls="graph-search-panel" onClick={searchOpen ? closeSearch : openSearch}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {searchOpen ? <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : <><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>}
        </svg>
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
    {related.map((relation, index) => <div key={`${relation.locationId}-${index}`}>
      <p>{relation.purpose}</p>
      {relation.targets.length ? <>
        <p className="graph-relation-label">{relation.label}{relation.targets.length > 1 ? '（选择解读）' : ''}</p>
        {relation.targets.map((target) => <button key={target.key} type="button" className="text-button"
          data-graph-target={target.key} onClick={() => onSelect(target.key)}>
          {target.title}<span className="related-page">{pageLabel(getPage(getLocation(relation.locationId).page))}</span>
        </button>)}
      </> : <button type="button" id={`related-${sourceId}-${relation.locationId}`} className="text-button"
        onClick={() => onLocate(relation.locationId, `related-${sourceId}-${relation.locationId}`)}>
        {relation.label}<span className="related-page">{pageLabel(getPage(getLocation(relation.locationId).page))}</span>
      </button>}
    </div>)}
  </div>;
}
