import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextbookStore, textbookId } from './textbooks.ts';
import { InitialNotes, loadInitialPackage } from './initial-notes.ts';
import { digest, Vault } from './vault.ts';
import { LocalState, cleanState } from './state.ts';
import { VaultSettingsStore } from './settings.ts';
import type { Result, VaultState, VaultView } from './contracts.ts';

const appUrl = 'textbook://app/';
const here = path.dirname(fileURLToPath(import.meta.url));
const resources = path.resolve(here, '../dist');
protocol.registerSchemesAsPrivileged([{ scheme: 'textbook', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const dataOverride = app.commandLine.getSwitchValue('user-data-dir');
if (dataOverride && path.isAbsolute(dataOverride)) app.setPath('userData', dataOverride);
const local = new LocalState(app.getPath('userData'));
let window: BrowserWindow;
let vault: Vault | null = null;
let settings: VaultSettingsStore;
let state: VaultState = { positions: {} };
let dirty = false;
let closing = false;
let queue: Promise<unknown> = Promise.resolve();
let textbooks: TextbookStore;
let initialNotes: InitialNotes;
let stopWatching: (() => void) | undefined;
let refreshQueued = false;

function watchVault(next: Vault) {
  stopWatching?.();
  stopWatching = next.watch(() => {
    if (refreshQueued || vault !== next) return;
    refreshQueued = true;
    queue = queue.then(async () => {
      if (vault !== next || window.isDestroyed()) return;
      try {
        const change = await next.scan();
        if (change.changed.length) window.webContents.send('vault:change', change);
      } catch (cause) {
        window.webContents.send('vault:change', { token: next.token, error: (cause as Error).message, notes: [], changed: [], duplicates: {} });
      }
    }).finally(() => { refreshQueued = false; });
  });
}

export function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === appUrl;
}

function current(token: unknown) {
  if (!vault || token !== vault.token) throw new Error('笔记库已切换，请重新读取。');
  return vault;
}
function handle(channel: string, operation: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args): Promise<Result<unknown>> => {
    if (!trustedSender(event)) return Promise.resolve({ ok: false, error: '调用来源无效。' });
    const result = queue.then(async () => {
      try { return { ok: true as const, value: await operation(...args) }; }
      catch (cause) { return { ok: false as const, error: (cause as Error).message, code: (cause as NodeJS.ErrnoException).code }; }
    });
    queue = result;
    return result;
  });
}
async function persist() {
  if (vault && window && !window.isDestroyed()) await local.save(vault.root, state, window.getNormalBounds());
}
function restoreBounds(value: unknown) {
  const bounds = value as Partial<Electron.Rectangle> | null;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every((number) => Number.isSafeInteger(number) && Math.abs(number!) < 1_000_000)) return;
  const area = screen.getDisplayMatching(bounds as Electron.Rectangle).workArea;
  const width = Math.min(area.width, Math.max(720, bounds.width!));
  const height = Math.min(area.height, Math.max(480, bounds.height!));
  window.setBounds({ width, height, x: Math.max(area.x, Math.min(bounds.x!, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y!, area.y + area.height - height)) });
}
async function select(root: string): Promise<VaultView> {
  const next = await Vault.open(root, path.join(local.directory, 'save-recovery'));
  const { notes } = await next.scan();
  let saved: Awaited<ReturnType<LocalState['load']>> = { state: { positions: {} }, bounds: undefined };
  let notice = '';
  try { saved = await local.load(next.root); } catch (error) { notice = (error as Error).message; }
  await persist();
  // Remembering a choice is required before reporting a successful transition.
  await local.remember(next.root);
  vault = next; settings = new VaultSettingsStore(next.root); state = saved.state;
  watchVault(next);
  restoreBounds(saved.bounds);
  return { token: next.token, name: path.basename(next.root), notes, state, notice };
}

handle('vault:restore', async () => {
  if (vault) return { token: vault.token, name: path.basename(vault.root), notes: await vault.list(), state };
  const root = await local.lastVault();
  return root ? select(root) : null;
});
handle('vault:choose', async () => {
  const choice = await dialog.showOpenDialog(window, { title: '选择笔记库', properties: ['openDirectory', 'createDirectory'] });
  return choice.canceled || !choice.filePaths[0] ? null : select(choice.filePaths[0]);
});
handle('vault:list', async (token) => { const change = await current(token).scan(); window.webContents.send('vault:change', change); return change.notes; });
handle('vault:links', async (token) => current(token).links((change) => window.webContents.send('vault:change', change)));
handle('vault:read', async (token, relative) => {
  if (typeof relative !== 'string') throw new Error('笔记路径无效。');
  return current(token).read(relative);
});
handle('vault:save', async (token, relative, source, revision) => {
  if (typeof relative !== 'string' || typeof source !== 'string' || (revision !== null && typeof revision !== 'string')) throw new Error('保存参数无效。');
  const active = current(token);
  const note = await active.save(relative, source, revision);
  window.webContents.send('vault:change', { ...await active.scan(), changed: [note.path] });
  return note;
});
handle('vault:copy', async (token, relative, source, revision, replaceIdentity) => {
  if (typeof relative !== 'string' || typeof source !== 'string' || typeof revision !== 'string' || typeof replaceIdentity !== 'boolean') throw new Error('复制参数无效。');
  const active = current(token);
  const note = await active.copy(relative, source, revision, replaceIdentity);
  window.webContents.send('vault:change', { ...await active.scan(), changed: [note.path] });
  return note;
});
handle('vault:protect-draft', async (token, relative, source) => {
  if (typeof relative !== 'string' || typeof source !== 'string') throw new Error('草稿参数无效。');
  return current(token).protectDraft(relative, source);
});
handle('vault:recoveries', async (token) => current(token).recoveries());
handle('vault:state', async (token, input) => {
  current(token); state = cleanState(input); await persist(); return null;
});
handle('vault:settings:read', async (token) => { current(token); return settings.read(); });
handle('vault:settings:save', async (token, revision, patch) => { current(token); return settings.save(revision, patch); });
ipcMain.on('vault:dirty', (event, value: unknown) => {
  if (trustedSender(event) && typeof value === 'boolean') dirty = value;
  event.returnValue = null;
});

// Downloads run separately from the note queue so note saves and progress reads remain available.
function textbookHandle(channel: string, operation: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
    if (!trustedSender(event)) return { ok: false, error: '调用来源无效。' };
    try { return { ok: true, value: await operation(...args) }; }
    catch (error) { return { ok: false, error: (error as Error).message }; }
  });
}
textbookHandle('textbooks:context', async () => { await queue; return vault ? { vaultToken: vault.token, vaultKey: digest(vault.root), name: path.basename(vault.root) } : null; });
textbookHandle('textbooks:status', async () => textbooks.snapshot());
textbookHandle('textbooks:add', async (token, id) => {
  const selected = current(token);
  if (id !== textbookId) throw new Error('教材版本不可用。');
  await textbooks.download();
  // Catalog commit and vault selection share the note queue; network transfer does not.
  const result = queue.then(async () => {
    const assertCurrent = () => { current(token); };
    const added = await textbooks.addToVault(selected.root, id, assertCurrent);
    const imported = await initialNotes.import(selected, assertCurrent);
    window.webContents.send('vault:change', await selected.scan());
    return { ...added, initialNotes: imported };
  });
  queue = result.catch(() => {});
  return result;
});
handle('textbooks:notes', async (token) => initialNotes.index(current(token)));
handle('textbooks:note', async (token, sourceId) => initialNotes.note(current(token), sourceId));
textbookHandle('textbooks:catalog', async (token) => { const selected = current(token); const catalog = await textbooks.catalog(selected.root); current(token); return catalog; });

void app.whenReady().then(async () => {
textbooks = new TextbookStore(path.resolve(here, '..'), local.directory, process.env.TEXTBOOK_DOWNLOAD_BASE_URL || null, app.commandLine.hasSwitch('textbook-local-http'));
await textbooks.initialize();
initialNotes = new InitialNotes(await loadInitialPackage(path.resolve(here, '..')));
protocol.handle('textbook', async (request) => {
  const url = new URL(request.url);
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const full = path.resolve(resources, `.${relative}`);
  if (url.host !== 'app' || !full.startsWith(`${resources}${path.sep}`) || request.method !== 'GET') return new Response('', { status: 403 });
  if (relative.startsWith('/textbooks/')) {
    try {
      const bytes = await textbooks.read(relative.slice(1));
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': relative.endsWith('.json') ? 'application/json' : 'image/webp', 'Cache-Control': 'no-store' } });
    } catch { return new Response('教材资源不可用，请重试下载。', { status: 404 }); }
  }
  const response = await net.fetch(pathToFileURL(full).href);
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
  return new Response(response.body, { status: response.status, headers });
});
window = new BrowserWindow({ width: 1100, height: 780, minWidth: 720, minHeight: 480, title: '课本解读',
  webPreferences: { preload: path.join(here, '../desktop/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });
window.webContents.on('will-prevent-unload', (event) => {
  if (!dirty || dialog.showMessageBoxSync(window, { type: 'warning', message: '重新载入会丢失未保存的草稿。', buttons: ['继续编辑', '放弃并重新载入'], defaultId: 0, cancelId: 0 }) === 1) event.preventDefault();
});
window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
window.webContents.session.setPermissionCheckHandler(() => false);
window.on('close', (event) => {
  if (closing) return;
  event.preventDefault();
  if (dirty && dialog.showMessageBoxSync(window, { type: 'warning', message: '还有未保存的草稿。', detail: '返回编辑器保存，或放弃草稿并关闭。', buttons: ['继续编辑', '放弃并关闭'], defaultId: 0, cancelId: 0 }) === 0) return;
  closing = true;
  void queue.then(persist).then(() => { window.destroy(); app.quit(); }).catch((error: Error) => {
    closing = false; dialog.showErrorBox('本机状态未保存', `${error.message}\n笔记正文未改动，请重试关闭。`);
  });
});
await window.loadURL(appUrl);
app.on('window-all-closed', () => { stopWatching?.(); app.quit(); });
}).catch((error: Error) => { dialog.showErrorBox('桌面应用无法启动', error.message); app.quit(); });
