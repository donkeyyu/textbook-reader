export type Position = { cursor: number; scroll: number };
export type VaultState = { activePath?: string; positions: Record<string, Position>; sidebarWidth?: number };
export type Note = { path: string; source: string; revision: string; readOnly: boolean; problems: string[] };
export type VaultView = { token: string; name: string; notes: string[]; state: VaultState; notice?: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type DesktopApi = {
  restore: () => Promise<Result<VaultView | null>>;
  chooseVault: () => Promise<Result<VaultView | null>>;
  list: (token: string) => Promise<Result<string[]>>;
  read: (token: string, path: string) => Promise<Result<Note>>;
  save: (token: string, path: string, source: string, revision: string | null) => Promise<Result<Note>>;
  saveState: (token: string, state: VaultState) => Promise<Result<null>>;
  setDirty: (dirty: boolean) => void;
};
