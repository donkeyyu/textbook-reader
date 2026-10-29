import { useState } from 'react';
import { getPage, pageLabel } from '../../textbook/catalog';
import type { ContentNode } from '../../textbook/content';
import type { ChapterRef, SectionRef } from '../../textbook/sections';
import type { PersonalSupplement } from '../../content/personal';
import { TypeMarker } from '../supplements/supplement-types';
import './personal-library.css';

export function PersonalLibrary({ nodes, chapters, sections, onOpen, onCreate, onClose }: {
  nodes: Extract<ContentNode, { source: 'personal' }>[];
  chapters: ChapterRef[];
  sections: SectionRef[];
  onOpen: (item: PersonalSupplement) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const entries = nodes.map((node) => ({ node, context: [
    chapters.find(({ id }) => id === node.chapterId)?.title ?? '未归属章节',
    sections.find(({ id }) => id === node.sectionId)?.title,
    node.location ? pageLabel(getPage(node.location.page)) : null,
  ].filter(Boolean).join(' · ') }));
  const matches = entries.filter(({ node, context }) => `${node.title} ${context} ${node.personal.markdown}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <aside id="supplement-panel" className="supplement-panel personal-library" aria-label="我的补充列表" data-supplement-type="personal">
    <div className="supplement-heading">
      <h2 id="supplement-title" tabIndex={-1}>我的补充</h2>
      <div className="heading-actions"><button className="text-button" type="button" onClick={onCreate}>新建补充</button><button className="text-button" type="button" onClick={onClose}>关闭</button></div>
    </div>
    <label className="personal-search">查找补充<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、章节或内容" /></label>
    <p className="personal-list-count" role="status">{query ? `找到 ${matches.length} 条补充` : `共 ${matches.length} 条补充`}</p>
    {!matches.length && <p>{nodes.length ? '没有找到补充，试试其他关键词。' : '还没有个人补充。可以新建，也可以在教材上框选后添加。'}</p>}
    <ul className="personal-list">{matches.map(({ node, context }) => <li key={node.key}>
      <button type="button" data-personal-id={node.id} onClick={() => onOpen(node.personal)}>
        <span className="personal-list-title"><TypeMarker type="personal" /><strong>{node.title}</strong></span>
        <span className="personal-list-context">{context}</span>
        <span className="personal-list-summary">{node.summary}</span>
      </button>
    </li>)}</ul>
  </aside>;
}
