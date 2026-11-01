import { showNoteList } from './check-window.mjs';
// Run against a compiled app, or pass an installed executable with DESKTOP_EXECUTABLE.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, chmod, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { parse } from 'yaml';
import { setTimeout as delay } from 'node:timers/promises';

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
const metadata = (source) => parse(source.split(/\r?\n---(?:\r?\n|$)/)[0].replace(/^---\r?\n/, ''))._textbook;
async function waitForDisk(file, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const source = await readFile(file, 'utf8').catch(() => '');
    if (expected(source)) return source;
    await delay(60);
  }
  assert.fail(`disk state did not settle: ${file}`);
}
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
  await page.getByRole('combobox', { name: '正文模式', exact: true }).selectOption('edit');
  await page.getByRole('combobox', { name: '文件头模式', exact: true }).selectOption('source');
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
  assert.deepEqual(boundaries.keys.sort(), ['chooseVault', 'copy', 'list', 'onChange', 'protectDraft', 'read', 'recoveries', 'restore', 'save', 'saveState', 'readSettings', 'saveSettings', 'setDirty', 'links', 'moveStatus', 'planMove', 'planRepair', 'applyMove', 'customCatalog', 'saveCustomCatalog', 'customDeletions', 'planCustomDeletion', 'applyCustomDeletion'].sort());
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
  // Explicitly managing a pristine manual file adds identity, not invented time.
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  const managedManual = await readFile(path.join(root, '手动.md'), 'utf8');
  assert.ok(metadata(managedManual).id);
  assert.equal(metadata(managedManual).create_time, undefined);
  assert.equal(metadata(managedManual).update_time, undefined);
  await editor().press('ControlOrMeta+End'); await editor().press('End'); await editor().press('Enter'); await page.keyboard.insertText('保存后的正文');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  const saved = await readFile(path.join(root, '手动.md'), 'utf8');
  assert.ok(saved.includes('# 保留注释')); assert.ok(saved.includes('保存后的正文')); assert.ok(saved.includes('update_time:')); assert.ok(!saved.includes('create_time:'));
  // A detected external change must preserve both the editor and disk version.
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText('草稿保留');
  await writeFile(path.join(root, '手动.md'), saved + '\n外部编辑');
  await page.getByRole('alert').filter({ hasText: '磁盘文件已改变' }).waitFor();
  assert.ok((await editor().innerText()).includes('草稿保留'));
  assert.ok((await readFile(path.join(root, '手动.md'), 'utf8')).endsWith('外部编辑'));
  await page.getByRole('button', { name: '查看差异', exact: true }).click();
  await page.getByRole('heading', { name: '磁盘版本', exact: true }).waitFor();
  await page.getByRole('button', { name: '采用磁盘版本', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok((await editor().innerText()).includes('草稿保留'));
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
  const future = await readFile(path.join(root, '较新.md'), 'utf8');
  await page.getByLabel('笔记只读预览', { exact: true }).click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.insertText('不能写入');
  assert.equal(await readFile(path.join(root, '较新.md'), 'utf8'), future);
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 0);
  assert.equal(await page.locator('.cm-content[contenteditable="true"]:visible').count(), 0);
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
  // Leave an A-state debounce behind a delayed native picker for B. Its old
  // token is rejected by main, but its error must not appear in B's interface.
  await instance.evaluate(({ dialog }, selection) => {
    dialog.showOpenDialog = async () => { await new Promise((resolve) => setTimeout(resolve, 450)); return { canceled: false, filePaths: [selection] }; };
  }, other);
  await editor().press('Home'); await editor().press('ArrowRight');
  await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.getByText('此库还没有笔记。', { exact: true }).waitFor();
  await page.evaluate(async () => { const api = window.textbookDesktop, current = await api.restore(); await api.list(current.value.token); });
  assert.equal(await page.getByRole('alert').filter({ hasText: '笔记库已切换' }).count(), 0);
  // A real current-vault state failure remains visible.
  await writeFile(path.join(other, 'state-failure.md'), 'keep current errors');
  await instance.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const { LocalState } = require('./build-desktop/state.js');
    LocalState.prototype.checkOriginalSave = LocalState.prototype.save;
    LocalState.prototype.save = async function () { throw new Error('current vault state failure'); };
  });
  await page.getByRole('button', { name: 'state-failure', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'current vault state failure' }).waitFor();
  await instance.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const { LocalState } = require('./build-desktop/state.js');
    LocalState.prototype.save = LocalState.prototype.checkOriginalSave;
    delete LocalState.prototype.checkOriginalSave;
  });
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
  // Watch external changes without a refresh button, including atomic editor replacements.
  const watched = path.join(root, '外部新增.md');
  await writeFile(watched, 'external initial');
  await page.getByRole('button', { name: '外部新增', exact: true }).click();
  await writeFile(`${watched}.swap`, 'external replacement');
  await rename(`${watched}.swap`, watched);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('external replacement'));
  assert.equal(await readFile(watched, 'utf8'), 'external replacement');
  await rm(watched);
  await page.getByRole('heading', { name: '选一篇笔记，继续写', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '外部新增', exact: true }).count(), 0);

  // A real main-process delay lets edits arrive during save. No renderer/API fake.
  await instance.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const { Vault } = require('./build-desktop/vault.js');
    const originalSave = Vault.prototype.save;
    Vault.prototype.save = async function (...args) {
      if (['快速.md', '连续修复.md'].includes(args[0])) await new Promise((resolve) => setTimeout(resolve, 550));
      return originalSave.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '新笔记名称', exact: true }).fill('快速');
  await page.getByRole('button', { name: '创建草稿', exact: true }).click();
  const rapidSource = '---\n# 保留\nunknown: [one]\n_textbook:\n  ai_source: {source_id: origin, version: "1"}\n---\nrapid one';
  await editor().click(); await page.keyboard.insertText(rapidSource);
  await editor().press('ControlOrMeta+s');
  await page.getByRole('status').filter({ hasText: '保存中' }).waitFor();
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(' two');
  const rapid = await waitForDisk(path.join(root, '快速.md'), (source) => source.endsWith('rapid one two'));
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  assert.ok(metadata(rapid).id); assert.ok(metadata(rapid).create_time);
  assert.deepEqual(metadata(rapid).ai_source, { source_id: 'origin', version: '1' });
  const idleTime = (await stat(path.join(root, '快速.md'))).mtimeMs;
  await delay(1500);
  assert.equal((await stat(path.join(root, '快速.md'))).mtimeMs, idleTime, 'own write must not start another save');

  // Start with no generated header, invalidate it during the first save,
  // repair it, then type again during the second save. Both rebases retain ID/time.
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '新笔记名称', exact: true }).fill('连续修复');
  await page.getByRole('button', { name: '创建草稿', exact: true }).click();
  await editor().click(); await page.keyboard.insertText('first valid');
  await editor().press('ControlOrMeta+s');
  await page.getByRole('status').filter({ hasText: '保存中' }).waitFor();
  await editor().press('ControlOrMeta+a'); await page.keyboard.insertText('---\nunknown: [\n---\ninvalid in flight');
  const firstRepairSave = await waitForDisk(path.join(root, '连续修复.md'), (source) => source.endsWith('first valid'));
  await page.waitForFunction(() => !document.querySelector('.vault-note-heading button')?.disabled);
  await editor().press('ControlOrMeta+a'); await page.keyboard.insertText('repaired');
  await editor().press('ControlOrMeta+s');
  await page.getByRole('status').filter({ hasText: '保存中' }).waitFor();
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(' newer');
  const finalRepairSave = await waitForDisk(path.join(root, '连续修复.md'), (source) => source.endsWith('repaired newer'));
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  assert.equal(metadata(finalRepairSave).id, metadata(firstRepairSave).id);
  assert.equal(metadata(finalRepairSave).create_time, metadata(firstRepairSave).create_time);
  await page.getByRole('button', { name: '快速', exact: true }).click();
  await page.getByRole('heading', { name: '快速', exact: true }).waitFor();
  await page.locator('.cm-content[contenteditable="true"]').waitFor();

  // Pause invalid YAML, then protect it before adopting a disk version.
  await editor().press('ControlOrMeta+a'); await page.keyboard.insertText('---\nunknown: [\n---\ninvalid draft');
  await delay(800);
  assert.equal(await readFile(path.join(root, '快速.md'), 'utf8'), rapid);
  const external = rapid + '\nexternal wins';
  await writeFile(path.join(root, '快速.md'), external);
  await page.getByRole('button', { name: '查看差异', exact: true }).waitFor();
  await page.getByRole('button', { name: '采用磁盘版本', exact: true }).click();
  await page.getByRole('button', { name: '保留恢复记录并采用磁盘', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('external wins'));
  const protectedDrafts = await page.evaluate(async () => {
    const api = window.textbookDesktop, current = await api.restore();
    return (await api.recoveries(current.value.token)).value;
  });
  assert.ok(protectedDrafts.some((record) => record.candidate === '---\nunknown: [\n---\ninvalid draft'));

  // Both duplicate files are named explicitly; choosing one creates a new identity.
  await writeFile(path.join(root, '副本.md'), external);
  await page.getByRole('navigation').getByRole('button', { name: /^副本/ }).click();
  await page.getByRole('button', { name: '将此副本设为新笔记', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  const fixed = await readFile(path.join(root, '副本.md'), 'utf8');
  assert.notEqual(metadata(fixed).id, metadata(external).id);
  assert.deepEqual(metadata(fixed).ai_source, metadata(external).ai_source);
  if (await page.getByRole('button', { name: '复制笔记', exact: true }).isHidden()) await page.locator('.note-move-actions > summary').click();
  await page.getByRole('button', { name: '复制笔记', exact: true }).click();
  await page.getByRole('heading', { name: '副本（2）', exact: true }).waitFor();
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  const copied = await readFile(path.join(root, '副本（2）.md'), 'utf8');
  assert.notEqual(metadata(copied).id, metadata(fixed).id);
  assert.deepEqual(metadata(copied).ai_source, metadata(fixed).ai_source);

  // Read-only failure keeps the draft. Save-as leaves the original intact.
  if (process.platform !== 'win32') {
    await chmod(path.join(root, '副本（2）.md'), 0o444);
    await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(' read-only draft');
    await editor().press('ControlOrMeta+s');
    await page.getByRole('status').filter({ hasText: '保存失败' }).waitFor();
    assert.equal(await readFile(path.join(root, '副本（2）.md'), 'utf8'), copied);
    await page.getByRole('button', { name: '另存草稿为新笔记', exact: true }).click();
    await page.getByRole('heading', { name: '副本（2）（2）', exact: true }).waitFor();
    await page.locator('.cm-content[contenteditable="true"]').waitFor();
    assert.ok((await readFile(path.join(root, '副本（2）（2）.md'), 'utf8')).endsWith(' read-only draft'));
    await chmod(path.join(root, '副本（2）.md'), 0o600);
  }
  // A deleted file with a draft remains editable, and adopt cancellation keeps it.
  const activeName = await page.getByRole('heading', { level: 1 }).innerText();
  const activeFile = path.join(root, `${activeName}.md`);
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(' deleted draft');
  await rm(activeFile);
  await page.getByRole('button', { name: '查看差异', exact: true }).click();
  await page.locator('.vault-diff').getByText('文件已删除或暂不可用。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '采用磁盘版本', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok((await editor().innerText()).includes('deleted draft'));
  await page.screenshot({ path: path.join(evidence, 'conflict-wide.png') });
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 760, height: 650 }));
  await page.screenshot({ path: path.join(evidence, 'conflict-narrow.png') });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(horizontalOverflow, false);
  await page.getByRole('button', { name: '另存草稿为新笔记', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  assert.ok((await readFile(activeFile, 'utf8')).endsWith(' deleted draft'));
  // Open a protected recovery as a new identity and save it through the same editor.
  await showNoteList(page);
  await page.getByRole('button', { name: '恢复记录', exact: true }).click();
  const recoveryRows = page.getByRole('region', { name: '恢复记录' }).getByRole('article');
  const recoveryRow = recoveryRows.filter({ has: page.getByText('快速.md', { exact: true }) }).first();
  await recoveryRow.getByRole('button', { name: '打开草稿', exact: true }).click();
  await page.getByRole('heading', { name: '快速（恢复）', exact: true }).waitFor();
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false, 'opening a recovery must close the narrow list');
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  await editor().press('ControlOrMeta+a'); await page.keyboard.insertText('---\nunknown: []\n---\nrepaired recovery');
  await editor().press('ControlOrMeta+s');
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  const recovered = await readFile(path.join(root, '快速（恢复）.md'), 'utf8');
  assert.ok(recovered.endsWith('repaired recovery'));
  assert.notEqual(metadata(recovered).id, metadata(rapid).id);
  console.log(JSON.stringify({ result: 'PASS', executablePath: executablePath ?? 'development Electron + built frontend', evidence, checks: ['picker cancellation (stub)', 'read without mutation', 'edit/save/reopen', 'new UUID and times', 'same-name creation', 'read-only keyboard commands', 'permission failure and retry', 'external conflict, diff and cancel', 'watch external add/replace/delete', 'auto-save and in-flight edits; invalid YAML repair across two saves', 'invalid YAML protection and disk adoption', 'duplicate repair and copy', 'read-only save-as', 'deleted draft recovery', 'recovery editor', 'self-write idle', 'narrow conflict layout', 'switch and native-close cancellation', 'vault-specific positions and window bounds', 'stale state error isolated by vault token; current errors retained', 'invalid position fallback', 'sandbox, preload, HTML and traversal'] }, null, 2));
} catch (cause) {
  await page.screenshot({ path: path.join(evidence, 'failed.png') }).catch(() => undefined);
  console.error(JSON.stringify({ evidence, state: await page.locator('body').innerText().catch(() => '') }));
  throw cause;
} finally {
  // Each relaunch has a fresh dialog implementation. Never leave the automated
  // runner blocked in a real native close prompt, including after a failed check.
  await instance.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => undefined);
  await instance.close();
}
