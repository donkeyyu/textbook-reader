import { useEffect, useState } from 'react';
import { DesktopApp } from './DesktopApp';
import { DesktopTextbooks } from './DesktopTextbooks';
import './textbooks.css';

// Keep the note editor mounted when browsing textbooks, including unsaved drafts.
export function DesktopWorkspace() {
  const [view, setView] = useState(() => { try { return localStorage.getItem('desktop-workspace-view') === 'textbooks' ? 'textbooks' : 'notes'; } catch { return 'notes'; } });
  const [openRequest, setOpenRequest] = useState<{ path: string; serial: number; vaultToken: string; expectedId: string }>();
  const [textbooksMounted, setTextbooksMounted] = useState(view === 'textbooks');
  useEffect(() => { try { localStorage.setItem('desktop-workspace-view', view); } catch { /* Navigation still works without a preference. */ } }, [view]);
  return <div className="desktop-workspace">
    <nav className="desktop-workspace-tabs" aria-label="本地工作区">
      <button aria-current={view === 'notes' ? 'page' : undefined} onClick={() => setView('notes')}>笔记库</button>
      <button aria-current={view === 'textbooks' ? 'page' : undefined} onClick={() => { setTextbooksMounted(true); setView('textbooks'); }}>教材书架</button>
    </nav>
    <div className="desktop-workspace-view" hidden={view !== 'notes'}><DesktopApp openRequest={openRequest} /></div>
    <div className="desktop-workspace-view" hidden={view !== 'textbooks'}>{textbooksMounted && <DesktopTextbooks active={view === 'textbooks'} onOpenNote={(path, vaultToken, expectedId) => { setOpenRequest((previous) => ({ path, vaultToken, expectedId, serial: (previous?.serial ?? 0) + 1 })); setView('notes'); }} />}</div>
  </div>;
}
