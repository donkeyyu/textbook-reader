import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentNode, PublishedContent } from '../../textbook/content.ts';
import { getPage, pageLabel } from '../../textbook/catalog.ts';
import { supplementTypes, TypeMarker } from '../supplements/supplement-types.tsx';
import './content-search.css';

function nodeContext(node: ContentNode, chapters: PublishedContent['chapters'], sections: PublishedContent['sections']) {
  return [chapters.find((item) => item.id === node.chapterId)?.title ?? '未归属章节',
    sections.find((item) => item.id === node.sectionId)?.title,
    node.location ? pageLabel(getPage(node.location.page)) : node.summary.slice(0, 48)].filter(Boolean).join(' · ');
}

export function ContentSearch({ nodes, chapters, sections, selectedKey, onSelect }: {
  nodes: ContentNode[]; chapters: PublishedContent['chapters']; sections: PublishedContent['sections'];
  selectedKey: string | null; onSelect: (key: string) => boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!searchOpen) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setSearchOpen(false); setQuery(''); }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [searchOpen]);
  function openSearch() { setSearchOpen(true); search.current?.focus(); }
  function closeSearch() {
    setSearchOpen(false); setQuery('');
    document.getElementById('graph-search-toggle')?.focus({ preventScroll: true });
  }
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? nodes.filter((node) => {
      const body = node.source === 'personal' ? node.personal.markdown : [
        ...node.supplement.paragraphs,
        ...(node.supplement.questionGuide?.knowledgePoints ?? []),
        ...(node.supplement.questionGuide?.method ?? []),
        ...(node.supplement.questionGuide?.cautions ?? []),
      ].join(' ');
      return `${node.title} ${node.summary} ${body}`.toLocaleLowerCase().includes(term);
    }).sort((a, b) => Number(b.title.toLocaleLowerCase().includes(term)) - Number(a.title.toLocaleLowerCase().includes(term))) : [];
  }, [nodes, query]);
  function choose(key: string) {
    if (onSelect(key)) { setQuery(''); setSearchOpen(false); }
  }
  return (
    <div className="content-search" ref={root} onKeyDown={(event) => {
      if (event.key === 'Escape' && searchOpen) { event.preventDefault(); event.stopPropagation(); closeSearch(); }
    }}>
      <button id="graph-search-toggle" className="icon-button" type="button" aria-label={searchOpen ? "关闭内容搜索" : "搜索内容"} title={searchOpen ? "关闭内容搜索" : "搜索内容（/）"}
        aria-expanded={searchOpen} aria-controls="graph-search-panel" onClick={searchOpen ? closeSearch : openSearch}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {searchOpen ? <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : <><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>}
        </svg>
      </button>
      <div id="graph-search-panel" className="graph-search-panel" hidden={!searchOpen}>
        <label className="graph-search"><span className="sr-only">搜索内容</span>
          <input ref={search} type="search" value={query} placeholder="搜索解读标题或内容"
            onChange={(event) => setQuery(event.target.value)} aria-controls="graph-search-results"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); document.querySelector<HTMLButtonElement>('#graph-search-results button')?.focus(); }
            }} />
        </label>

      {query.trim() && <div className="graph-results" id="graph-search-results" aria-label="内容搜索结果">
        <p role="status">找到 {matches.length} 条内容</p>
        <ul>{matches.map((node) => <li key={node.key}>
          <button type="button" data-node-key={node.key} data-supplement-type={node.type}
            aria-current={selectedKey === node.key ? 'true' : undefined} onClick={() => choose(node.key)}>
            <TypeMarker type={node.type} /><span><strong>{node.title}</strong>
              <small>{supplementTypes[node.type]} · {nodeContext(node, chapters, sections)}</small></span>
          </button>
        </li>)}</ul>
      </div>}
      </div>

    </div>
  );
}
