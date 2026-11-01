import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, Result } from '../../desktop/contracts';
import type { Catalog } from '../../desktop/anchors';
import type { CustomView, CustomEdit, CustomDeletion } from '../../desktop/custom-catalog';
function value<T>(result: Result<T>) { if (!result.ok) throw new Error(result.error); return result.value; }

export function CustomCatalogManager({ api, token, catalog, disabled, before, run, onRefresh, onApplied }: {
  api: DesktopApi; token: string; catalog: Catalog | null; disabled: boolean;
  before: () => Promise<boolean>; run: (action: () => Promise<void>) => Promise<void>;
  onRefresh: () => Promise<void>; onApplied: () => Promise<void>;
}) {
  const [custom, setCustom] = useState<CustomView>();
  const [pending, setPending] = useState<CustomDeletion[]>([]);
  const [edit, setEdit] = useState<CustomEdit>({ kind: 'chapter', title: '' });
  const [plan, setPlan] = useState<CustomDeletion>();
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [show, setShow] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  async function reload() {
    setCustom(value(await api.customCatalog(token))); setPending(value(await api.customDeletions(token)));
  }
  useEffect(() => {
    let active = true;
    void Promise.all([api.customCatalog(token), api.customDeletions(token)]).then(([custom, pending]) => {
      if (!active) return;
      if (custom.ok) { setCustom(custom.value); } else setError(custom.error);
      if (pending.ok) setPending(pending.value);
    });
    return () => { active = false; };
  }, [token, catalog]);
  useEffect(() => { if (show) dialog.current?.showModal(); }, [show]);
  function close() { request.current++; dialog.current?.close(); setShow(false); setPlan(undefined); setReplacement(''); }
  function action(task: () => Promise<void>, save = false) {
    void (async () => {
      if (save && !await before()) return;
      await run(async () => { try { setError(''); await task(); } catch (cause) { setError((cause as Error).message); } });
    })();
  }
  async function preview(kind: 'chapter' | 'section', id: string, nextReplacement = '') {
    if (!custom) return;
    const serial = ++request.current;
    const result = value(await api.planCustomDeletion(token, custom.revision, kind, id, nextReplacement === '@remove' || !nextReplacement ? null : nextReplacement));
    if (serial === request.current) { setPlan(result); setReplacement(nextReplacement); setNotice(''); }
  }
  const readonly = disabled || !catalog || !custom || custom.readOnly;
  const choices = plan?.kind === 'chapter' ? catalog?.chapters : catalog?.sections;
  return <div className="custom-catalog">
    <button disabled={disabled} onClick={() => { setShow(true); action(reload); }}>管理自定义目录{pending.length ? ` · ${pending.length} 项未完成` : ''}</button>
    {(custom?.problem || error && !show) && <p role="note">{custom?.problem || error} 目录原值已保留。</p>}
    <dialog ref={dialog} className="vault-guard custom-catalog-dialog" aria-label="管理自定义目录" onCancel={(event) => { event.preventDefault(); if (!disabled) close(); }}>
      <h2>自定义目录</h2><p>同一笔记库、同教材的笔记共用。教材索引保持只读；目录归属不改变页面和区域。</p>
      <button disabled={disabled} onClick={() => action(async () => { await onRefresh(); await reload(); setNotice('已重新读取目录。'); })}>重新读取目录</button>
      {custom?.problem && <p role="alert">{custom.problem}</p>}
      {!plan ? <>
        <form className="custom-catalog-form" onSubmit={(event) => { event.preventDefault(); action(async () => {
          const result = value(await api.saveCustomCatalog(token, custom!.revision, edit));
          setCustom(result.view); setNotice(result.reused ? `同父级已有「${result.entry.title}」，请在笔记位置中复用；本次未改写目录。` : `已${edit.id ? '改名' : '添加'}「${result.entry.title}」。`);
          if (!result.reused) setEdit({ kind: edit.kind, title: '', chapterId: edit.chapterId });
          await onRefresh();
        }, true); }}>
          <label>条目类型<select aria-label="自定义条目类型" disabled={readonly || !!edit.id} value={edit.kind} onChange={(event) => setEdit({ kind: event.target.value as CustomEdit['kind'], title: '' })}><option value="chapter">章</option><option value="section">节</option></select></label>
          {edit.kind === 'section' && <label>父章<select aria-label="自定义节父章" disabled={readonly || !!edit.id} value={edit.chapterId ?? ''} onChange={(event) => setEdit({ ...edit, chapterId: event.target.value })}><option value="">请选择章</option>{catalog?.chapters.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}{entry.source === 'custom' ? '（自定义）' : '（教材索引）'}</option>)}{edit.chapterId && !catalog?.chapters.some((entry) => entry.id === edit.chapterId) && <option value={edit.chapterId}>{edit.chapterId}（父章已失效）</option>}</select></label>}
          <label>名称<input aria-label="自定义目录名称" maxLength={200} disabled={readonly} value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></label>
          <button disabled={readonly || !edit.title.trim() || edit.kind === 'section' && !edit.chapterId} type="submit">{edit.id ? '保存目录名称' : '添加目录条目'}</button>
          {edit.id && <button type="button" onClick={() => setEdit({ kind: edit.kind, title: '' })}>取消改名</button>}
        </form>
        <ul className="custom-catalog-list">{custom && (['chapter', 'section'] as const).flatMap((kind) => (kind === 'chapter' ? custom.data.chapters : custom.data.sections).map((entry) => <li key={entry.id}><span><strong>{entry.title}</strong><small>{kind === 'chapter' ? '自定义章' : `自定义节 · ${catalog?.chapters.find((chapter) => chapter.id === entry.chapterId)?.title ?? `${entry.chapterId}（父章已失效）`}`}</small></span>
          <button disabled={readonly} onClick={() => { setEdit({ kind, id: entry.id, title: entry.title, chapterId: entry.chapterId }); setNotice(''); }}>改名 {entry.title}</button>
          <button disabled={readonly} onClick={() => action(() => preview(kind, entry.id), true)}>删除 {entry.title}</button>
        </li>))}</ul>
        {custom && !custom.data.chapters.length && !custom.data.sections.length && <p>还没有自定义目录。可添加章，或在已有章下添加节。</p>}
        {pending.map((operation) => <p key={operation.id}>未完成：{operation.title} · 已处理 {operation.edits.filter((edit) => edit.done).length}/{operation.edits.length} 篇 <button disabled={disabled} onClick={() => { setPlan(operation); setReplacement(operation.replacement ?? '@remove'); }}>查看目录删除记录</button></p>)}
      </> : <section aria-label="目录删除预览">
        <h3>删除「{plan.title}」{plan.kind === 'chapter' && plan.children.length ? `及 ${plan.children.length} 个自定义节` : ''}</h3>
        <p role="status">{plan.removed ? '目录条目及引用处理已完成。' : `${plan.edits.length} 篇笔记，${plan.edits.reduce((count, edit) => count + edit.count, 0)} 处引用${plan.problems.length ? '；另有无法确认的引用，删除受阻' : ''}。`}</p>
        {!plan.started && <label>引用处理<select aria-label="删除目录引用处理" value={replacement} disabled={disabled} onChange={(event) => { const next = event.target.value; action(() => preview(plan.kind, plan.entryId, next), true); }}><option value="">请选择处理方式</option><option value="@remove">明确移除{plan.kind === 'chapter' ? '章及节' : '节'}归属，保留页面和区域</option>{choices?.filter((entry) => entry.id !== plan.entryId).map((entry) => <option key={entry.id} value={entry.id}>替换为 {entry.title}{'chapterId' in entry ? ` · ${catalog?.chapters.find((chapter) => chapter.id === entry.chapterId)?.title ?? entry.chapterId}` : ''}{entry.source === 'custom' ? '（自定义）' : '（教材索引）'}</option>)}</select></label>}
        {plan.kind === 'chapter' && <p>替换章时移除原节归属；页面、区域和其他字段保留。</p>}
        <ul className="custom-catalog-results">{plan.edits.map((edit) => <li key={edit.path}>{edit.path} · {edit.count} 处 · {edit.done ? '已完成' : '未完成'}{edit.error && <p role="alert">{edit.error}</p>}</li>)}</ul>
        {plan.error && <p role="alert">{plan.error}</p>}{plan.problems.map((problem) => <p role="note" key={problem}>{problem}</p>)}
        {!plan.removed && <button disabled={readonly || !replacement} onClick={() => action(async () => {
          const result = value(await api.applyCustomDeletion(token, plan.id)); setPlan(result);
          await onApplied(); await onRefresh(); await reload();
        }, true)}>{plan.started ? '重试目录删除未完成项' : '确认删除并处理引用'}</button>}
        <button disabled={disabled} onClick={() => { request.current++; setPlan(undefined); setReplacement(''); }}>{plan.started ? '返回目录管理' : '取消删除'}</button>
      </section>}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
      <div><button disabled={disabled} onClick={close}>关闭目录管理</button></div>
    </dialog>
  </div>;
}
