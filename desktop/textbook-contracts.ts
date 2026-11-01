import type { Result } from './contracts.ts';
export type TextbookStatus = { textbookId: string; phase: 'checking' | 'unavailable' | 'downloading' | 'ready' | 'error'; completed: number; total: number; error: string; sourceConfigured: boolean };
export type TextbookAdded = { textbookId: string; catalogPath: string; manifestSha256: string };
export type TextbookContext = { vaultToken: string; vaultKey: string; name: string };
export type TextbookApi = {
  context: () => Promise<Result<TextbookContext | null>>;
  status: () => Promise<Result<TextbookStatus>>;
  add: (vaultToken: string, textbookId: string) => Promise<Result<TextbookAdded>>;
  catalog: (vaultToken: string) => Promise<Result<unknown>>;
};
