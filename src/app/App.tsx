import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Reader } from '../reader/Reader';
import { AccountControl } from '../reader/AccountControl';
import { LoadingToast } from '../reader/LoadingToast';
import { useBookContent } from '../reader/useBookContent';
import { signIn, signInWithPassword, signOut } from '../reader/supabase';
import { getTextbook, textbooks } from '../textbook/library';
import { Shelf } from './Shelf';
import { loadShelf, removeShelfBook, saveShelf } from './shelf-store';
import { loadStartupDestination, resolveStartupDestination, saveStartupDestination } from './startup';
import { ShelfSettings } from './ShelfSettings';
import { loadUiStyle, saveUiStyle, type UiStyle } from './ui-style';
import './shelf.css';
import './appearance-fonts.css';
import './appearance.css';
import '../reader/reader-appearance.css';
import './study-decorations.css';

export function App() {
  const content = useBookContent();
  const [initialStyle] = useState(() => {
    try { return { style: loadUiStyle(), error: '' }; }
    catch (cause) { return { style: 'island' as const, error: (cause as Error).message }; }
  });
  const [uiStyle, setUiStyle] = useState<UiStyle>(initialStyle.style);
  const [styleError, setStyleError] = useState(initialStyle.error);
  useLayoutEffect(() => { document.documentElement.dataset.uiStyle = uiStyle; }, [uiStyle]);
  const [initialShelf] = useState(() => {
    try { return { members: loadShelf(), error: '' }; }
    catch (cause) { return { members: [], error: (cause as Error).message }; }
  });
  const [members, setMembers] = useState(initialShelf.members);
  const [error, setError] = useState(initialShelf.error);
  const [startup] = useState(() => {
    try { return { ...resolveStartupDestination(loadStartupDestination(), initialShelf.members, textbooks.map(({ id }) => id)), readable: true }; }
    catch (cause) { return { bookId: null, notice: (cause as Error).message, readable: false }; }
  });
  const [readingNotice, setReadingNotice] = useState(startup.notice);
  const [readingBookId, setReadingBookId] = useState<string | null>(startup.bookId);
  const [returnBookId, setReturnBookId] = useState<string | null>(null);
  const navigated = useRef(false);

  useEffect(() => {
    if (!navigated.current) return;
    navigated.current = false;
    if (!startup.readable) return;
    try { saveStartupDestination(readingBookId ? { page: 'reader', bookId: readingBookId } : { page: 'shelf' }); }
    catch (cause) { setReadingNotice((notice) => [notice, (cause as Error).message].filter(Boolean).join(' ')); }
  }, [readingBookId, startup.readable]);

  function addBook(id: string) {
    if (!getTextbook(id)) return false;
    try {
      const updated = [...new Set([...loadShelf(), id])];
      saveShelf(updated);
      setMembers(updated);
      setError('');
      return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }

  function changeStyle(style: UiStyle) {
    setUiStyle(style);
    try { saveUiStyle(style); setStyleError(''); }
    catch (cause) { setStyleError((cause as Error).message); }
  }

  if (readingBookId) return <Reader content={content} navigationNotice={readingNotice} onReturnToShelf={(notice) => {
    setReadingNotice([startup.readable ? '' : startup.notice, notice].filter(Boolean).join(' '));
    setReturnBookId(readingBookId);
    navigated.current = true;
    setReadingBookId(null);
    if (content.draftOwner) void content.refresh();
  }} />;

  return <Shelf members={members} error={error} notice={readingNotice} returnBookId={returnBookId} onAdd={addBook}
    settings={<ShelfSettings style={uiStyle} error={styleError} onChange={changeStyle} />}
    account={<AccountControl user={content.user} onSignIn={signIn} onPasswordSignIn={import.meta.env.DEV ? signInWithPassword : undefined} onSignOut={signOut} />}
    contentStatus={<>
      {content.loading && <LoadingToast />}
      {(content.error || content.notice) && <div className={content.error ? 'storage-error' : 'content-status'} role={content.error ? 'alert' : 'status'}>
        <span>{content.error || content.notice}</span>{' '}
        <button className="text-button" onClick={() => { void content.refresh(); }}>重新读取</button>
      </div>}
    </>}
    onRemove={(id) => {
      try {
        const updated = removeShelfBook(id);
        setMembers(updated);
        setError('');
        return true;
      } catch (cause) { setError((cause as Error).message); return false; }
    }}
    onOpen={(id) => {
      if (!getTextbook(id)) return;
      setReadingNotice(startup.readable ? '' : startup.notice);
      navigated.current = true;
      setReadingBookId(id);
    }} />;
}
