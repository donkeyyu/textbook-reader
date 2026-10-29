import { useRef } from 'react';
import { uiStyles, type UiStyle } from '../../appearance/ui-style';
import { textbooks } from '../../textbook/library';

export function ShelfSettings({ style, error, onChange }: {
  style: UiStyle;
  error: string;
  onChange: (style: UiStyle) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return <>
    <button ref={trigger} type="button" className="icon-button shelf-settings-trigger" aria-label="设置" title="设置"
      onClick={() => dialog.current?.showModal()}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9.3 3-.7 2.3-1.7 1-2.3-.5-2 3.4 1.6 1.8v2l-1.6 1.8 2 3.4 2.3-.5 1.7 1 .7 2.3h4l.7-2.3 1.7-1 2.3.5 2-3.4-1.6-1.8v-2l1.6-1.8-2-3.4-2.3.5-1.7-1-.7-2.3h-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="11.3" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/></svg>
    </button>
    <dialog ref={dialog} className="shelf-picker shelf-settings" aria-labelledby="shelf-settings-title"
      onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <div className="shelf-picker-heading"><h2 id="shelf-settings-title">设置</h2>
        <button type="button" className="icon-button" aria-label="关闭设置" title="关闭设置" onClick={() => dialog.current?.close()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <fieldset className="style-fieldset">
        <legend>风格</legend>
        <p className="style-help">选择后立即应用于书架和阅读页。</p>
        <div className="style-options">
          {(Object.entries(uiStyles) as [UiStyle, (typeof uiStyles)[UiStyle]][]).map(([value, option]) => <label key={value}
            className={`style-option style-option-${value}`}>
            <span className="style-sample" aria-hidden="true"><span className="style-sample-header"/><span className="style-sample-book">{value !== 'simple' && <img src={textbooks[0].cover} alt="" width="1304" height="1843" />}</span><span className="style-sample-copy"/><span className="style-sample-action"/></span>
            <span className="style-option-name">{option.label}</span>
            <input type="radio" name="ui-style" value={value} checked={style === value} onChange={() => onChange(value)} />
            <span className="style-option-description">{option.description}</span>
          </label>)}
        </div>
        <p className="style-local-note">风格选择保存在本浏览器。</p>
        {error && <div className="style-save-error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => {
          onChange(style);
          dialog.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
        }}>重试保存</button></div>}
      </fieldset>
    </dialog>
  </>;
}
