import path from 'node:path';
import { atomicState, digest, readJson } from './vault.ts';
import type { VaultState } from './contracts.ts';

export function cleanState(input: unknown): VaultState {
  const value = input as Partial<VaultState> | null;
  const positions: VaultState['positions'] = Object.create(null);
  if (value?.positions && typeof value.positions === 'object') {
    for (const [name, item] of Object.entries(value.positions).slice(0, 2000)) {
      if (item && Number.isFinite(item.cursor) && Number.isFinite(item.scroll)) {
        positions[name] = { cursor: Math.max(0, Math.floor(item.cursor)), scroll: Math.max(0, item.scroll) };
      }
    }
  }
  return { positions, activePath: typeof value?.activePath === 'string' ? value.activePath : undefined,
    sidebarWidth: Number.isFinite(value?.sidebarWidth) ? Math.max(180, Math.min(480, value!.sidebarWidth!)) : undefined };
}

export class LocalState {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async lastVault() {
    const value = await readJson(path.join(this.directory, 'last-vault.json')) as { root?: unknown } | null;
    return typeof value?.root === 'string' ? value.root : null;
  }
  async remember(root: string) { await atomicState(path.join(this.directory, 'last-vault.json'), { root }); }
  private file(root: string) { return path.join(this.directory, 'vaults', `${digest(root)}.json`); }
  async load(root: string) {
    const value = await readJson(this.file(root)) as { state?: unknown; bounds?: unknown } | null;
    return { state: cleanState(value?.state), bounds: value?.bounds };
  }
  async save(root: string, state: VaultState, bounds: unknown) { await atomicState(this.file(root), { state: cleanState(state), bounds }); }
}
