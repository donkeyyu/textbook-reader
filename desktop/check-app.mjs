// Run against a compiled app, or pass an installed executable with DESKTOP_EXECUTABLE.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, chmod, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-desktop-check-'));
const root = path.join(evidence, '笔记库'); const other = path.join(evidence, '另一个库');
const userData = path.join(evidence, 'app-data');
await mkdir(root); await mkdir(other);
const original = '---\n# 保留注释\n自定义: [甲, 乙]\n---\n# 手动笔记\n\n<script>window.untrustedHtml = true</script>\n' + '长内容用于位置恢复。\n'.repeat(140);
await writeFile(path.join(root, '手动.md'), original);
await writeFile(path.join(root, '较新.md'), '---\n_textbook: {schema_version: 2, id: future}\n---\n只读内容\n');
await writeFile(path.join(root, '坏文件.md'), new Uint8Array([0xff]));
const executablePath = process.env.DESKTOP_EXECUTABLE;
const launch = async () => {
  const instance = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [project]), `--user-data-dir=${userData}`] });
  const page = await instance.firstWindow();
  page.on('pageerror', (error) => console.error('pageerror:', error));
  await page.getByRole('button', { name: '选择笔记库', exact: true }).or(page.getByRole('button', { name: '切换笔记库', exact: true })).waitFor();
  return { instance, page };
};
let { instance, page } = await launch();
async function picker(selection) {
  // The OS picker itself is checked separately; keep automated failure paths deterministic.
  await instance.evaluate(({ dialog }, selection) => { dialog.showOpenDialog = async () => ({ canceled: selection === null, filePaths: selection ? [selection] : [] }); }, selection);
}
try {
  await picker(null);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  assert.deepEqual(await readdir(root), ['坏文件.md', '手动.md', '较新.md']);
  await picker(root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await page.getByRole('button', { name: '手动', exact: true }).click();
  const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
  await editor().waitFor();
  assert.equal(await readFile(path.join(root, '手动.md'), 'utf8'), original);
  assert.equal(await page.evaluate(() => window.untrustedHtml), undefined);
  const boundaries = await page.evaluate(async () => {
    const api = window.textbookDesktop;
    const current = await api.restore();
    const result = await api.read(current.value.token, '../outside.md');
    return { keys: Object.keys(api), node: typeof window.require, process: typeof window.process, traversal: result.ok };
  });
  assert.equal(boundaries.node, 'undefined'); assert.equal(boundaries.process, 'undefined'); assert.equal(boundaries.traversal, false);
  assert.deepEqual(boundaries.keys.sort(), ['chooseVault', 'list', 'read', 'restore', 'save', 'saveState', 'setDirty']);
  const preferences = await instance.evaluate(({ BrowserWindow }) => {
    const web = BrowserWindow.getAllWindows()[0].webContents;
    const settings = web.getLastWebPreferences();
    return { nodeIntegration: settings.nodeIntegration, sandbox: settings.sandbox, contextIsolation: settings.contextIsolation };
  });
  assert.deepEqual(preferences, { nodeIntegration: false, sandbox: true, contextIsolation: true });
  const senders = await instance.evaluate(({ app, BrowserWindow }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const { trustedSender } = require('./build-desktop/main.js');
    const web = BrowserWindow.getAllWindows()[0].webContents;
    return [trustedSender({ sender: web, senderFrame: web.mainFrame }), trustedSender({ sender: {}, senderFrame: web.mainFrame }), trustedSender({ sender: web, senderFrame: { url: 'textbook://app/' } })];
  });
  assert.deepEqual(senders, [true, false, false]);
  await editor().press('ControlOrMeta+End'); await editor().press('End'); await editor().press('Enter'); await page.keyboard.insertText('保存后的正文');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  const saved = await readFile(path.join(root, '手动.md'), 'utf8');
  assert.ok(saved.includes('# 保留注释')); assert.ok(saved.includes('保存后的正文')); assert.ok(saved.includes('update_time:')); assert.ok(!saved.includes('create_time:'));
  // A detected external change must preserve both the editor and disk version.
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText('草稿保留');
  await writeFile(path.join(root, '手动.md'), saved + '\n外部编辑');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '磁盘文件已改变' }).waitFor();
  assert.ok((await editor().innerText()).includes('草稿保留'));
  assert.ok((await readFile(path.join(root, '手动.md'), 'utf8')).endsWith('外部编辑'));
  await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok((await editor().innerText()).includes('草稿保留'));
  await picker(null);
  await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿并继续', exact: true }).click();
  await page.getByRole('button', { name: '切换笔记库', exact: true }).waitFor({ state: 'visible' });
  assert.ok((await editor().innerText()).includes('草稿保留'));
  // Native close cancellation protects the same draft.
  await instance.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBoxSync = () => 0; BrowserWindow.getAllWindows()[0].close(); });
  assert.ok((await editor().innerText()).includes('草稿保留'));
  // Move to a future note, then exercise keyboard commands, undo and paste.
  await page.getByRole('button', { name: '较新', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿并继续', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '只读' }).waitFor();
  const future = await editor().innerText();
  await editor().click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.insertText('不能写入');
  assert.equal(await editor().innerText(), future);
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  // Invalid YAML stays in the editor and can be repaired without losing unknown fields.
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '新笔记名称', exact: true }).fill('修复文件头');
  await page.getByRole('button', { name: '创建草稿', exact: true }).click();
  await editor().click(); await page.keyboard.insertText('---\nunknown: [\n---\n正文草稿');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'YAML 第' }).waitFor();
  assert.ok((await editor().innerText()).includes('正文草稿'));
  await editor().press('ControlOrMeta+a'); await page.keyboard.insertText('---\nunknown: []\n---\n正文草稿');
  await editor().press('ControlOrMeta+s');
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  assert.ok((await readFile(path.join(root, '修复文件头.md'), 'utf8')).includes('unknown: []'));
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '新笔记名称', exact: true }).fill('手动');
  await page.getByRole('button', { name: '创建草稿', exact: true }).click();
  await editor().click(); await page.keyboard.insertText('# 新建笔记\n正文');
  const pausedRoot = `${root}-paused`;
  if (process.platform === 'win32') await rename(root, pausedRoot);
  else await chmod(root, 0o500);
  try {
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '保存失败' }).waitFor();
    assert.ok((await editor().innerText()).includes('# 新建笔记'));
  } finally {
    if (process.platform === 'win32') await rename(pausedRoot, root);
    else await chmod(root, 0o700);
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  const created = await readFile(path.join(root, '手动（2）.md'), 'utf8');
  assert.ok(created.includes('create_time:')); assert.ok(created.includes('update_time:'));
  await page.getByRole('button', { name: '手动', exact: true }).click();
  await editor().press('ControlOrMeta+End');
  await editor().evaluate((element) => { element.closest('.cm-scroller').scrollTop = 800; });
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 930, height: 650, x: 100, y: 100 }));
  await page.screenshot({ path: path.join(evidence, 'mac-desktop.png') });
  await page.waitForTimeout(350);
  await instance.close();
  ({ instance, page } = await launch());
  await page.getByRole('heading', { name: '手动', exact: true }).waitFor();
  assert.ok((await editor().innerText()).includes('外部编辑'));
  const restored = await editor().evaluate((element) => element.closest('.cm-scroller').scrollTop);
  assert.ok(restored > 100, `scroll restored: ${restored}`);
  const bounds = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.equal(bounds.width, 930); assert.equal(bounds.height, 650);
  // Switching vaults keeps independent local state. Out-of-range positions still open.
  await picker(other); await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.getByText('此库还没有笔记。', { exact: true }).waitFor();
  await picker(root); await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.getByRole('heading', { name: '手动', exact: true }).waitFor();
  await page.evaluate(async () => { const api = window.textbookDesktop; const current = await api.restore(); await api.saveState(current.value.token, { activePath: '手动.md', positions: { '手动.md': { cursor: 9999999, scroll: 9999999 } } }); });
  await instance.close();
  // Malformed window bounds must not stop the restored file from opening.
  for (const name of await readdir(path.join(userData, 'vaults'))) {
    const file = path.join(userData, 'vaults', name);
    const savedState = JSON.parse(await readFile(file, 'utf8'));
    savedState.bounds = { x: 1e30, y: 0.25, width: 900.75, height: 600 };
    await writeFile(file, JSON.stringify(savedState));
  }
  ({ instance, page } = await launch());
  await page.getByRole('heading', { name: '手动', exact: true }).waitFor();
  assert.ok((await editor().innerText()).includes('外部编辑'));
  console.log(JSON.stringify({ result: 'PASS', executablePath: executablePath ?? 'development Electron + built frontend', evidence, checks: ['picker cancellation (stub)', 'read without mutation', 'edit/save/reopen', 'new UUID and times', 'same-name creation', 'read-only keyboard commands', 'permission failure and retry', 'external conflict', 'switch and native-close cancellation', 'vault-specific positions and window bounds', 'invalid position fallback', 'sandbox, preload, HTML and traversal'] }, null, 2));
} finally { await instance.close(); }
