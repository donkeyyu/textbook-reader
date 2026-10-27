import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadReadingPosition, type ReadingPosition } from '../reader/reading-record';
import { pageLabel } from '../textbook/catalog';
import { getTextbook, textbooks } from '../textbook/library';

export function Shelf({ members, error, notice, returnBookId, onAdd, onOpen, onRemove, account, contentStatus }: {
  members: readonly string[];
  error: string;
  notice: string;
  returnBookId: string | null;
  onAdd: (id: string) => boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => boolean;
  account: ReactNode;
  contentStatus: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const returnedCover = useRef<HTMLButtonElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const infoDialog = useRef<HTMLDialogElement>(null);
  const infoTrigger = useRef<HTMLButtonElement | null>(null);
  const restoredBook = useRef<string | null>(null);
  const [menuBookId, setMenuBookId] = useState<string | null>(null);
  const [infoBookId, setInfoBookId] = useState<string | null>(null);
  const [removedBook, setRemovedBook] = useState<(typeof textbooks)[number] | null>(null);
  const [message, setMessage] = useState('');
  const [readings] = useState(() => Object.fromEntries(textbooks.map((book): [string, { position: ReadingPosition | null; error: string }] => {
    try { return [book.id, { position: loadReadingPosition(undefined, { documentSha256: book.id, pageCount: book.pages.length }), error: '' }]; }
    catch (cause) { return [book.id, { position: null, error: (cause as Error).message }]; }
  })));
  const readingErrors = [...new Set(Object.values(readings).map(({ error }) => error).filter(Boolean))].join(' ');
  const books = members.flatMap((id) => { const book = getTextbook(id); return book ? [book] : []; });
  const infoBook = infoBookId ? getTextbook(infoBookId) : null;
  useEffect(() => { if (returnBookId) (returnedCover.current ?? addTrigger.current)?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (!restoredBook.current || !members.includes(restoredBook.current)) return;
    document.getElementById(`shelf-cover-${restoredBook.current}`)?.focus({ preventScroll: true });
    restoredBook.current = null;
  }, [members]);
  useEffect(() => {
    if (!menuBookId) return;
    menu.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !menuTrigger.current?.contains(event.target as Node)) setMenuBookId(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuBookId]);
  useEffect(() => { if (infoBookId) infoDialog.current?.showModal(); }, [infoBookId]);
  useEffect(() => {
    const element = infoDialog.current;
    if (!element) return;
    const blockBackdropScroll = (event: Event) => { if (event.target === element) event.preventDefault(); };
    element.addEventListener('wheel', blockBackdropScroll, { passive: false });
    element.addEventListener('touchmove', blockBackdropScroll, { passive: false });
    return () => {
      element.removeEventListener('wheel', blockBackdropScroll);
      element.removeEventListener('touchmove', blockBackdropScroll);
    };
  }, []);

  function focusShelf() {
    (document.getElementById(`shelf-cover-${books[0]?.id}`) ?? addTrigger.current)?.focus({ preventScroll: true });
  }

  function openLibrary(button: HTMLButtonElement) {
    trigger.current = button;
    setMessage('');
    dialog.current?.showModal();
  }

  const addButton = (className: string, primary = false) => <button ref={primary ? addTrigger : undefined} type="button" className={className}
    onClick={(event) => openLibrary(event.currentTarget)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>添加教材</button>;

  return <div className="shelf-app">
    <header className="toolbar shelf-toolbar">
      <div className="shelf-brand"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M14 7.5C10.7 5.2 6.9 5.1 3.5 6.2v16c3.4-1.1 7.2-1 10.5 1.3 3.3-2.3 7.1-2.4 10.5-1.3v-16C21.1 5.1 17.3 5.2 14 7.5Zm0 0v16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M7.5 10.5c.9-.1 1.9.1 2.8.4M7.5 14.5c.9-.1 1.9.1 2.8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg><span>课本解读</span></div>
      <div className="toolbar-actions">{addButton('shelf-primary', true)}{account}</div>
    </header>
    <main className="shelf-main">
      <div className="shelf-intro"><h1>书架</h1><p>读懂知识，也读懂每一步的理由。</p></div>
      {contentStatus}
      {error && <p className="shelf-error" role="alert">{error}</p>}
      {(notice || readingErrors) && <p className="shelf-error" role="status">{[...new Set([notice, readingErrors].filter(Boolean))].join(' ')}</p>}
      {removedBook && <div className="shelf-removal">
        <p role="status">已将《{removedBook.title}》移出书架。阅读记录、笔记和个人补充仍保留。</p>
        <button className="text-button" type="button" onClick={() => {
          if (!onAdd(removedBook.id)) return;
          restoredBook.current = removedBook.id;
          setRemovedBook(null);
        }}>撤销移出</button>
        <button className="icon-button" type="button" aria-label="关闭移出提示" onClick={() => { setRemovedBook(null); focusShelf(); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>}
      <div className="shelf-section-heading"><h2>我的教材</h2><span>{books.length} 本</span></div>
      {members.length === 0 ? <div className="shelf-empty">
        <svg className="shelf-empty-icon" width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true"><path d="M36 20c-8-5-17-5-25-2v38c8-3 17-3 25 2 8-5 17-5 25-2V18c-8-3-17-3-25 2Zm0 0v38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 29c3-.3 5.8.2 8 1M20 37c3-.3 5.8.2 8 1M44 30c2.2-.8 5-1.3 8-1M44 38c2.2-.8 5-1.3 8-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <h2>添加一本教材，开始阅读</h2><p>从熟悉的课本出发，查看解读，连接知识。</p>{addButton('shelf-primary')}</div>
        : <>
          {books.length < members.length && <p className="shelf-error" role="status">部分教材暂不可用。你仍可添加并阅读教材库中的教材。</p>}
          <div className="shelf-grid" aria-label="我的教材">
            {books.map((book) => {
              const reading = readings[book.id]!;
              return <article className="shelf-book" key={book.id}>
              <button id={`shelf-cover-${book.id}`} ref={book.id === returnBookId ? returnedCover : undefined} className="shelf-cover" type="button"
                aria-label={`打开《${book.title}》，${book.edition}`} onClick={() => onOpen(book.id)}>
                <img src={book.cover} alt={`${book.title}封面`} width="1304" height="1843" />
              </button>
              <h2>{book.title}</h2><p className="shelf-edition">{book.edition}</p>
              <p className="shelf-position">{reading.position ? `上次读到${pageLabel(book.pages[reading.position.page - 1]!)}` : reading.error ? '阅读位置暂不可用' : '尚未开始阅读'}</p>
              <div className="shelf-book-actions">
                <button className="shelf-read" type="button" onClick={() => onOpen(book.id)}>{reading.position ? '继续阅读' : '开始阅读'}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                <div className="shelf-menu-anchor" onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuBookId(null);
                }} onKeyDown={(event) => {
                  if (event.key === 'Escape' && menuBookId === book.id) {
                    event.preventDefault(); event.stopPropagation(); setMenuBookId(null); menuTrigger.current?.focus();
                  }
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || menuBookId !== book.id) return;
                  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
                  if (!items.length) return;
                  event.preventDefault();
                  const index = items.indexOf(document.activeElement as HTMLButtonElement);
                  items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
                }}>
                  <button type="button" className="icon-button shelf-more" aria-label={`《${book.title}》，${book.edition}，更多操作`}
                    aria-haspopup="menu" aria-expanded={menuBookId === book.id} aria-controls={`shelf-menu-${book.id}`}
                    onClick={(event) => { menuTrigger.current = event.currentTarget; setMenuBookId(menuBookId === book.id ? null : book.id); }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
                  </button>
                  {menuBookId === book.id && <div ref={menu} id={`shelf-menu-${book.id}`} className="shelf-menu" role="menu" aria-label={`《${book.title}》，${book.edition}，教材操作`}>
                    <button type="button" role="menuitem" onClick={() => {
                      infoTrigger.current = menuTrigger.current;
                      setMenuBookId(null); setInfoBookId(book.id);
                    }}>查看教材信息</button>
                    <button type="button" role="menuitem" onClick={() => {
                      if (!onRemove(book.id)) return;
                      setMenuBookId(null); setRemovedBook(book);
                      const next = books.find((item) => item.id !== book.id);
                      (next ? document.getElementById(`shelf-cover-${next.id}`) : addTrigger.current)?.focus({ preventScroll: true });
                    }}>移出书架</button>
                  </div>}
                </div>
              </div>
            </article>; })}
          </div>
        </>}
    </main>
    <dialog ref={dialog} className="shelf-picker" aria-labelledby="textbook-picker-title"
      onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <div className="shelf-picker-heading"><h2 id="textbook-picker-title">添加教材</h2>
        <button type="button" className="text-button" aria-label="关闭教材选择" onClick={() => dialog.current?.close()}>关闭</button>
      </div>
      {error && <p className="shelf-error" role="alert">{error}</p>}
      <p className="shelf-message" role="status">{message || '从教材库选择教材，添加后留在书架。'}</p>
      <div className="shelf-grid" aria-label="教材库">
        {textbooks.map((book) => <article className="shelf-book" key={book.id}>
          <div className="shelf-library-art"><img className="shelf-library-cover" src={book.cover} alt={`${book.title}封面`} width="1304" height="1843" /></div>
          <h3>{book.title}</h3><p className="shelf-edition">{book.edition}</p>
          <button className="shelf-read" type="button" disabled={members.includes(book.id)} onClick={() => {
            if (onAdd(book.id)) {
              setMessage(`已将《${book.title}》添加到书架。`);
              if (removedBook?.id === book.id) setRemovedBook(null);
            }
          }}>{members.includes(book.id) ? '已添加' : '添加到书架'}</button>
          {error && <button className="text-button shelf-direct-read" type="button" onClick={() => onOpen(book.id)}>直接阅读</button>}
        </article>)}
      </div>
    </dialog>
    <dialog ref={infoDialog} className="shelf-picker shelf-info" aria-labelledby="textbook-info-title"
      onClose={() => { setInfoBookId(null); infoTrigger.current?.focus({ preventScroll: true }); }}>
      <div className="shelf-picker-heading"><h2 id="textbook-info-title">教材信息</h2>
        <button type="button" className="text-button" aria-label="关闭教材信息" onClick={() => infoDialog.current?.close()}>关闭</button>
      </div>
      {infoBook && <>
        <h3>{infoBook.title}</h3>
        <dl><dt>教材版本</dt><dd>{infoBook.edition}</dd><dt>文件页数</dt><dd>{infoBook.pages.length} 页</dd></dl>
      </>}
    </dialog>
  </div>;
}
