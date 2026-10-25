import { createClient } from '@supabase/supabase-js';

// This publishable key is public client configuration. Personal data is protected
// by authenticated RPCs and RLS. No service-role credential is sent to a browser.
const env = import.meta.env ?? {};
export const supabase = createClient(
  env.VITE_SUPABASE_URL ?? 'https://ttibfyiittkyteodrwgf.supabase.co',
  env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ETeFBh-s02rrh0gIr2oCtg_klrZ1Hns',
);

export async function signIn(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { emailRedirectTo: `${location.origin}${location.pathname}` },
  });
  if (error) throw new Error(`登录邮件未能发送：${error.message}`, { cause: error });
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('测试账号登录失败，请检查邮箱和密码后重试。', { cause: error });
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error(`退出失败：${error.message}`, { cause: error });
}
