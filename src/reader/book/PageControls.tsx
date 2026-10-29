import { useEffect, useState } from "react";
import { pageCount, resolvePageInput } from "../../textbook/catalog";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function PageControls({ currentPage, pending, onNavigate }: {
  currentPage: number;
  pending: boolean;
  onNavigate: (page: number) => void;
}) {
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [editingPage, setEditingPage] = useState(false);

  useEffect(() => {
    if (!editingPage) { setPageInput(String(currentPage)); setPageError(""); }
  }, [currentPage, editingPage]);

  function closePageInput() {
    setEditingPage(false);
    setPageError("");
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.page-index')?.focus());
  }

  return <div className="page-controls">
    <button className="icon-button" aria-label="上一页" disabled={currentPage === 1 || pending} onClick={() => { onNavigate(currentPage - 1); }}><Chevron direction="left" /></button>
    {editingPage ? <form id="page-jump" className="page-jump" aria-label="跳转页面" onBlur={() => {
      setEditingPage(false); setPageError("");
    }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePageInput(); }
    }} onSubmit={(event) => {
      event.preventDefault();
      const result = resolvePageInput(pageInput);
      if (result.error !== undefined) { setPageError(result.error); return; }
      setEditingPage(false); setPageError("");
      onNavigate(result.page);
    }}>
      <input id="page-input" aria-label="页码" aria-invalid={!!pageError}
        aria-describedby={pageError ? "page-input-error" : undefined} placeholder={`1–${pageCount}`}
        autoFocus inputMode="numeric" enterKeyHint="go" value={pageInput} onChange={(event) => { setPageInput(event.target.value); setPageError(""); }}
        onFocus={(event) => event.currentTarget.select()} />
      <span>/{pageCount}</span>
      {pageError && <p id="page-input-error" className="page-input-error" role="alert">{pageError}</p>}
    </form> : <button className="page-index" type="button" aria-label={`第 ${currentPage} 页，共 ${pageCount} 页，点击输入页码`}
      title="输入页码，按 Enter 跳转" onClick={() => {
        setPageInput(String(currentPage)); setPageError(""); setEditingPage(true);
      }}>
      <span>{currentPage}/{pageCount}</span>
    </button>}
    <button className="icon-button" aria-label="下一页" disabled={currentPage === pageCount || pending} onClick={() => { onNavigate(currentPage + 1); }}><Chevron direction="right" /></button>
  </div>;

}
