// Runs the installed app. Native dialogs are stubbed here; ticket 15 owns OS interaction.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const project = path.resolve(import.meta.dirname, '..');
const executablePath = process.env.DESKTOP_EXECUTABLE;
assert.ok(executablePath, 'Set DESKTOP_EXECUTABLE to the packaged application executable.');
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json')));
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-offline-app-')));
const root = path.join(evidence, '笔记库'); const data = path.join(evidence, 'app-data'); await mkdir(root);
const otherRoot = path.join(evidence, '另一个库'); await mkdir(otherRoot);
const personal = '---\n未知属性: 保留\n---\n# 我的内容\n'; await writeFile(path.join(root, '个人.md'), personal);
const hits = new Map(); let damaged = true; let slow = false; let releaseSlow; let markSlow;
const held = new Promise((resolve) => { releaseSlow = resolve; });
const slowStarted = new Promise((resolve) => { markSlow = resolve; });
const server = createServer((request, response) => { void (async () => {
  const name = request.url.slice(1); const entry = manifest.download.find((item) => item.path === name);
  if (!entry) { response.writeHead(404); response.end(); return; }
  hits.set(name, (hits.get(name) ?? 0) + 1);
  if (damaged && name === manifest.download[4].path) { response.writeHead(503); response.end(); return; }
  if (slow && name === manifest.download[4].path) { markSlow(); await held; }
  response.end(await readFile(path.join(project, name.endsWith('catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${name}`)));
})().catch(() => { response.writeHead(500); response.end(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const source = `http://127.0.0.1:${server.address().port}/`;
let instance; let page; const errors = []; const remote = [];
async function launch(offline) {
  const env = { ...process.env }; delete env.TEXTBOOK_DOWNLOAD_BASE_URL;
  if (!offline) env.TEXTBOOK_DOWNLOAD_BASE_URL = source;
  instance = await _electron.launch({ executablePath, args: [`--user-data-dir=${data}`, ...(!offline ? ['--textbook-local-http'] : [])], env });
  page = await instance.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  if (offline) await instance.evaluate(({ session }) => { session.defaultSession.enableNetworkEmulation({ offline: true }); });
  await page.getByRole('button', { name: '教材书架', exact: true }).waitFor();
}
async function picker(selection = root) { await instance.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, selection); }
async function switchVault(selection) {
  await page.getByRole('button', { name: '笔记库', exact: true }).click(); await picker(selection);
  await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
}
async function addFromShelf() {
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
}
async function jump(number) {
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill(String(number));
  await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction((number) => { const image = document.querySelector(`#page-${number} .page-image`); return image?.complete && image.naturalWidth > 0; }, number);
}
try {
  await launch(false);
  const bundled = await instance.evaluate(async ({ app }) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    try { return await fs.readdir(`${app.getAppPath()}/dist/textbooks`); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  });
  assert.deepEqual(bundled, []);
  await picker(); await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'HTTP_ERROR' }).first().waitFor();
  assert.deepEqual(await page.evaluate(async () => { const { value: context } = await window.textbookResources.context(); return JSON.parse(localStorage.getItem(`desktop-textbooks:${context.vaultKey}:textbook-shelf-v1`) ?? 'null'); }), null);
  assert.equal((await page.evaluate(() => window.textbookResources.status())).value.phase, 'error');
  await assert.rejects(readFile(path.join(data, 'textbook-resources', manifest.textbook.id, 'complete.json')));
  damaged = false; slow = true;
  await page.getByRole('button', { name: '添加到书架', exact: true }).click(); await slowStarted;
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await switchVault(otherRoot); releaseSlow(); slow = false;
  await page.waitForFunction(async () => (await window.textbookResources.status()).value.phase === 'ready', undefined, { timeout: 60_000 });
  const catalogRelative = `.textbook/textbooks/${manifest.textbook.id}/catalog.json`;
  await assert.rejects(readFile(path.join(root, catalogRelative))); await assert.rejects(readFile(path.join(otherRoot, catalogRelative)));
  assert.equal(await page.getByRole('button', { name: '开始阅读', exact: true }).count(), 0);
  await addFromShelf(); assert.ok(await readFile(path.join(otherRoot, catalogRelative)));
  await switchVault(root);
  assert.equal(await page.getByRole('button', { name: '开始阅读', exact: true }).count(), 0);
  await assert.rejects(readFile(path.join(root, catalogRelative)));
  await addFromShelf();
  assert.equal(hits.size, 405); assert.equal(hits.get(manifest.download[0].path), 1);
  assert.ok((await readFile(path.join(root, '.textbook/textbooks', manifest.textbook.id, 'catalog.json'), 'utf8')).includes('printedPage'));
  assert.deepEqual((await readdir(root)).sort(), ['.textbook', '个人.md']);
  await page.getByRole('button', { name: '开始阅读', exact: true }).click(); await jump(88);
  await page.getByRole('button', { name: '返回书架', exact: true }).click(); await switchVault(otherRoot);
  await page.getByRole('button', { name: '开始阅读', exact: true }).click(); await jump(12);
  await page.getByRole('button', { name: '返回书架', exact: true }).click(); await switchVault(root);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await page.getByRole('button', { name: '第 88 页，共 202 页，点击输入页码', exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'downloaded-reader.png') });
  await instance.close(); instance = null;
  for (const cache of ['Cache', 'Code Cache', 'GPUCache']) await rm(path.join(data, cache), { recursive: true, force: true });
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));

  // Fresh process, no source URL, stopped server, and Electron network emulation offline.
  await launch(true);
  await page.locator('.reader-app').waitFor();
  await page.getByRole('button', { name: '第 88 页，共 202 页，点击输入页码', exact: true }).waitFor();
  console.log('Packaged app: HTTP failure/retry and offline restart passed; checking all resources.');
  const verified = await page.evaluate(async (manifest) => {
    for (const entry of manifest.download) {
      const response = await fetch(`/${entry.path}`); if (response.status !== 200) throw new Error(entry.path);
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== entry.bytes || hash !== entry.sha256) throw new Error(`Invalid ${entry.path}`);
      if (entry.path.endsWith('.webp')) { const image = new Image(); image.src = `/${entry.path}`; await image.decode(); }
    }
    const fonts = await Promise.all([document.fonts.load('500 16px "Study Serif"'), ...[400, 500, 600, 700, 800].map((weight) => document.fonts.load(`${weight} 16px Nunito`))]);
    if (fonts.some((faces) => faces.length !== 1 || faces[0].status !== 'loaded')) throw new Error('Font load failed');
    return { resources: manifest.download.length, fonts: fonts.length, papers: document.querySelectorAll('.paper-list > .paper').length };
  }, manifest);
  assert.deepEqual(verified, { resources: 405, fonts: 6, papers: 202 });
  console.log('Packaged app: all 405 resources and six fonts passed; checking reader navigation.');
  await page.getByRole('button', { name: '展开教材目录', exact: true }).click();
  assert.equal(await page.locator('.book-contents details').count(), 6);
  await page.getByRole('button', { name: '页面', exact: true }).click();
  assert.equal(await page.locator('.page-thumbnails img').count(), 202);
  await page.getByRole('button', { name: /跳转到文件第 202 页/ }).focus();
  await page.getByRole('button', { name: /跳转到文件第 202 页/ }).press('Enter'); await jump(202); await jump(1);
  await page.getByRole('button', { name: '搜索内容', exact: true }).click();
  await page.getByPlaceholder('搜索解读标题或内容').fill('相反数');
  await page.locator('.graph-results button').first().click();
  await page.locator('#supplement-panel .math-inline svg, #supplement-panel .math-display svg').first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.location-highlight')].some((highlight) => {
    const image = highlight.closest('.paper')?.querySelector('.page-image');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1';
  }));
  await page.screenshot({ path: path.join(evidence, 'offline-formula.png') });
  const location = await page.locator('.location-highlight').count(); assert.ok(location > 0);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  const readingKey = await page.evaluate(async (id) => { const { value: context } = await window.textbookResources.context(); return `desktop-textbooks:${context.vaultKey}:textbook-reading-v1:${id}`; }, manifest.textbook.id);
  const reading = await page.evaluate((key) => localStorage.getItem(key), readingKey);
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '移出书架', exact: true }).click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), readingKey), reading);
  assert.equal(await readFile(path.join(root, '个人.md'), 'utf8'), personal);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await page.getByRole('button', { name: '节点图', exact: true }).click(); await page.locator('.graph-viewport canvas').waitFor();
  assert.equal(await page.locator('.graph-error[role=alert]').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'offline-graph.png') });
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ executablePath, source: 'loopback HTTP only; no published source', verified, requests: Object.fromEntries(hits), offlineRestart: true, dualVault: true, slowSwitch: true, errors, remote }, null, 2));
  console.log(JSON.stringify({ evidence, verified, offlineRestart: true, failureRetry: true, shelfReadd: true, remoteRequests: remote.length }));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => '')); }
  console.error('Evidence:', evidence); throw error;
} finally {
  if (instance) await instance.close();
  if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await rm(path.join(evidence, 'unused'), { force: true });
}
