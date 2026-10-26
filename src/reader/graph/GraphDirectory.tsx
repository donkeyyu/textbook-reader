import { useMemo, useState } from 'react';
import type { ContentNode, PublishedContent } from '../../textbook/content';
import { getPage, pageLabel } from '../../textbook/catalog';
import { supplementTypes, TypeMarker } from '../supplement-types';

export function GraphDirectory({ nodes, chapters, sections, selectedKey, onChoose }: {
  nodes: ContentNode[]; chapters: PublishedContent['chapters']; sections: PublishedContent['sections'];
  selectedKey: string | null; onChoose: (key: string) => void;
}) {
  const [type, setType] = useState('all');
  const groups = useMemo(() => {
    const filtered = nodes.filter((node) => type === 'all' || node.type === type);
    const knownChapters = new Set(chapters.map((chapter) => chapter.id));
    return [...chapters, { id: null, title: '未归属章节' }].map((chapter) => {
      const members = filtered.filter((node) => chapter.id === null
        ? !node.chapterId || !knownChapters.has(node.chapterId) : node.chapterId === chapter.id);
      const chapterSections = sections.filter((section) => section.chapterId === chapter.id);
      const knownSections = new Set(chapterSections.map((section) => section.id));
      return { ...chapter, count: members.length, sections: [...chapterSections, { id: null, title: '其他解读' }]
        .map((section) => ({ ...section, nodes: members.filter((node) => section.id === null
          ? !node.sectionId || !knownSections.has(node.sectionId) : node.sectionId === section.id) }))
        .filter((section) => section.nodes.length) };
    }).filter((chapter) => chapter.count);
  }, [nodes, chapters, sections, type]);

  return <>
    <label className="graph-directory-filter">目录类型
      <select value={type} onChange={(event) => setType(event.target.value)}>
        <option value="all">全部类型</option>
        {Object.entries(supplementTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <nav className="graph-directory-tree" aria-label="按章节浏览节点">
      {!groups.length && <p className="graph-directory-empty" role="status">此类型暂无节点。</p>}
      {groups.map((chapter) => <details className="graph-directory-chapter" key={chapter.id ?? 'unassigned'}>
        <summary>{chapter.title}<small>{chapter.count}</small></summary>
        {chapter.sections.map((section) => <details className="graph-directory-section" key={section.id ?? 'other'}>
          <summary>{section.title}<small>{section.nodes.length}</small></summary>
          <ul>{section.nodes.map((node) => <li key={node.key}>
            <button type="button" data-node-key={node.key} data-supplement-type={node.type}
              aria-current={node.key === selectedKey ? 'true' : undefined} onClick={() => onChoose(node.key)}>
              <TypeMarker type={node.type} /><span>{node.title}<small>{supplementTypes[node.type]} · {node.location
                ? pageLabel(getPage(node.location.page)) : '无教材位置'}</small></span>
            </button>
          </li>)}</ul>
        </details>)}
      </details>)}
    </nav>
  </>;
}
