import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ContentNode, PublishedContent } from '../../textbook/content';
import { getPage, pageLabel } from '../../textbook/catalog';
import { supplementTypes, TypeMarker } from '../supplement-types';
import { LocateIcon } from '../LocateIcon';

export function GraphDirectory({ nodes, chapters, sections, selectedKey, onChoose, active }: {
  nodes: ContentNode[]; chapters: PublishedContent['chapters']; sections: PublishedContent['sections'];
  selectedKey: string | null; onChoose: (key: string) => void; active: boolean;
}) {
  const [type, setType] = useState('all');
  const tree = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const allGroups = useMemo(() => {
    const knownChapters = new Set(chapters.map((chapter) => chapter.id));
    return [...chapters, { id: null, title: '未归属章节' }].map((chapter) => {
      const members = nodes.filter((node) => chapter.id === null
        ? !node.chapterId || !knownChapters.has(node.chapterId) : node.chapterId === chapter.id);
      const chapterSections = sections.filter((section) => section.chapterId === chapter.id);
      const knownSections = new Set(chapterSections.map((section) => section.id));
      return { ...chapter, key: JSON.stringify([chapter.id]), count: members.length, sections: [...chapterSections, { id: null, title: '其他解读' }]
        .map((section) => ({ ...section, key: JSON.stringify([chapter.id, section.id]), nodes: members.filter((node) => section.id === null
          ? !node.sectionId || !knownSections.has(node.sectionId) : node.sectionId === section.id) }))
        .filter((section) => section.nodes.length) };
    }).filter((chapter) => chapter.count);
  }, [nodes, chapters, sections]);
  const groups = allGroups.map((chapter) => {
    const sections = chapter.sections.map((section) => ({ ...section,
      nodes: section.nodes.filter((node) => type === 'all' || node.type === type),
    })).filter((section) => section.nodes.length);
    return { ...chapter, sections, count: sections.reduce((sum, section) => sum + section.nodes.length, 0) };
  }).filter((chapter) => chapter.count);
  const selected = nodes.find((node) => node.key === selectedKey);
  const selectedChapter = allGroups.find((chapter) => chapter.sections.some((section) => section.nodes.some((node) => node.key === selectedKey)));
  const selectedSection = selectedChapter?.sections.find((section) => section.nodes.some((node) => node.key === selectedKey));
  const filteredSelection = !!selected && type !== 'all' && selected.type !== type;
  const visibleCount = groups.reduce((sum, chapter) => sum + chapter.count, 0);
  const revealLabel = filteredSelection ? '切回全部类型并在目录中显示当前节点' : '在目录中显示当前节点';
  function toggle(key: string, open: boolean) {
    setExpanded((previous) => {
      if (previous.has(key) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(key); else next.delete(key);
      return next;
    });
  }
  function revealCurrent() {
    if (!selected || !selectedChapter || !selectedSection) return;
    if (filteredSelection) setType('all');
    setExpanded((previous) => new Set([...previous, selectedChapter.key, selectedSection.key]));
    setRevealKey(selected.key);
  }
  useLayoutEffect(() => {
    if (!revealKey || !tree.current) return;
    const row = tree.current.querySelector<HTMLButtonElement>(`button[data-node-key="${CSS.escape(revealKey)}"]`);
    if (!row) return;
    const bounds = tree.current.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top < bounds.top) tree.current.scrollTop += target.top - bounds.top;
    else if (target.bottom > bounds.bottom) tree.current.scrollTop += Math.min(target.top - bounds.top, target.bottom - bounds.bottom);
    row.focus({ preventScroll: true });
    setRevealKey(null);
  }, [revealKey]);

  return <>
    <div className="graph-directory-heading">
      <h2>节点目录</h2><span className="graph-directory-count" aria-label={`${visibleCount} 个节点，共 ${nodes.length} 个`}>{visibleCount}{type !== 'all' && ` / ${nodes.length}`} 节点</span>
      <div className="graph-directory-actions">
        <DirectoryTypeFilter value={type} onChange={setType} active={active} />
        <button type="button" className="icon-button" aria-label={revealLabel} title={revealLabel} disabled={!selected} onClick={revealCurrent}><LocateIcon /></button>
        <button type="button" className="icon-button" aria-label="收起全部章节" title="收起全部章节" disabled={expanded.size === 0} onClick={() => setExpanded(new Set())}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 4 5 5 5-5M7 20l5-5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
    {filteredSelection && <p className="graph-directory-filter-notice" role="status">当前节点不在此类型中。</p>}
    <nav ref={tree} className="graph-directory-tree" aria-label="按章节浏览节点">
      {!groups.length && <p className="graph-directory-empty" role="status">此类型暂无节点。</p>}
      {groups.map((chapter) => <details className="graph-directory-chapter" key={chapter.key}
        data-current={chapter.key === selectedChapter?.key ? 'true' : undefined} open={expanded.has(chapter.key)}
        onToggle={(event) => { if (event.target === event.currentTarget) toggle(chapter.key, event.currentTarget.open); }}>
        <summary><DirectoryChevron /><span className="graph-directory-label">{chapter.title}</span><span className="graph-directory-count">{chapter.count}</span></summary>
        {chapter.sections.map((section) => <details className="graph-directory-section" key={section.key}
          data-current={section.key === selectedSection?.key ? 'true' : undefined} open={expanded.has(section.key)}
          onToggle={(event) => { if (event.target === event.currentTarget) toggle(section.key, event.currentTarget.open); }}>
          <summary><DirectoryChevron /><span className="graph-directory-label">{section.title}</span><span className="graph-directory-count">{section.nodes.length}</span></summary>
          <ul>{section.nodes.map((node) => <li key={node.key}>
            <button type="button" data-node-key={node.key} data-supplement-type={node.type}
              aria-current={node.key === selectedKey ? 'true' : undefined} onClick={() => onChoose(node.key)}>
              <i className="graph-directory-node-type" role="img" aria-label={supplementTypes[node.type]} title={supplementTypes[node.type]}><TypeMarker type={node.type} /></i>
              <span className="graph-directory-node-title">{node.title}<small>{node.location
                ? pageLabel(getPage(node.location.page)) : '无教材位置'}</small></span>
            </button>
          </li>)}</ul>
        </details>)}
      </details>)}
    </nav>
  </>;
}


function DirectoryTypeFilter({ value, onChange, active }: { value: string; onChange: (value: string) => void; active: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const choices: [string, string][] = [['all', '全部类型'], ...Object.entries(supplementTypes)];
  const label = `筛选节点类型：${choices.find(([key]) => key === value)?.[1]}`;
  function focusChecked() {
    const popup = menu.current;
    const checked = popup?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    if (!popup || !checked) return;
    const bounds = popup.getBoundingClientRect(), row = checked.getBoundingClientRect();
    if (row.top < bounds.top + 2) popup.scrollTop += row.top - bounds.top - 2;
    else if (row.bottom > bounds.bottom - 2) popup.scrollTop += row.bottom - bounds.bottom + 2;
    checked.focus({ preventScroll: true });
  }
  function close(returnFocus = false) {
    menu.current?.hidePopover();
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => { if (!active) close(); }, [active]);
  useEffect(() => {
    const onResize = () => close();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  function positionMenu() {
    const popup = menu.current, button = trigger.current;
    const graph = button?.closest('.supplement-graph');
    if (!popup || !button || !graph) return;
    const bounds = graph.getBoundingClientRect(), anchor = button.getBoundingClientRect();
    const left = Math.max(8, bounds.left + 8), right = Math.min(window.innerWidth - 8, bounds.right - 8);
    const top = Math.max(8, bounds.top + 8), bottom = Math.min(window.innerHeight - 8, bounds.bottom - 8);
    const width = Math.max(1, Math.min(232, right - left));
    popup.style.width = `${width}px`;
    const below = Math.max(0, bottom - anchor.bottom - 6), above = Math.max(0, anchor.top - 6 - top);
    const upwards = above > below;
    const available = Math.max(1, upwards ? above : below);
    popup.style.maxHeight = `${available}px`;
    popup.style.left = `${Math.max(left, Math.min(anchor.right - width, right - width))}px`;
    popup.style.top = upwards ? 'auto' : `${anchor.bottom + 6}px`;
    popup.style.bottom = upwards ? `${window.innerHeight - anchor.top + 6}px` : 'auto';
  }
  return <>
    <button ref={trigger} id="graph-directory-type-toggle" type="button" className="icon-button"
      aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls="graph-directory-type-menu"
      popoverTarget="graph-directory-type-menu"
      data-value={value}
      data-active={value !== 'all' ? 'true' : undefined}
      onClick={() => { if (!menu.current?.matches(':popover-open')) positionMenu(); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (menu.current?.matches(':popover-open')) focusChecked();
          else event.currentTarget.click();
        }
      }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <div ref={menu} id="graph-directory-type-menu" className="graph-directory-type-menu" popover="auto" role="menu" aria-label="节点类型"
      onToggle={(event) => {
        const opened = event.newState === 'open';
        setOpen(opened);
        if (opened) focusChecked();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') { close(true); return; }
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
        if (next !== null) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
      }}>
      {choices.map(([key, name]) => <button key={key} type="button" role="menuitemradio" aria-checked={value === key} tabIndex={-1}
        data-directory-type={key} data-supplement-type={key === 'all' ? undefined : key}
        onClick={() => { onChange(key); close(true); }}>
        <TypeMarker type={key === 'all' ? 'group' : key as keyof typeof supplementTypes} /><span>{name}</span>
        <svg className="graph-directory-type-check" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>)}
    </div>
  </>;
}


function DirectoryChevron() {
  return <svg className="graph-directory-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 9 7 7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Only this handle rerenders during a drag; the node tree keeps its scroll and focus. */
export function DirectoryResize() {
  const handle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [maximum, setMaximum] = useState(600);
  const minimum = Math.min(240, maximum);
  useLayoutEffect(() => {
    const dock = handle.current?.closest<HTMLElement>('.graph-directory-dock');
    const graph = dock?.closest<HTMLElement>('.supplement-graph');
    if (!dock || !graph) return;
    const measure = () => {
      setWidth(Math.round(dock.getBoundingClientRect().width));
      setMaximum(Math.max(1, Math.min(600, graph.clientWidth - 96)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock); observer.observe(graph); measure();
    return () => observer.disconnect();
  }, []);
  function resize(value: number) {
    const dock = handle.current?.closest<HTMLElement>('.graph-directory-dock');
    dock?.style.setProperty('--graph-directory-width', `${Math.min(maximum, Math.max(minimum, value))}px`);
  }
  return <div ref={handle} className="graph-directory-resize" role="separator" tabIndex={0}
    aria-label="调整节点目录宽度" aria-orientation="vertical" aria-controls="graph-directory"
    aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width} 像素`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const dock = event.currentTarget.closest('.graph-directory-dock')!;
      resize(event.clientX - dock.getBoundingClientRect().left);
    }} onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onKeyDown={(event) => {
      const next = event.key === 'ArrowLeft' ? width - 24 : event.key === 'ArrowRight' ? width + 24
        : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); resize(next); }
    }}><span aria-hidden="true" /></div>;
}
