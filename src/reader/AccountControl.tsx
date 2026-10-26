import { useId, useRef, useState } from 'react';
import './AccountControl.css';

export function AccountControl({ user, onSignIn, onPasswordSignIn, onSignOut }: {
  user: { id: string; email?: string } | null;
  onSignIn: (email: string) => Promise<void>;
  onPasswordSignIn?: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const inFlight = useRef(false);
  const emailId = useId();
  const errorId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordLogin, setPasswordLogin] = useState(false);
  const [pending, setPending] = useState<'sign-in' | 'sign-out' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const passwordMode = Boolean(onPasswordSignIn) && passwordLogin;
  const heading = user ? '个人账号' : passwordMode ? '测试账号登录' : '邮箱登录';

  function close() {
    setPassword('');
    setPasswordLogin(false);
    if (!details.current) return;
    details.current.open = false;
    details.current.querySelector('summary')?.focus();
  }

  async function submit(action: 'sign-in' | 'sign-out') {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setError('');
    setMessage('');
    try {
      if (action === 'sign-in') {
        const address = email.trim();
        if (passwordMode && onPasswordSignIn) {
          await onPasswordSignIn(address, password);
          close();
        } else {
          await onSignIn(address);
          setMessage(`登录邮件已发送至 ${address}。请打开邮件中的链接完成登录。`);
        }
      } else {
        await onSignOut();
        close();
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '操作失败，请重试。');
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return <details ref={details} className="account-control" onToggle={(event) => {
    if (!event.currentTarget.open) {
      setPassword('');
      setPasswordLogin(false);
    }
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && details.current?.open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <summary className="account-summary" aria-label={user ? '账号' : '登录'} title={user ? '账号' : '登录'}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 21v-2a7 7 0 0 1 14 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </summary>
    <section className="account-options" aria-label={heading} aria-busy={pending !== null}>
      <div className="account-heading">
        <h2>{heading}</h2>
        <button type="button" className="text-button" onClick={close}>关闭</button>
      </div>
      {user ? <>
        <p className="account-email">{user.email || '已登录'}</p>
        <button type="button" className="text-button" disabled={pending !== null} onClick={() => { void submit('sign-out'); }}>
          {pending === 'sign-out' ? '正在退出…' : '退出登录'}
        </button>
      </> : <form onSubmit={(event) => {
        event.preventDefault();
        void submit('sign-in');
      }}>
        <p className="account-help">{passwordMode ? '使用已有测试账号的邮箱和密码。' : '使用邮箱接收登录链接，登录后保存个人笔记。'}</p>
        <label htmlFor={emailId}>邮箱地址</label>
        <input id={emailId} name="email" type="email" autoComplete="email" inputMode="email" required
          value={email} disabled={pending !== null} aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setEmail(event.target.value); setError(''); setMessage(''); }} />
        {passwordMode && <>
          <label htmlFor={`${emailId}-password`}>密码</label>
          <input id={`${emailId}-password`} name="password" type="password" autoComplete="off" required
            value={password} disabled={pending !== null} aria-describedby={error ? errorId : undefined}
            onChange={(event) => { setPassword(event.target.value); setError(''); }} />
        </>}
        <button type="submit" className="text-button" disabled={pending !== null}>
          {passwordMode ? pending === 'sign-in' ? '正在登录…' : '登录测试账号' : pending === 'sign-in' ? '正在发送…' : '发送登录邮件'}
        </button>
        {onPasswordSignIn && <button type="button" className="text-button account-mode-toggle" disabled={pending !== null}
          aria-pressed={passwordMode} onClick={() => {
            setPasswordLogin(!passwordMode);
            setPassword(''); setError(''); setMessage('');
          }}>{passwordMode ? '返回邮箱登录' : '测试账号登录'}</button>}
      </form>}
      {error && <p id={errorId} className="account-error" role="alert">{error}</p>}
      {message && !user && <p className="account-message" role="status">{message}</p>}
    </section>
  </details>;
}
