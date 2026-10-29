import { useId, useState } from 'react';
import { LinkContent } from '../reader/links/LinkContent';
import { validPersonalData, type PersonalData } from './personal';
import type { LegacyCopy } from './cloud-personal';
import './LegacyCopies.css';

function decode(raw: string | null): PersonalData | null {
  try { const value: unknown = JSON.parse(raw ?? 'null'); return validPersonalData(value) ? value : null; }
  catch { return null; }
}

export function LegacyCopies({ copies, current, titleForNote }: {
  copies: LegacyCopy[]; current: PersonalData; titleForNote: (id: string) => string;
}) {
  const id = useId();
  const [selection, setSelection] = useState('');
  const [message, setMessage] = useState('');
  const available = copies.filter((copy) => {
    const data = decode(copy.raw);
    return copy.has_conflict || (data && (data.supplements.length > 0 || Object.keys(data.notes).length > 0));
  });
  const key = (copy: LegacyCopy) => `${copy.source_id}:${copy.snapshot_hash}`;
  const selected = available.find((copy) => key(copy) === selection) ?? available[0];
  if (!selected) return null;
  const old = decode(selected.raw);
  const conflicts = available.filter((copy) => copy.has_conflict).length;
  return <details className="legacy-copies">
    <summary>{conflicts ? `查看旧版冲突副本（${conflicts} 份）` : '查看升级前副本'}</summary>
    <div className="legacy-copy-body">
      <p>旧页面版本已保留，可复制需要的文字。查看其他页面保存的最新内容时，请先保全草稿，再选择“重新读取”。</p>
      <label htmlFor={id}>选择副本</label>
      <select id={id} value={key(selected)} onChange={(event) => { setSelection(event.target.value); setMessage(''); }}>
        {available.map((copy) => <option key={key(copy)} value={key(copy)}>
          {copy.has_conflict ? '冲突副本' : '升级前副本'} · {new Date(copy.created_at).toLocaleString('zh-CN')}
        </option>)}
      </select>
      {old && <div className="legacy-comparison">
        <section aria-label="旧页面版本"><h2>旧页面版本</h2>
          {old.supplements.map((item) => <section key={item.id}><h3>{item.title}</h3><LinkContent markdown={item.markdown} /></section>)}
          {Object.entries(old.notes).map(([nodeId, markdown]) => <section key={nodeId}><h3>{titleForNote(nodeId)} · 我的笔记</h3><LinkContent markdown={markdown} /></section>)}
          {!old.supplements.length && !Object.keys(old.notes).length && <p>旧页面保存的是空内容。</p>}
        </section>
        <section aria-label="本页版本"><h2>本页版本</h2>
          {old.supplements.map((item) => {
            const latest = current.supplements.find((value) => value.id === item.id);
            return <section key={item.id}><h3>{latest?.title ?? item.title}</h3>{latest ? <LinkContent markdown={latest.markdown} /> : <p>当前版本中没有这条个人补充。</p>}</section>;
          })}
          {Object.keys(old.notes).map((nodeId) => <section key={nodeId}><h3>{titleForNote(nodeId)} · 我的笔记</h3>{current.notes[nodeId] ? <LinkContent markdown={current.notes[nodeId]!} /> : <p>当前版本中没有这条笔记。</p>}</section>)}
        </section>
      </div>}
      <label htmlFor={`${id}-raw`}>完整旧版数据（可选择复制）</label>
      <textarea id={`${id}-raw`} readOnly value={selected.raw ?? ''} spellCheck={false} />
      <button className="text-button" type="button" onClick={() => {
        void navigator.clipboard?.writeText(selected.raw ?? '').then(() => setMessage('旧版数据已复制。')).catch(() => setMessage('复制未完成，请在上方文本框中选择并复制。'));
        if (!navigator.clipboard) setMessage('请在上方文本框中选择并复制。');
      }}>复制完整旧版数据</button>
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
