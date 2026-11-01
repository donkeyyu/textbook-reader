import { useEffect, useMemo, useState } from 'react';
import type { Result } from '../../desktop/contracts';
import type { TextbookApi, TextbookContext, TextbookStatus } from '../../desktop/textbook-contracts';
import { textbookStorage } from './textbook-storage';
import { Shelf } from '../app/shelf/Shelf';
import { loadShelf, removeShelfBook, saveShelf } from '../app/shelf/shelf-store';
import { loadStartupDestination, resolveStartupDestination, saveStartupDestination } from '../app/startup';
import { Reader } from '../reader/Reader';
import { bookId as textbookId, contentNodes, publishedContent } from '../textbook/content';
import type { BookContent } from '../content/useBookContent';
import type { ChapterRef, SectionRef } from '../textbook/sections';

declare global { interface Window { textbookResources?: TextbookApi } }
function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.value; }

export function DesktopTextbooks() {
  const [context, setContext] = useState<TextbookContext | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void window.textbookResources!.context().then((result) => { if (active) setContext(value(result)); })
      .catch((error: Error) => { if (active) setError(error.message); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  if (!context) return <main className="vault-welcome"><h1>教材书架</h1><p role={error ? 'alert' : 'status'}>{error || (loaded ? '请先在“笔记库”中选择本机文件夹，再添加教材。' : '正在读取笔记库…')}</p></main>;
  return <TextbookShelf key={context.vaultKey} context={context} />;
}
function TextbookShelf({ context }: { context: TextbookContext }) {
  const storage = useMemo(() => textbookStorage(context.vaultKey), [context.vaultKey]);
  const api = window.textbookResources!;
  const [initial] = useState(() => {
    try { return { members: loadShelf(storage), error: '' }; } catch (error) { return { members: [], error: (error as Error).message }; }
  });
  const [members, setMembers] = useState(initial.members);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<TextbookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [returned, setReturned] = useState<string | null>(null);
  const [content, setContent] = useState<BookContent | null>(null);
  useEffect(() => {
    let active = true;
    const update = async () => { const next = value(await api.status()); if (active) setStatus(next); return next; };
    void update().then(async (next) => {
      if (!active) return;
      const destination = resolveStartupDestination(loadStartupDestination(storage), initial.members, next.phase === 'ready' ? [textbookId] : []);
      setNotice(destination.notice);
      if (destination.bookId) await open(false);
    }).catch((error: Error) => { if (active) setError(error.message); });
    const timer = setInterval(() => { void update().catch((error: Error) => { if (active) setError(error.message); }); }, 500);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function open(remember = true) {
    try {
      const next = value(await api.status()); setStatus(next);
      if (next.phase !== 'ready') throw new Error(next.error || '请先完成教材下载。');
      const catalog = value(await api.catalog(context.vaultToken)) as { textbookId: string; chapters: ChapterRef[]; sections: SectionRef[] };
      if (catalog.textbookId !== textbookId) throw new Error('教材目录版本不匹配。');
      // Ticket 04 replaces the bundled initial content with the imported Markdown adapter.
      const published = { ...publishedContent(), chapters: catalog.chapters, sections: catalog.sections };
      setContent({ user: null, published, personal: null, nodes: contentNodes(published, { supplements: [], notes: {} }), loading: false,
        error: '', notice: '', draftOwner: null, refresh: async () => {}, updatePersonal: async () => { throw new Error('请在本地笔记库中编辑笔记。'); } });
      setReading(true); setError('');
      if (remember) saveStartupDestination({ page: 'reader', bookId: textbookId }, storage);
    } catch (error) { setError((error as Error).message); }
  }
  async function add(id: string) {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      // This explicit action is the integration point for ticket 04's initial note import.
      const added = value(await api.add(context.vaultToken, id));
      const updated = [...new Set([...loadShelf(storage), added.textbookId])];
      saveShelf(updated, storage); setMembers(updated); setStatus(value(await api.status()));
      setNotice('教材已完整下载并校验，可离线阅读。'); return true;
    } catch (error) { setError((error as Error).message); return false; }
    finally { setBusy(false); }
  }
  if (reading && content) return <Reader content={content} local readingStorage={storage} onReturnToShelf={(message) => {
    setReading(false); setReturned(textbookId); setNotice(message);
    try { saveStartupDestination({ page: 'shelf' }, storage); } catch (error) { setError((error as Error).message); }
  }} />;
  return <Shelf readingStorage={storage} members={members} error={error} notice={notice} returnBookId={returned} onAdd={add} adding={busy}
    resourcesAvailable={status?.phase === 'ready'} onOpen={() => { void open(); }} account={null} settings={null}
    contentStatus={<div className="desktop-download" role="status">
      {status?.phase === 'ready' ? '离线可用 · 202 页' : status?.phase === 'downloading' ? `正在下载并校验 ${status.completed} / ${status.total} 项` : status?.error || '正在核对本地教材…'}
      {status?.phase === 'downloading' && <progress value={status.completed} max={status.total} aria-label="教材下载进度" />}
      {status && status.phase !== 'ready' && status.phase !== 'checking' && <button disabled={busy || status.phase === 'downloading'} onClick={() => { void add(textbookId); }}>重试下载</button>}
    </div>}
    onRemove={(id) => {
      try { const updated = removeShelfBook(id, storage); setMembers(updated); setError(''); return true; }
      catch (error) { setError((error as Error).message); return false; }
    }} />;
}
