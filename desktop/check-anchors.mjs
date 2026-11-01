// Isolated real Electron + real local HTTP. Native picker and cleanup close prompts
// are controlled; held/raced IPC requests still execute the real file handlers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { parse } from './format.ts';
import { validRect } from './anchors.ts';
const project = path.resolve(import.meta.dirname, '..');
const evidence = process.env.ANCHORS_REUSE || await mkdtemp(path.join(os.tmpdir(), 'textbook-anchors-'));
const root = path.join(evidence, '笔记库'), data = path.join(evidence, 'app-data'); await mkdir(root, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'), 'utf8'));
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const anchor = { textbook: pack.textbook, pdf_page: 20, rects: [[.12, .25, .55, .08], [.12, .4, .55, .07]] };
const note = (anchors, body = '真实框选往返。\n\n[[相反数|选择同名笔记]]\n') => `---\n保留属性: 原值\n_textbook:\n  schema_version: 1\n  anchors: ${JSON.stringify(anchors)}\n---\n${body}`;
await writeFile(path.join(root, '往返.md'), note([anchor]));
if (!process.env.ANCHORS_REUSE) for (const [dir, page] of [['甲', 20], ['乙', 21]]) { await mkdir(path.join(root, dir)); await writeFile(path.join(root, dir, '相反数.md'), note([{ ...anchor, pdf_page: page }], `${dir}教材原文区域。`)); }
if (process.env.ANCHORS_REUSE) for (const name of ['多框跨页.md', '排队创建.md', '保护拒绝.md']) await rm(path.join(root, name), { force: true });
let app, page, offline = false; const errors = [], remote = [], checks = [], timings = {};
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
const server = createServer((request, response) => { void (async () => {
  const name = request.url.slice(1), entry = manifest.download.find((item) => item.path === name);
  if (!entry) { response.writeHead(404); response.end(); return; }
  response.end(await readFile(path.join(project, name.endsWith('catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${name}`)));
})().catch(() => { response.writeHead(500); response.end(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function launch() {
  const env = { ...process.env, ANCHORS_TEST_ROOT: root }; delete env.TEXTBOOK_DOWNLOAD_BASE_URL;
  if (!offline) env.TEXTBOOK_DOWNLOAD_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  app = await _electron.launch({ executablePath: path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [project, `--user-data-dir=${data}`, ...(!offline ? ['--textbook-local-http'] : [])], env, timeout: 30_000 });
  page = await app.firstWindow({ timeout: 30_000 }); page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  if (offline) await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  await page.setViewportSize({ width: 1440, height: 980 });
}
const disk = (name) => readFile(path.join(root, name), 'utf8');
const anchors = async (name) => parse(await disk(name)).data._textbook.anchors;
async function eventually(read, predicate, message) { for (let i = 0; i < 1200; i++) { const value = await read().catch(() => undefined); if (value !== undefined && predicate(value)) return value; await delay(50); } assert.fail(message); }
const notes = async () => page.getByRole('button', { name: '笔记库', exact: true }).click();
async function open(name) {
  await notes(); await page.locator('.vault-sidebar nav').getByRole('button', { name, exact: true }).click({ timeout: 60_000 });
  await page.getByRole('heading', { name, exact: true }).or(page.getByRole('heading', { name: '还有未保存的草稿', exact: true })).first().waitFor({ timeout: 60_000 });
  if (await page.getByRole('button', { name: '保存并继续', exact: true }).isVisible()) await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}
async function modes(body = 'edit', header = 'properties') { await page.getByLabel('正文模式', { exact: true }).selectOption(body); if (body !== 'preview') await page.getByLabel('文件头模式', { exact: true }).selectOption(header); }
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
async function source(text) { await modes('edit', 'source'); await editor().click(); await editor().press('ControlOrMeta+a'); await page.keyboard.insertText(text); }
async function saved(name, predicate) { await eventually(() => disk(name), predicate, 'file did not save: ' + name); await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor(); }
async function position(index = 1) { const details = page.locator('.note-anchor').nth(index - 1); if (!await details.evaluate((element) => element.open)) await details.locator('summary').click(); return details; }
async function jump(number) {
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill(String(number)); await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction((number) => { const img = document.querySelector(`#page-${number} .page-image`); return img?.complete && img.naturalWidth > 0; }, number);
}
async function draw(number, rect) {
  await jump(number); await page.getByRole('button', { name: '框选当前页', exact: true }).click();
  const selector = page.locator(`#page-${number} .region-selector`); await selector.waitFor();
  const bounds = await selector.boundingBox(); assert.ok(bounds);
  await page.mouse.move(bounds.x + rect[0] * bounds.width, bounds.y + rect[1] * bounds.height); await page.mouse.down(); await page.mouse.move(bounds.x + (rect[0] + rect[2]) * bounds.width, bounds.y + (rect[1] + rect[3]) * bounds.height, { steps: 8 }); await page.mouse.up();
  await selector.waitFor({ state: 'detached' });
}
try {
  console.log('Evidence:', evidence); await launch();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  if (!process.env.ANCHORS_REUSE) await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  if (!process.env.ANCHORS_REUSE) {
  await open('往返'); await modes();
  await page.getByRole('button', { name: '添加位置', exact: true }).click(); await position(2);
  assert.equal(await page.getByLabel('位置 2 文件页', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('位置 2 章', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '移除位置 2', exact: true }).click(); await saved('往返.md', (text) => parse(text).data._textbook.anchors.length === 1);
  record('before download/catalog: empty anchor can be added, saved and removed without enabling dependent fields or crashing');
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  const start = performance.now(); await page.getByRole('button', { name: '添加到书架', exact: true }).click(); await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 120_000 }); timings.importMs = Math.round(performance.now() - start);
  assert.equal((await readdir(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/receipts`))).length, 971);
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click(); await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  }
  await open('往返'); await modes(); const original = await disk('往返.md');
  await position(); await page.getByRole('button', { name: '定位位置 1', exact: true }).click(); await jump(20);
  await page.getByLabel('已定位区域 1', { exact: true }).waitFor(); assert.equal(await page.getByLabel('显示补充类型', { exact: true }).count(), 0); await page.screenshot({ path: path.join(evidence, 'split-location.png') });
  record(`${process.env.ANCHORS_REUSE ? 'reopened prior real-HTTP fixture with' : 'real HTTP download +'} all 971 initial notes; top location opens actual page and both original region boundaries`);
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await draw(20, [.15, .25, .45, .06]); await draw(20, [.15, .38, .4, .06]); await draw(21, [.15, .25, .45, .07]);
  const oldHeading = await page.locator('.vault-note-heading h1').innerText(), oldBacks = await page.getByRole('button', { name: '返回来源', exact: true }).count();
  for (const bad of ['', '../越界']) {
    await page.getByRole('textbox', { name: '框选新笔记名称', exact: true }).fill(bad); await page.getByRole('button', { name: '从框选新建笔记', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /笔记状态或位置已改变/ }).waitFor(); assert.equal(await page.locator('.vault-note-heading h1').innerText(), oldHeading); assert.equal(await page.getByRole('button', { name: '返回来源', exact: true }).count(), oldBacks); assert.equal(await disk('往返.md'), original);
  }
  record('empty/unsafe creation names keep source and navigation history unchanged');
  await page.getByRole('textbox', { name: '框选新笔记名称', exact: true }).fill('多框跨页'); await page.screenshot({ path: path.join(evidence, 'multi-page-selection.png') });
  await page.getByRole('button', { name: '从框选新建笔记', exact: true }).click(); await saved('多框跨页.md', (text) => text.includes('anchors:'));
  assert.deepEqual((await anchors('多框跨页.md')).map((item) => [item.pdf_page, item.rects.length]), [[20, 2], [21, 1]]); assert.equal(await disk('往返.md'), original);
  record('pointer drawing creates two same-page rectangles and another page; one unified Markdown note saved without changing source note');
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await draw(20, [.2, .25, .3, .04]); await page.getByRole('textbox', { name: '框选新笔记名称', exact: true }).fill('排队创建'); await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await modes();
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('vault:save'); let hold = true;
    ipcMain._invokeHandlers.set('vault:save', async (...args) => {
      if (hold && args[2] === '多框跨页.md') { hold = false; await new Promise((resolve) => { globalThis.anchorReleaseSave = resolve; }); }
      return handler(...args);
    });
  });
  await editor().click(); await editor().press('ControlOrMeta+End'); await page.keyboard.insertText('保存前输入'); await editor().press('ControlOrMeta+s'); await page.getByRole('status').filter({ hasText: /保存中/ }).waitFor(); await eventually(() => app.evaluate(() => typeof globalThis.anchorReleaseSave), (kind) => kind === 'function', 'actual save IPC did not reach hold');
  await page.getByRole('button', { name: '从框选新建笔记', exact: true }).click(); await editor().click(); await editor().press('ControlOrMeta+End'); await page.keyboard.insertText('保存期间后续输入'); await app.evaluate(() => globalThis.anchorReleaseSave());
  await saved('排队创建.md', (text) => text.includes('anchors:')); await page.getByRole('button', { name: '返回来源', exact: true }).click(); await page.getByRole('heading', { name: '多框跨页', exact: true }).waitFor();
  assert.ok((await editor().innerText()).includes('保存期间后续输入')); await editor().press('ControlOrMeta+s'); await saved('多框跨页.md', (text) => text.includes('保存前输入保存期间后续输入'));
  record('create requested during actual delayed main-process save waits and parks the latest continued input; return restores it');

  await position(); await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click(); await jump(20);
  const region = page.locator('#page-20 .desktop-region').first(); await region.click(); await region.press('ArrowRight');
  const beforeCancel = await disk('多框跨页.md'); await page.getByRole('button', { name: '取消框选', exact: true }).click(); assert.equal(await disk('多框跨页.md'), beforeCancel);
  await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click(); await jump(20);
  const beforeMove = (await anchors('多框跨页.md'))[0].rects[0];
  const box = await region.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 5 }); await page.mouse.up();
  const handle = region.locator('.desktop-region-handle'), hb = await handle.boundingBox(); await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2 + 12, hb.y + hb.height / 2 + 8, { steps: 5 }); await page.mouse.up();
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('vault:save'); let hold = true; globalThis.anchorReleaseSave = undefined;
    ipcMain._invokeHandlers.set('vault:save', async (...args) => { if (hold && args[2] === '多框跨页.md') { hold = false; await new Promise((resolve) => { globalThis.anchorReleaseSave = resolve; }); } return handler(...args); });
  });
  await editor().click(); await editor().press('ControlOrMeta+End'); await page.keyboard.insertText('调整期间正文'); await editor().press('ControlOrMeta+s');
  await eventually(() => app.evaluate(() => typeof globalThis.anchorReleaseSave), (kind) => kind === 'function', 'adjustment save did not reach IPC hold');
  await page.getByRole('button', { name: '保存区域调整', exact: true }).click(); await app.evaluate(() => globalThis.anchorReleaseSave());
  await saved('多框跨页.md', (text) => text.includes('调整期间正文') && parse(text).data._textbook.anchors[0].rects[0][0] > beforeMove[0]);

  const afterMove = (await anchors('多框跨页.md'))[0].rects[0]; assert.ok(afterMove[0] > beforeMove[0]); assert.ok(afterMove[2] > beforeMove[2]);
  await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click(); await jump(20); await region.click(); await page.getByRole('button', { name: '移除所选区域', exact: true }).click(); await page.getByRole('button', { name: '保存区域调整', exact: true }).click(); await eventually(() => anchors('多框跨页.md'), (items) => items[0].rects.length === 1, 'region remove failed');
  record('adjustment waits for actual in-flight save and keeps body; existing regions: pointer move and resize save; keyboard move + cancel leaves file unchanged; removing selected rectangle preserves other page');
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await draw(22, [.15, .24, .42, .06]); await page.getByRole('button', { name: '添加到当前笔记', exact: true }).click(); await eventually(() => anchors('多框跨页.md'), (items) => items.length === 3 && items[2].pdf_page === 22, 'append current failed');
  record('textbook selection appends a new page to the currently open note');
  // Source changes during region adjustment must not be overwritten by an old selection.
  await position(); await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click(); const prior = await disk('多框跨页.md');
  const changed = prior.replace('pdf_page: 20', 'pdf_page: 23'); await source(changed); await saved('多框跨页.md', (text) => text.includes('pdf_page: 23'));
  await page.getByRole('button', { name: '保存区域调整', exact: true }).click(); await page.getByRole('alert').filter({ hasText: /笔记状态或位置已改变/ }).waitFor(); assert.equal((await anchors('多框跨页.md'))[0].pdf_page, 23); await page.getByRole('button', { name: '取消框选', exact: true }).click();
  record('direct YAML edit during region selection rejects stale region write and keeps new page');
  await source(note([{ ...anchor, chapter: 'chapter-3', section: '3.1', rects: [[.9, .9, .4, .4]] }])); await saved('多框跨页.md', (text) => text.includes('0.9')); await modes(); await position();
  assert.equal(await page.getByRole('button', { name: '定位位置 1', exact: true }).count(), 0); await page.getByText(/章节与页面范围冲突/).waitFor(); assert.deepEqual((await anchors('多框跨页.md'))[0].rects, [[.9, .9, .4, .4]]);
  await page.getByRole('button', { name: '移除位置 1', exact: true }).click(); await eventually(() => disk('多框跨页.md'), (text) => parse(text).data._textbook.anchors === undefined, 'all location remove failed'); assert.ok((await disk('多框跨页.md')).includes('真实框选往返'));
  record('invalid/conflicting source coordinates remain in file and cannot jump; deleting every anchor retains note and body');
  await page.getByRole('button', { name: '添加位置', exact: true }).click(); await position();
  await page.getByLabel('位置 1 教材', { exact: true }).selectOption(pack.textbook); await page.getByLabel('位置 1 章', { exact: true }).selectOption('chapter-1'); await page.getByLabel('位置 1 节', { exact: true }).selectOption('1.2');
  await eventually(() => anchors('多框跨页.md'), (items) => items[0].section === '1.2' && items[0].pdf_page === undefined, 'classification did not save'); assert.equal(await page.getByRole('button', { name: '定位位置 1', exact: true }).count(), 0);
  await page.getByLabel('位置 1 章', { exact: true }).selectOption('chapter-2'); await eventually(() => anchors('多框跨页.md'), (items) => items[0].chapter === 'chapter-2' && items[0].section === '1.2', 'chapter change silently changed section'); await page.getByText(/节标识无效或不属于所选章/).waitFor();
  await page.getByLabel('位置 1 文件页', { exact: true }).selectOption('20'); assert.equal(await page.getByRole('button', { name: '定位位置 1', exact: true }).count(), 0);
  await page.getByLabel('位置 1 章', { exact: true }).selectOption('chapter-1'); await page.getByRole('button', { name: '定位位置 1', exact: true }).waitFor();
  await page.getByLabel('位置 1 教材', { exact: true }).selectOption(''); assert.equal(await page.getByLabel('位置 1 文件页', { exact: true }).isDisabled(), true); assert.equal(await page.getByRole('button', { name: '定位位置 1', exact: true }).count(), 0);
  await eventually(() => anchors('多框跨页.md'), (items) => items[0].textbook === undefined && items[0].pdf_page === 20 && items[0].section === '1.2', 'invalid prerequisite erased lower fields');
  record('real catalog dropdowns support chapter-only classification; chapter/book changes retain inactive dependent fields and never guess a page');
  await source(note([{ ...anchor, rects: [[.995, .995, .005, .005]] }])); await saved('多框跨页.md', (text) => text.includes('0.995')); await modes(); await position(); await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click();
  const tiny = page.locator('#page-20 .desktop-region').first(); await tiny.focus(); await tiny.press('Shift+ArrowRight'); await tiny.press('Shift+ArrowDown');
  await tiny.scrollIntoViewIfNeeded(); const corner = await tiny.locator('.desktop-region-handle').boundingBox(); await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down(); await page.mouse.move(corner.x + corner.width / 2 + 3, corner.y + corner.height / 2 + 3); await page.mouse.up();
  await page.getByRole('button', { name: '保存区域调整', exact: true }).click(); await saved('多框跨页.md', (text) => parse(text).data._textbook.anchors[0].rects.every(validRect));
  record('keyboard and pointer resizing a 0.005-wide bottom-right region stays within page');

  await open('往返'); await modes('preview'); await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: '选择同名笔记', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: '选择笔记链接', exact: true }); await chooser.getByRole('heading', { name: '同名笔记，请选择目标', exact: true }).waitFor();
  await chooser.locator('.anchor-preview img').first().waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.note-link-dialog[open] .anchor-preview img')].every((img) => img.complete && img.naturalWidth > 0)); await page.screenshot({ path: path.join(evidence, 'duplicate-candidates-regions.png') });
  await chooser.getByRole('button', { name: '取消', exact: true }).click();
  // Invalid draft is parked while opening a textbook marker candidate, then restored.
  const invalid = '---\n坏: [\n---\n尚未保存现场'; await source(invalid); await page.getByText(/YAML 第/).first().waitFor();
  await delay(400);
  await app.evaluate(({ ipcMain }) => {
    globalThis.anchorReadCount = 0;
    for (const channel of ['vault:read', 'vault:links', 'vault:list']) {
      const handler = ipcMain._invokeHandlers.get(channel);
      ipcMain._invokeHandlers.set(channel, (...args) => { globalThis.anchorReadCount++; return handler(...args); });
    }
  });
  await page.evaluate(() => { window.anchorListMutations = 0; new MutationObserver((records) => { window.anchorListMutations += records.length; }).observe(document.querySelector('.vault-sidebar nav'), { subtree: true, childList: true, attributes: true, characterData: true }); });
  await editor().click(); await editor().press('ControlOrMeta+End'); const typingStart = performance.now(); await page.keyboard.type('连续键入检查'.repeat(12), { delay: 2 }); timings.typing72Ms = Math.round(performance.now() - typingStart);
  const counts = { reads: await app.evaluate(() => globalThis.anchorReadCount), listMutations: await page.evaluate(() => window.anchorListMutations) };
  assert.ok(counts.reads < 20, `typing read entire note library: ${counts.reads}`); assert.equal(counts.listMutations, 0); timings.typingReads = counts.reads;
  record('971-note scale: 72 typed characters do not reread the library or mutate the file list');

  await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); if (!await page.getByRole('button', { name: '框选当前页', exact: true }).isVisible()) await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await jump(20);
  const separator = page.getByRole('separator', { name: '调整笔记与教材面板', exact: true }); await separator.focus(); await separator.press('ArrowLeft');
  await page.getByRole('button', { name: '返回当前笔记', exact: true }).click(); assert.ok((await editor().innerText()).includes('尚未保存现场'));
  await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await page.getByRole('button', { name: /打开文件第 20 页的/ }).click();
  const bookChooser = page.getByRole('dialog', { name: '选择教材笔记', exact: true }); await bookChooser.locator('button').filter({ hasText: '甲/相反数.md' }).click(); await page.getByRole('heading', { name: '相反数', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回来源', exact: true }).click(); await page.getByRole('heading', { name: '往返', exact: true }).waitFor(); assert.ok((await editor().innerText()).includes('尚未保存现场')); assert.equal(await disk('往返.md'), original);
  record('duplicate candidates show actual region images; split/fullscreen/resize and textbook-marker navigation return to invalid unsaved source without writing it');
  await source(original); await modes(); await position(); await page.getByRole('button', { name: '定位位置 1', exact: true }).click(); await jump(20);
  await page.setViewportSize({ width: 760, height: 900 }); await page.screenshot({ path: path.join(evidence, 'narrow-split.png') });
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }); await app.close(); app = null; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); offline = true;
  await launch(); await notes(); await page.getByRole('heading', { name: '往返', exact: true }).waitFor(); await position(); await page.getByRole('button', { name: '定位位置 1', exact: true }).click(); await jump(20); await draw(20, [.18, .26, .4, .06]); await page.getByRole('button', { name: '添加到当前笔记', exact: true }).click(); await eventually(() => anchors('往返.md'), (items) => items.length === 2, 'offline append failed');
  await page.screenshot({ path: path.join(evidence, 'offline-roundtrip.png') });
  record('network disabled after restart: downloaded page, top location, selection and return all work');
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await draw(20, [.22, .27, .3, .04]); await page.getByRole('textbox', { name: '框选新笔记名称', exact: true }).fill('保护拒绝'); await page.getByRole('button', { name: '展开教材分屏', exact: true }).click();
  await source('---\n坏: [\n---\n保护期间草稿'); await page.getByText(/YAML 第/).first().waitFor();
  await app.evaluate(({ app, ipcMain }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`), fs = require('node:fs/promises'), path = require('node:path');
    const handler = ipcMain._invokeHandlers.get('vault:protect-draft'); let once = true;
    ipcMain._invokeHandlers.set('vault:protect-draft', async (...args) => {
      const result = await handler(...args);
      if (once && args[2] === '往返.md') { once = false; const file = path.join(process.env.ANCHORS_TEST_ROOT, '往返.md'); await fs.writeFile(file, await fs.readFile(file, 'utf8') + '\n保护期间外部编辑'); }
      return result;
    });
  });
  await page.getByRole('button', { name: '从框选新建笔记', exact: true }).click(); await page.getByRole('alert').filter({ hasText: /来源磁盘笔记已改变/ }).waitFor();
  assert.equal(await page.locator('.vault-note-heading h1').innerText(), '往返'); assert.ok((await editor().innerText()).includes('保护期间草稿')); assert.ok((await disk('往返.md')).includes('保护期间外部编辑')); await assert.rejects(disk('保护拒绝.md'));
  await page.getByRole('button', { name: '取消框选', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'protection-race-rejected.png') });
  record('external source edit during actual draft protection rejects creation; keeps both local draft and changed disk file');
  await page.getByRole('button', { name: '采用磁盘版本', exact: true }).click(); await page.getByRole('button', { name: '保留恢复记录并采用磁盘', exact: true }).click(); await eventually(() => editor().innerText(), (text) => text.includes('保护期间外部编辑') && !text.includes('保护期间草稿'), 'race recovery adoption failed');

  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'passed', reused: !!process.env.ANCHORS_REUSE, root, checks, timings, errors, remote }, null, 2)); console.log(JSON.stringify({ evidence, checks: checks.length, timings, result: 'passed' }));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); } console.error('Evidence:', evidence, error); if (app) console.error('Main save hold', await app.evaluate(() => typeof globalThis.anchorReleaseSave).catch(() => 'unavailable')); throw error; }
finally { if (app) { await app.evaluate(({ dialog }) => { globalThis.anchorReleaseSave?.(); dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); } if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } }
