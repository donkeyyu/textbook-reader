import { useEffect, useRef, useState } from 'react';
import { getPage, pageCount, pageLabel, pages } from '../../textbook/catalog';
import type { ChapterRef, SectionRef } from '../../textbook/sections';

export function BookNavigation({ open, currentPage, chapters, sections, onNavigate, onClose }: {
  open: boolean;
  currentPage: number;
  chapters: ChapterRef[];
  sections: SectionRef[];
  onNavigate: (page: number) => void;
  onClose: () => void;
}) {
  const [navigationMode, setNavigationMode] = useState<'contents' | 'pages'>('contents');
  const thumbnailList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = thumbnailList.current;
    const selected = document.getElementById(`thumbnail-${currentPage}`);
    if (list && !list.hidden && selected) {
      if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight;
      }
    }
  }, [currentPage, open, navigationMode]);

  return <nav id="page-sidebar" className="page-sidebar book-navigation" hidden={!open} aria-label="教材目录"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="book-navigation-modes" role="group" aria-label="教材导航方式">
      <button type="button" aria-label="目录" title="目录" aria-pressed={navigationMode === 'contents'} onClick={() => setNavigationMode('contents')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
      </button>
      <button type="button" aria-label="页面" title="页面" aria-pressed={navigationMode === 'pages'} onClick={() => setNavigationMode('pages')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="3" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="3" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="4" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </div>
    <div className="book-navigation-position" hidden={navigationMode !== 'pages'}>
      <span>文件第 {currentPage} 页</span>
      <span>{getPage(currentPage).printedPage === null ? '无印刷页码' : pageLabel(getPage(currentPage))}</span>
    </div>
    <div className="book-contents" hidden={navigationMode !== 'contents'}>
      {chapters.map((chapter) => <details key={chapter.id} data-current={currentPage >= chapter.start && currentPage <= chapter.end ? 'true' : undefined}>
        <summary>{chapter.title}</summary>
        <button type="button" onClick={() => { onNavigate(chapter.start); }}>章首页</button>
        {sections.filter((section) => section.chapterId === chapter.id).map((section) =>
          <button type="button" key={section.id} aria-current={currentPage >= section.start && currentPage <= section.end ? 'location' : undefined}
            onClick={() => { onNavigate(section.start); }}>{section.title}</button>)}
      </details>)}
    </div>
    <div className="page-thumbnails" ref={thumbnailList} hidden={navigationMode !== 'pages'}>
      {pages.map((page) => <button id={`thumbnail-${page.page}`} key={page.page} className="page-thumbnail" title={page.alt}
        tabIndex={page.page === currentPage ? 0 : -1} aria-label={`跳转到文件第 ${page.page} 页，${page.printedPage === null ? "无印刷页码" : pageLabel(page)}`} aria-current={page.page === currentPage ? "page" : undefined}
        onKeyDown={(event) => {
          const number = event.key === "ArrowDown" ? page.page + 1 : event.key === "ArrowUp" ? page.page - 1 : event.key === "Home" ? 1 : event.key === "End" ? pageCount : null;
          if (number !== null) { event.preventDefault(); document.getElementById(`thumbnail-${Math.max(1, Math.min(pageCount, number))}`)?.focus(); }
        }} onClick={() => { onNavigate(page.page); }}>
        <img src={page.thumbnail} alt="" width="80" height="112" loading="lazy" />
      </button>)}
    </div>
  </nav>;
}
