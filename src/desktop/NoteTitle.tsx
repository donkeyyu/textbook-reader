import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { DesktopApi, Note, Result } from '../../desktop/contracts';
import type { MovePlan } from '../../desktop/moves';
import { notePath } from '../../desktop/note-path';
import { noteName } from './NoteMoves';

function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.value; }

export function NoteTitle({ note, api, token, disabled, before, run, onApplied, headingRef, flushRef, onDirtyChange }: {
  note: Note; api: DesktopApi; token: string; disabled: boolean; headingRef?: Ref<HTMLHeadingElement>;
  flushRef?: Ref<{ flush: () => Promise<boolean> }>;
  onDirtyChange?: (dirty: boolean) => void;
  before: () => Promise<boolean>; run: (action: () => Promise<void>) => Promise<void>; onApplied: (plan: MovePlan) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [composing, setComposing] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = useRef({ token, path: note.path }); current.current = { token, path: note.path };
  const mounted = useRef(false);
  const dirtyChanged = useRef(onDirtyChange); dirtyChanged.current = onDirtyChange;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => () => { dirtyChanged.current?.(false); }, []);
  useLayoutEffect(() => {
    const element = field.current;
    if (!editing || !element) return;
    element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`;
  }, [editing, title]);
  useLayoutEffect(() => { if (editing) { field.current?.focus(); field.current?.select(); } }, [editing]);

  function finish(confirm: boolean) {
    dirtyChanged.current?.(false); setPlan(null); setError('');
    if (confirm || document.activeElement !== field.current) {
      setEditing(false);
      requestAnimationFrame(() => { if (document.activeElement === document.body) trigger.current?.focus(); });
    }
  }
  function close() {
    if (!inFlight.current) finish(true);
  }
  async function apply(operation: MovePlan, confirm: boolean) {
    const next = value(await api.applyMove(token, operation.id));
    if (mounted.current) setPlan(next);
    // A partial move must update the editor's path too. The existing move journal
    // retains unfinished references for retry, including after this editor closes.
    await onApplied(next);
    if (!mounted.current) return false;
    if (next.moved && !next.error && next.edits.every((edit) => edit.done) && !next.warnings.length) {
      finish(confirm);
      return true;
    }
    return false;
  }
  async function submit(confirm = false): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    if (!editing) return true;
    if (disabled || note.readOnly || composing || (!confirm && (plan || error))) return false;
    const name = title.trim();
    if (!name || /[/\\\r\n]/.test(name)) { setError('标题不能为空，也不能包含换行或路径分隔符。'); return false; }
    const destination = `${note.path.slice(0, note.path.lastIndexOf('/') + 1)}${name}.md`;
    try { notePath(destination); } catch (cause) { setError((cause as Error).message); return false; }
    if (!plan && destination === note.path) { finish(confirm); return true; }
    const origin = { token, path: note.path };
    setPending(true); setError('');
    const operation = (async () => {
      let completed = false;
      try {
        if (!await before()) { if (mounted.current) setError('正文尚未保存，标题未修改。请先处理笔记中的保存提示。'); return false; }
        await run(async () => {
          try {
            if (!mounted.current || current.current.token !== origin.token || current.current.path !== origin.path) return;
            if (plan) { completed = await apply(plan, confirm); return; }
            // before() may assign an ID or save a draft: plan against that saved
            // revision, never the revision captured when title editing started.
            const saved = value(await api.read(token, origin.path));
            if (note.id && saved.id !== note.id) throw new Error('笔记身份已改变，请重新打开后再修改标题。');
            const preview = value(await api.planMove(token, saved.path, destination, saved.revision));
            if (!mounted.current || current.current.token !== origin.token || current.current.path !== origin.path) return;
            setPlan(preview);
            if (!preview.edits.length && !preview.warnings.length) completed = await apply(preview, confirm);
          } catch (cause) { if (mounted.current) setError((cause as Error).message); }
        });
      } catch (cause) { if (mounted.current) setError((cause as Error).message); }
      return completed;
    })();
    inFlight.current = operation;
    try { return await operation; }
    finally { inFlight.current = null; if (mounted.current) setPending(false); }
  }
  const locked = disabled || pending || note.readOnly;
  const latestSubmit = useRef(submit); latestSubmit.current = submit;
  useImperativeHandle(flushRef, () => ({ flush: () => latestSubmit.current() }), []);
  useEffect(() => {
    if (!editing || locked || composing || plan || error || title === noteName(note.path)) return;
    const timer = window.setTimeout(() => { void latestSubmit.current(); }, 650);
    return () => window.clearTimeout(timer);
  }, [editing, title, locked, composing, plan, error, note.path]);
  const canApply = !plan || !plan.started || !plan.moved || !!plan.error || plan.edits.some((edit) => !edit.done);
  return <div className="note-title-editor" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) void submit();
  }}>
    <h1 ref={headingRef} tabIndex={-1} aria-label={noteName(note.path)}>
      {editing ? <textarea ref={field} rows={1} aria-label="笔记标题" value={title} readOnly={locked || !!plan?.started} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={(event) => { setTitle(event.target.value); dirtyChanged.current?.(true); setPlan(null); setError(''); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); if (canApply) void submit(true); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      }} /> : note.readOnly ? noteName(note.path) : <button ref={trigger} className="note-title-trigger" disabled={disabled} title="修改笔记标题" aria-label="修改笔记标题" onClick={() => { setTitle(noteName(note.path)); setPlan(null); setError(''); setEditing(true); dirtyChanged.current?.(true); }}>{noteName(note.path)}</button>}
    </h1>
    {editing && <>
      <div className="note-title-actions">
        {canApply && <button disabled={locked} aria-label={plan ? plan.started ? '重试标题与引用变更' : '确认改名并维护引用' : '保存笔记标题'} title={plan ? plan.started ? '重试未完成项' : '确认改名并维护引用' : '保存标题（Enter）'} onClick={() => { void submit(true); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
        <button disabled={pending} aria-label={plan?.started ? '关闭标题编辑' : '取消标题修改'} title={plan?.started ? '关闭；未完成引用可从笔记操作中继续处理' : '取消（Escape）'} onClick={close}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
      </div>
      {plan && <div className="note-title-plan">
        <p role="status">{plan.started ? `${plan.moved ? '标题已修改' : '标题未修改'} · 引用已完成 ${plan.edits.filter((edit) => edit.done).length}/${plan.edits.length}` : `将更新 ${plan.edits.length} 篇笔记中的 ${plan.edits.reduce((count, edit) => count + edit.count, 0)} 处引用，请确认。`}</p>
        {plan.error && <p role="alert">{plan.error}</p>}
        {!!plan.edits.length && <ul>{plan.edits.map((edit) => <li key={edit.path}><span>{edit.path} · {edit.count} 处{plan.started ? edit.done ? ' · 已完成' : ' · 未完成' : ''}</span>{edit.error && <p role="alert">{edit.error}</p>}<details><summary>查看引用</summary>{edit.links.map((link, index) => <p key={index}>{link}</p>)}</details></li>)}</ul>}
        {plan.warnings.map((warning, index) => <p role="note" key={index}>{warning}</p>)}
      </div>}
      {error && <p className="note-title-error" role="alert">{error}</p>}
    </>}
  </div>;
}
