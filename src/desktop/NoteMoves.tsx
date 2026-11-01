import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, Note, Result } from '../../desktop/contracts';
import type { MovePlan, MoveStatus } from '../../desktop/moves';

export const noteName = (path: string) => path.split('/').at(-1)!.slice(0, -3);
export const noteDirectory = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '笔记库根目录';
const complete = (plan: MovePlan) => plan.moved && !plan.error && plan.edits.every((edit) => edit.done) && !plan.warnings.length;
const retryable = (plan: MovePlan) => !plan.moved || !!plan.error || plan.edits.some((edit) => !edit.done);
function value<T>(result: Result<T>) { if (!result.ok) throw new Error(result.error); return result.value; }

export function NoteMoves({ api, token, note, disabled, refresh, before, run, onApplied }: {
  api: DesktopApi; token: string; note?: Note; disabled: boolean; refresh: unknown;
  before: () => Promise<boolean>; run: (action: () => Promise<void>) => Promise<void>; onApplied: (plan: MovePlan) => Promise<void>;
}) {
  const [status, setStatus] = useState<MoveStatus>({ operations: [], notices: [] });
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<Note | undefined>(undefined);
  async function reload() {
    const result = await api.moveStatus(token);
    if (result.ok) setStatus(result.value); else setError(result.error);
  }
  useEffect(() => { let active = true; void api.moveStatus(token).then((result) => { if (!active) return; if (result.ok) setStatus(result.value); else setError(result.error); }); return () => { active = false; }; }, [token, refresh]);
  useEffect(() => { if (show) dialog.current?.showModal(); }, [show]);
  function close() { dialog.current?.close(); setShow(false); setPlan(null); setError(''); }
  async function apply(operation: MovePlan) {
    setError('');
    const next = value(await api.applyMove(token, operation.id));
    setPlan(next); await onApplied(next); await reload();
  }
  const pending = status.operations.filter((operation) => !complete(operation));
  return <section className="note-moves" aria-label="改名与引用维护">
    <div className="note-move-actions">
      {note && !note.readOnly && <button disabled={disabled} onClick={() => { void (async () => {
        if (!await before()) return;
        // Read the saved version after before() has flushed the current draft.
        await run(async () => {
          origin.current = value(await api.read(token, note.path));
          setDestination(note.path); setPlan(null); setError(''); setShow(true);
        });
      })(); }}>改名或移动</button>}
      {(pending.length > 0 || status.notices.length > 0 || error) && <details open><summary>待处理引用 · {pending.length + status.notices.length}</summary>
        {error && !show && <p role="alert">{error}</p>}
        {status.notices.map((notice) => <div key={notice.id}><p>发现外部路径变化：{notice.from} → {notice.to}{notice.problem && ` · ${notice.problem}`}</p>
          {!notice.problem && <button disabled={disabled} onClick={() => { void (async () => {
            if (!await before()) return;
            await run(async () => { setPlan(value(await api.planRepair(token, notice.id))); setError(''); setShow(true); });
          })(); }}>预览引用修复</button>}
        </div>)}
        {pending.map((operation) => <div key={operation.id}><p>{operation.from} → {operation.to} · {operation.moved ? '路径已完成' : '路径未完成'} · 引用 {operation.edits.filter((edit) => edit.done).length}/{operation.edits.length}{operation.warnings.length > 0 && ` · ${operation.warnings.length} 项需手动核对`}</p>
          <button disabled={disabled} onClick={() => { setPlan(operation); setError(''); setShow(true); }}>{retryable(operation) ? '查看并重试' : '查看未处理项'}</button>
        </div>)}
      </details>}
    </div>
    <dialog ref={dialog} className="vault-guard note-move-dialog" aria-label="改名与移动笔记" onCancel={(event) => { event.preventDefault(); close(); }}>
      <h2>{plan?.external ? '修复外部移动后的引用' : '改名或移动笔记'}</h2>
      {!plan ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
        try { setPlan(value(await api.planMove(token, origin.current!.path, destination.endsWith('.md') ? destination : `${destination}.md`, origin.current!.revision))); setError(''); }
        catch (cause) { setError((cause as Error).message); }
      }); }}><p>输入库内完整路径。目标目录须已存在。</p><label>新名称或路径<input autoFocus aria-label="移动目标路径" value={destination} onChange={(event) => setDestination(event.target.value)} /></label><button disabled={disabled || !destination} type="submit">预览引用变更</button></form> : <>
        <p className="note-move-path">{plan.from} → {plan.to}</p>
        <p role="status">{!plan.started ? `确认可改写引用：${plan.edits.length} 篇，${plan.edits.reduce((count, edit) => count + edit.count, 0)} 处。` : complete(plan) ? `路径及 ${plan.edits.length} 篇引用已完成。` : `尚未全部完成 · ${plan.moved ? '路径已完成' : '路径未完成'} · 引用 ${plan.edits.filter((edit) => edit.done).length}/${plan.edits.length}${plan.warnings.length ? ` · ${plan.warnings.length} 项需手动核对` : ''}`}</p>
        {plan.error && <p role="alert">{plan.error}</p>}
        <ul className="note-move-results">{plan.edits.map((edit) => <li key={edit.path}><strong>{noteName(edit.path)}</strong><small>{edit.path} · {edit.count} 处 · {edit.done ? '已完成' : '未完成'}</small>{edit.error && <p role="alert">{edit.error}</p>}
          <details><summary>查看引用</summary>{edit.links.map((link, index) => <p key={index}>{link}</p>)}</details>
        </li>)}</ul>
        {plan.warnings.length > 0 && <div role="note"><p>以下内容需手动核对：</p>{plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      </>}
      {error && <p role="alert">{error}</p>}
      <div><button disabled={disabled} onClick={close}>{plan?.started ? '关闭' : '取消'}</button>{plan && (!plan.started || retryable(plan)) && <button disabled={disabled} onClick={() => { void run(async () => { try { await apply(plan); } catch (cause) { setError((cause as Error).message); } }); }}>{plan.started ? '重试未完成项' : plan.external ? '确认修复引用' : '确认改名并维护引用'}</button>}</div>
    </dialog>
  </section>;
}
