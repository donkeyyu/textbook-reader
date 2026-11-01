// Real Electron UI path. Only the native folder picker is controlled; OS validation belongs to 15.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { pathLink } from './links.ts';

const project = path.resolve(import.meta.dirname, '..');
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-initial-notes-')));
console.log(`Evidence: ${evidence}`);
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'), 'utf8'));
const root = path.join(evidence, '笔记库'); const data = path.join(evidence, 'app-data'); await mkdir(root);
const importRoot = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes`); await mkdir(importRoot, { recursive: true });
// A real filesystem failure after the first note installation, before its receipt.
await writeFile(path.join(importRoot, 'receipts'), '阻止收据目录，稍后重试');
const sameName = path.join(root, pack.entries[0].path); await mkdir(path.dirname(sameName), { recursive: true }); await writeFile(sameName, '学生已有同名内容');
let offline = false; let app; let page; const errors = []; const remote = []; const timings = {};
const server = createServer((request, response) => { void (async () => {
  const name = request.url.slice(1); const entry = manifest.download.find((entry) => entry.path === name);
  if (!entry) { response.writeHead(404); response.end(); return; }
  response.end(await readFile(path.join(project, name.endsWith('catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${name}`)));
})().catch(() => { response.writeHead(500); response.end(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const source = `http://127.0.0.1:${server.address().port}/`;
async function launch() {
  const env = { ...process.env }; delete env.TEXTBOOK_DOWNLOAD_BASE_URL;
  if (!offline) env.TEXTBOOK_DOWNLOAD_BASE_URL = source;
  const executablePath = process.env.DESKTOP_EXECUTABLE || path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  app = await _electron.launch({ executablePath, args: [...(!process.env.DESKTOP_EXECUTABLE ? [project] : []), `--user-data-dir=${data}`, ...(!offline ? ['--textbook-local-http'] : [])], env });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  if (offline) await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  await page.getByRole('button', { name: '教材书架', exact: true }).waitFor();
}
async function jump(number) {
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill(String(number));
  await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction((number) => { const image = document.querySelector(`#page-${number} .page-image`); return image?.complete && image.naturalWidth > 0; }, number);
}
async function openFromMarker(sourceId) {
  const entry = pack.entries.find((entry) => entry.sourceId === sourceId);
  const mark = page.getByRole('button', { name: new RegExp(`打开文件第 ${entry.anchors[0].pdf_page} 页的`) });
  await mark.scrollIntoViewIfNeeded(); const start = performance.now(); await mark.click();
  const choices = page.getByRole('dialog', { name: '选择教材笔记', exact: true });
  if (await choices.count() && await choices.isVisible()) await choices.getByRole('button').filter({ has: page.locator('strong').filter({ hasText: entry.title }) }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor({ timeout: 30_000 });
  timings.markerOpenMs = Math.round(performance.now() - start);
  return entry;
}
async function append(text) {
  const editor = page.locator('.cm-content[contenteditable=true]'); await editor.click(); await page.keyboard.press('Meta+End'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.insertText(text);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor({ timeout: 30_000 });
}
try {
  await launch();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  // Merely reading the shelf did not generate notes or a plan.
  await assert.rejects(readFile(path.join(importRoot, 'plan.json')));
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  const start = performance.now(); await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '不访问教材目录' }).first().waitFor({ timeout: 90_000 });
  console.log('First explicit add stopped on the blocked receipt directory.');
  const plan = JSON.parse(await readFile(path.join(importRoot, 'plan.json'), 'utf8'));
  await rm(path.join(importRoot, 'receipts')); await mkdir(path.join(importRoot, 'receipts'));
  const blockedReceipt = path.join(importRoot, `receipts/${plan.notes[1].id}.json`); await writeFile(blockedReceipt, 'broken receipt');
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '初始笔记导入记录无法读取' }).first().waitFor({ timeout: 30_000 });
  const interruptedPath = path.join(root, plan.notes[0].path); const interrupted = await readFile(interruptedPath, 'utf8');
  await writeFile(interruptedPath, interrupted + '\n中断后学生的修改\n');
  await page.screenshot({ path: path.join(evidence, 'import-failed.png') });
  assert.equal(await readFile(sameName, 'utf8'), '学生已有同名内容');
  await rm(blockedReceipt);
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 120_000 });
  console.log('All 971 initial notes imported after a partial failure; existing content preserved.');
  timings.downloadAndImportWithFailureMs = Math.round(performance.now() - start);
  assert.equal((await readdir(path.join(importRoot, 'receipts'))).length, 971);
  assert.ok((await readFile(interruptedPath, 'utf8')).endsWith('中断后学生的修改\n'));
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await page.getByRole('button', { name: '开始阅读', exact: true }).click(); await jump(88);
  const entry = await openFromMarker('ch3-q-p88-example4');
  assert.equal(await page.locator('#supplement-panel .personal-note').count(), 0);
  assert.equal(await page.getByLabel('正文模式').inputValue(), 'live');
  // Default live rendering and local diagram are visible before editing.
  await page.locator('.note-initial-diagram').waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.note-initial-diagram'); return image?.complete && image.naturalWidth > 0; });
  await page.getByLabel('正文模式').selectOption('edit'); await append('编辑模式写入：保留原有面积推导。');
  const targetPlan = plan.notes.find((item) => item.sourceId === entry.sourceId); const targetPath = path.join(root, targetPlan.path);
  let saved = await readFile(targetPath, 'utf8'); assert.ok(saved.includes('编辑模式写入：保留原有面积推导。'));
  const id = targetPlan.id;
  const linked = plan.notes.find((item) => item.sourceId === 'ch3-triangle-base-height');
  await append(pathLink(linked.path, '集成验证：底与高'));
  await page.getByLabel('正文模式').selectOption('preview');
  await page.locator('.note-preview .math-inline svg').first().waitFor();
  await page.locator('.note-preview .note-initial-diagram').waitFor();
  assert.equal(await page.locator('.cm-content[contenteditable=true]').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'unified-preview.png') });
  // A textbook marker and a path link share the same editable note navigation.
  await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: '集成验证：底与高', exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: pack.entries.find((item) => item.sourceId === linked.sourceId).title }).waitFor();
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor();
  assert.equal(await page.getByLabel('正文模式').inputValue(), 'preview');
  assert.ok((await readFile(targetPath, 'utf8')).includes(pathLink(linked.path, '集成验证：底与高')));
  console.log('Textbook note → saved path link → return preserves the same source and preview mode.');
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.getByRole('button', { name: '第 88 页，共 202 页，点击输入页码', exact: true }).waitFor();
  await openFromMarker(entry.sourceId);
  console.log('Marker reopened the same edited note after preview and textbook return.');
  await page.getByLabel('正文模式').selectOption('live');
  // Click a rendered paragraph; live mode switches that block into its actual editor.
  await page.locator('.note-rendered-block').filter({ hasText: '圆孔所在区域已经没有材料' }).click();
  await page.keyboard.press('End'); await page.keyboard.insertText(' 实时预览续写。');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor({ timeout: 30_000 });
  saved = await readFile(targetPath, 'utf8'); assert.ok(saved.includes('实时预览续写。')); assert.ok(saved.includes(id));
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: /更多操作/ }).click(); await page.getByRole('menuitem', { name: '移出书架', exact: true }).click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click(); const retry = performance.now();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click(); await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 60_000 });
  timings.readdMs = Math.round(performance.now() - retry);
  assert.equal(await readFile(targetPath, 'utf8'), saved); assert.equal(await readFile(sameName, 'utf8'), '学生已有同名内容');
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await app.close(); app = null;
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); offline = true;
  await launch(); await page.getByRole('button', { name: '笔记库', exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor();
  await page.getByLabel('正文模式').selectOption('edit'); await append('断网关闭重开后继续编辑。');
  assert.ok((await readFile(targetPath, 'utf8')).includes('断网关闭重开后继续编辑。'));
  await page.setViewportSize({ width: 760, height: 780 }); await page.getByLabel('正文模式').selectOption('preview');
  await page.locator('.note-preview .math-inline svg').first().waitFor();
  await page.screenshot({ path: path.join(evidence, 'offline-unified-narrow.png') });
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('button', { name: '继续阅读', exact: true }).click(); await jump(88);
  await page.screenshot({ path: path.join(evidence, 'offline-textbook.png') });
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ count: 971, version: pack.version, archive: 'unpublished', timings, failureRetry: true, sameNamePreserved: true, markerSameNote: true, pathLinkRoundtrip: true, editLivePreview: true, offlineRestart: true, errors, remote }, null, 2));
  console.log(JSON.stringify({ evidence, timings, result: 'passed' }));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  console.error('Evidence:', evidence); throw error;
} finally {
  if (app) await app.close(); if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
