// Run after npm run desktop:build. All notes and downloads use a fresh QA directory.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { resizeWindow } from './check-window.mjs';

const project = path.resolve(import.meta.dirname, '..');
const fixture = await mkdtemp(path.join(os.tmpdir(), 'textbook-reader-navigation-'));
const root = path.join(fixture, '独立笔记库'), data = path.join(fixture, 'app-data');
const evidence = path.join(project, 'output/reader-navigation');
await mkdir(root); await mkdir(evidence, { recursive: true });
// Optional previous output from this check speeds UI iterations; always copy it.
const reused = process.env.READER_NAVIGATION_FIXTURE;
if (reused) {
  await cp(path.join(reused, '独立笔记库'), root, { recursive: true });
  await mkdir(data);
  await cp(path.join(reused, 'app-data/textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true });
}
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'), 'utf8'));
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const example = pack.entries.find((entry) => entry.sourceId === 'ch3-q-p88-example4');
assert.ok(example);
await writeFile(path.join(root, 'QA-跨页定位.md'), `---\n_textbook:\n  anchors:\n    - {textbook: ${pack.textbook}, pdf_page: 20, rects: [[0.1, 0.2, 0.3, 0.06]]}\n    - {textbook: ${pack.textbook}, pdf_page: 21, rects: [[0.1, 0.3, 0.3, 0.06]]}\n---\n仅用于验证多个定位的交互，不是教材内容。\n`);
const titleSource = (text, number) => `---\n_textbook:\n  schema_version: 1\n  id: ${randomUUID()}\n  create_time: "2020-01-01T00:00:00Z"\n  update_time: "2020-01-01T00:00:00Z"\n  anchors:\n    - {textbook: ${pack.textbook}, pdf_page: ${number}, rects: [[0.1, 0.3, 0.3, 0.06]]}\n---\n${text}\n`;
const titleDraft = titleSource('只用于验证标题改名，原正文与 ID 必须保留。', 22);
const linkedTitleDraft = titleSource('带引用笔记的原正文。', 23);
const titleReference = '标题链接：[[QA-带引用原标题|保留别名]]，以及 [[QA-带引用原标题]]。\n';
await writeFile(path.join(root, 'QA-标题原稿.md'), titleDraft);
await writeFile(path.join(root, 'QA-带引用原标题.md'), linkedTitleDraft);
await writeFile(path.join(root, 'QA-标题引用.md'), titleReference);
await writeFile(path.join(root, 'QA-已存在.md'), '重名检测目标，不可覆盖。\n');
const allowed = new Set(manifest.download.map((entry) => entry.path));
const requests = new Set(), errors = [], remote = [], checks = [];
const layouts = [];
let app, page, notePath, offline = false;
const server = createServer((request, response) => { void (async () => {
  const relative = request.url.slice(1);
  if (!allowed.has(relative)) { response.writeHead(404); response.end(); return; }
  requests.add(relative);
  response.end(await readFile(path.join(project, relative.endsWith('catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${relative}`)));
})().catch(() => { response.writeHead(500); response.end(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const graphToggle = (open) => page.getByRole('button', { name: open ? '打开图谱' : '关闭图谱', exact: true });
const comparison = () => page.getByRole('button', { name: /^(展开|收起)教材$/ });
async function compare(open) {
  if ((await comparison().getAttribute('aria-expanded') === 'true') !== open) await comparison().click();
}
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
const paper = () => page.getByLabel('笔记编辑器', { exact: true });
const book = () => page.getByLabel('教材连续阅读', { exact: true });
const disk = () => readFile(path.join(root, notePath), 'utf8');
const record = (name) => { checks.push(name); console.log(`PASS ${name}`); };
async function eventually(read, predicate, message, attempts = 400) {
  for (let count = 0; count < attempts; count++) {
    const value = await read().catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (value !== undefined && predicate(value)) return value;
    await delay(50);
  }
  assert.fail(message);
}
async function launch() {
  const env = { ...process.env, TEXTBOOK_DOWNLOAD_BASE_URL: offline ? '' : `http://127.0.0.1:${server.address().port}/` };
  app = await _electron.launch({ args: [project, `--user-data-dir=${data}`, ...(!offline ? ['--textbook-local-http'] : [])], env, timeout: 30_000 });
  if (offline) await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await resizeWindow(app, page, { width: 1440, height: 980 });
  await app.evaluate(({ dialog }) => {
    globalThis.qaCloseDialogs = [];
    dialog.showMessageBoxSync = (...args) => {
      const options = args.find((value) => value && Array.isArray(value.buttons));
      globalThis.qaCloseDialogs.push({ message: options.message, buttons: options.buttons });
      const keep = options.buttons.indexOf('继续编辑');
      if (keep < 0) throw new Error('QA native prompt has no keep-editing option');
      return keep;
    };
  });
  // Observe actual Pixi scene positions; pointer selection still uses the real canvas.
  await page.evaluate(() => { globalThis.__PIXI_APP_INIT__ = (graph) => { window.qaNavigationGraph = graph; }; });
}
async function closeApp() {
  if (!app) return;
  // Only dispose this check's isolated QA windows; close behavior is tested separately.
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
  await app.close().catch(() => {}); app = undefined;
}
async function requestNativeClose() {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
}
async function loaded(number) {
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction((number) => { const image = document.querySelector(`#page-${number} .page-image`); return image?.complete && image.naturalWidth > 0; }, number);
}
async function jump(number) {
  await page.locator('.page-index').click();
  await page.getByLabel('页码', { exact: true }).fill(String(number));
  await page.getByLabel('页码', { exact: true }).press('Enter');
  await loaded(number);
}
async function openExampleMarker() {
  await page.locator('#page-88').getByRole('button', { name: new RegExp(`打开笔记：.*${example.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
  const choices = page.getByRole('dialog', { name: '选择教材笔记', exact: true });
  if (await choices.isVisible()) await choices.getByRole('button').filter({ has: page.locator('strong', { hasText: example.title }) }).click();
  await page.locator('.vault-note-title').filter({ hasText: example.title }).waitFor();
}
async function saved(text, present = true) {
  await eventually(disk, (source) => source.includes(text) === present, `local file did not ${present ? 'retain' : 'remove'} ${text}`);
  await page.getByRole('status').filter({ hasText: /^已保存到本地$/ }).waitFor();
}
async function bodyMode(value) {
  const label = { edit: '编辑正文', preview: '只读预览', live: '实时预览' }[value];
  const button = page.getByRole('button', { name: label, exact: true });
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
}
async function headerMode(value) {
  const metadata = page.locator('.note-metadata');
  if (!await page.getByLabel('文件头模式', { exact: true }).isVisible()) await page.getByRole('button', { name: '笔记属性', exact: true }).click();
  await page.getByLabel('文件头模式', { exact: true }).selectOption(value);
  if (value === 'properties' && await metadata.getAttribute('open') !== null) await metadata.locator('summary').first().click();
}
async function openQaNote(title) {
  await page.waitForFunction(() => !document.querySelector('.vault-list-actions button')?.disabled);
  await page.getByRole('button', { name: '笔记列表', exact: true }).click();
  await page.locator('.vault-sidebar nav').getByRole('button', { name: title, exact: true }).click();
  await page.locator('.vault-note-title').filter({ hasText: title }).waitFor();
}
async function screenshot(name) {
  await page.waitForFunction(() => !document.querySelector('.vault-list-actions button')?.disabled);
  const bounds = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    outsideToolbar: [...document.querySelectorAll('.workspace-toolbar button,.workspace-toolbar summary,.graph-corner-controls button,.graph-corner-controls summary,.vault-note-actions button')].filter((element) => element.getClientRects().length).map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent, left: rect.left, right: rect.right };
    }).filter((rect) => rect.left < -1 || rect.right > innerWidth + 1),
  }));
  layouts.push({ name, ...bounds });
  assert.ok(bounds.document[0] <= bounds.viewport[0] + 1, `${name}: horizontal document overflow ${JSON.stringify(bounds)}`);
  assert.ok(bounds.document[1] <= bounds.viewport[1] + 1, `${name}: vertical document overflow ${JSON.stringify(bounds)}`);
  assert.deepEqual(bounds.outsideToolbar, [], `${name}: toolbar controls outside viewport`);
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}
async function sameEditor() {
  assert.equal(await page.evaluate(() => window.qaNavigationEditor === document.querySelector('.cm-editor')), true, 'navigation remounted the editor');
}
async function clickSelectedNode() {
  await page.waitForFunction(() => window.qaNavigationGraph?.stage.children[0]?.children[1]?.children.length > 0);
  await page.locator('.note-graph .graph-settings summary').click();
  const focus = page.getByRole('button', { name: '定位当前笔记', exact: true });
  if (await focus.isVisible()) await focus.click();
  await page.locator('.note-graph .graph-settings summary').click();
  const point = await eventually(() => page.evaluate((title) => {
    const graph = window.qaNavigationGraph, world = graph.stage.children[0];
    const index = world.children[2].children.findIndex((label) => label.text.replace(/\s/g, '') === title.replace(/\s/g, ''));
    if (index < 0) return null;
    const dot = world.children[1].children[index], box = graph.canvas.getBoundingClientRect();
    const x = box.x + world.x + dot.x * world.scale.x, y = box.y + world.y + dot.y * world.scale.y;
    return x > box.left && x < box.right && y > box.top && y < box.bottom ? { x, y } : null;
  }, example.title), Boolean, 'selected note is not on the canvas');
  await page.mouse.click(point.x, point.y);
}
try {
  console.log('QA fixture:', fixture);
  await launch();
  await graphToggle(true).waitFor();
  assert.equal(await page.getByRole('navigation', { name: '阅读模式', exact: true }).count(), 0, 'reading must not require choosing a mode');
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).first().click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  await page.getByRole('button', { name: /^(添加到书架|已添加)$/ }).waitFor();
  const addBook = page.getByRole('button', { name: '添加到书架', exact: true });
  if (await addBook.isVisible()) await addBook.click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  assert.equal(requests.size, reused ? 0 : manifest.download.length, 'textbook resources must come from the fresh local download or copied QA cache');
  const plan = JSON.parse(await readFile(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/plan.json`), 'utf8'));
  notePath = plan.notes.find((entry) => entry.sourceId === example.sourceId).path;
  const initial = await disk();
  await jump(88);
  assert.equal(await paper().isVisible(), false);
  await screenshot('book-default');
  const listToggle = page.locator('.workspace-toolbar').getByRole('button', { name: '笔记列表', exact: true });
  await listToggle.click(); await page.locator('#vault-file-list').waitFor();
  assert.equal(await paper().isVisible(), false, 'opening the global list must not require opening a note');
  await screenshot('book-global-note-list');
  const listButton = page.getByRole('button', { name: '笔记列表', exact: true });
  const listBounds = await listButton.boundingBox(), labelBounds = await listButton.locator('span').boundingBox();
  assert.ok(labelBounds.y >= listBounds.y && labelBounds.y + labelBounds.height <= listBounds.y + listBounds.height, 'note list label must stay inside its toolbar button');
  await page.getByRole('button', { name: '关闭笔记列表', exact: true }).click();
  assert.equal(await page.locator('#vault-file-list').isVisible(), false);
  await listToggle.click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#vault-file-list').isVisible(), false, 'Escape must dismiss the global list');
  assert.equal(await listToggle.getAttribute('aria-expanded'), 'false');
  record('global note list opens before any note, closes with its button and Escape, and leaves the textbook visible');

  await openExampleMarker();
  await bodyMode('live');
  await headerMode('properties');
  await page.locator('#page-88 .desktop-anchor-boundary').first().waitFor();
  assert.equal(await graphToggle(true).isVisible(), true);
  let a = await book().boundingBox(), b = await paper().boundingBox();
  assert.ok(a.width > b.width && a.x + a.width <= b.x + 12, 'wide book mode must put smaller notes to its right');
  assert.equal(await disk(), initial, 'reading an AI draft must not rewrite it');
  await page.waitForFunction(() => document.querySelector('.note-rendered-block .math-inline svg') && !document.querySelector('.note-rendered-block .math-pending'));
  await screenshot('book-right-note');
  const leftTools = await page.getByRole('group', { name: '编辑工具', exact: true }).boundingBox();
  const rightTools = await page.getByRole('group', { name: '笔记工具', exact: true }).boundingBox();
  assert.ok(leftTools.x + leftTools.width <= rightTools.x + 1, 'editing tools must be grouped left of note navigation and management');
  for (const label of ['编辑正文', '只读预览', '实时预览', '笔记属性']) assert.equal(await page.getByRole('group', { name: '编辑工具', exact: true }).getByRole('button', { name: label, exact: true }).count(), 1);
  assert.equal(await page.getByRole('group', { name: '笔记工具', exact: true }).getByRole('button', { name: '收起笔记', exact: true }).count(), 1);
  layouts.push({ name: 'toolbar-groups', left: leftTools, right: rightTools });

  record('fresh book default; complete local textbook import; marker opens its AI draft alongside the original without rewriting');
  assert.equal(await page.getByLabel('课本操作', { exact: true }).count(), 0);
  assert.equal(await page.locator('.workspace-page-menu').count(), 0);
  await page.getByRole('button', { name: '笔记属性', exact: true }).click();
  for (const label of ['从教材框选添加', '编辑位置 1 区域']) {
    if (label === '从教材框选添加') await page.locator('.anchor-add > summary').click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByLabel('教材框选草稿', { exact: true }).waitFor();
    await page.locator('#page-88 .region-selector').waitFor();
    await page.getByRole('button', { name: '取消框选', exact: true }).click();
    assert.equal(await page.locator('.region-selector').count(), 0);
    assert.equal(await disk(), initial, 'canceling anchor selection must not write the note');
  }
  await page.locator('.note-metadata > summary').click();
  await openExampleMarker();
  record('existing metadata actions start add/edit region selection directly; cancel keeps disk unchanged and page markers work');


  await bodyMode('edit');
  await editor().click(); await editor().press('ControlOrMeta+End');
  const idleText = `停输入自动保存 ${Date.now()}`;
  await page.keyboard.insertText(`\n${idleText}`);
  await delay(300);
  assert.ok(!(await disk()).includes(idleText), 'idle save must wait for the typing pause');
  await saved(idleText);
  assert.equal(await editor().evaluate((element) => element === document.activeElement), true, 'idle save must work without leaving the editor');
  // Disable only the idle-save timer: blur/close must initiate saving themselves,
  // while filesystem work may legitimately wait behind the preceding save.
  await page.evaluate(() => {
    window.qaIdleTimer = window.setTimeout;
    window.setTimeout = (callback, ms, ...args) => ms === 650 ? 0 : window.qaIdleTimer(callback, ms, ...args);
  });
  const blurText = `离开编辑器立即保存 ${Date.now()}`;
  await page.keyboard.insertText(`\n${blurText}`);
  const blurStarted = Date.now();
  await page.getByRole('button', { name: '笔记属性', exact: true }).click();
  await eventually(disk, (source) => source.includes(blurText), 'blur did not save with the idle timer disabled');
  layouts.push({ name: 'blur-save', elapsedMs: Date.now() - blurStarted });
  await page.locator('.note-metadata > summary').click();
  await editor().focus(); await editor().press('ControlOrMeta+End');
  const hideText = `收起笔记立即保存 ${Date.now()}`;
  await page.keyboard.insertText(`\n${hideText}`);
  const hideStarted = Date.now();
  await page.getByRole('button', { name: '收起笔记', exact: true }).click();
  await eventually(disk, (source) => source.includes(hideText), 'hiding the note did not save with the idle timer disabled');
  await paper().waitFor({ state: 'hidden' });
  layouts.push({ name: 'hide-save', elapsedMs: Date.now() - hideStarted });
  await page.evaluate(() => { window.setTimeout = window.qaIdleTimer; });
  await openExampleMarker();
  record('650ms typing pause saves while focused; blur and immediate hide persist the newest text');

  await editor().click(); await editor().press('ControlOrMeta+End');
  const undone = `切换模式后仍可撤销的测试句 ${Date.now()}`;
  await page.keyboard.insertText(`\n${undone}`); await saved(undone);
  await page.evaluate(() => { window.qaNavigationEditor = document.querySelector('.cm-editor'); });
  await graphToggle(true).click(); await sameEditor();
  await page.locator('.note-graph canvas').waitFor();
  await page.getByRole('button', { name: '收起笔记', exact: true }).click();
  assert.equal(await paper().isVisible(), false);
  await sameEditor(); await clickSelectedNode(); await paper().waitFor(); await sameEditor();
  await graphToggle(false).click(); await sameEditor();
  await editor().focus(); await editor().press('ControlOrMeta+z'); await saved(undone, false);
  const persisted = `本地保存与课本图谱共用的测试句 ${Date.now()}`;
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(`\n${persisted}`); await saved(persisted);
  record('one mounted editor across textbook and graph; undo survives switching; auto-save changes the actual local Markdown');

  const savedSource = await disk();
  await headerMode('source');
  await editor().click(); await editor().press('ControlOrMeta+a');
  await page.keyboard.insertText('---\n未完成属性: [\n---\n切换模式时保留的未保存草稿');
  await page.getByRole('alert').filter({ hasText: 'YAML 第' }).waitFor();
  await graphToggle(true).click(); await graphToggle(false).click();
  await sameEditor();
  assert.ok((await editor().innerText()).includes('切换模式时保留的未保存草稿'));
  assert.equal(await disk(), savedSource, 'invalid draft must not replace the saved file during a mode change');
  assert.equal(await page.getByRole('dialog').filter({ hasText: '还有未保存的草稿' }).isVisible(), false, 'a layout change must not request discarding the same draft');
  await editor().focus(); await editor().press('ControlOrMeta+z');
  await eventually(() => page.getByRole('alert').filter({ hasText: 'YAML 第' }).count(), (count) => count === 0, 'undo did not restore valid source');
  await headerMode('properties');
  record('invalid unsaved source survives textbook and graph while disk stays unchanged; undo restores the source without a discard dialog');

  if (process.platform !== 'win32') {
    const folder = path.dirname(path.join(root, notePath));
    const failedText = `收起面板后仍须显示保存失败 ${Date.now()}`;
    await chmod(folder, 0o500);
    try {
      await editor().click(); await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(`\n${failedText}`);
      await page.getByRole('button', { name: '收起笔记', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '保存失败' }).waitFor();
      assert.equal(await paper().isVisible(), true, 'a save failure must reopen the hidden note');
      assert.ok((await editor().innerText()).includes(failedText));
      assert.ok(!(await disk()).includes(failedText));
      await requestNativeClose();
      await eventually(() => app.evaluate(() => globalThis.qaCloseDialogs), (dialogs) => dialogs.length > 0, 'failed native close must explain why the window stays open');
      assert.equal(page.isClosed(), false, 'failed close must keep the same window');
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.ok((await editor().innerText()).includes(failedText));
      assert.ok(!(await disk()).includes(failedText));
      await screenshot('native-close-save-failure');

    } finally { await chmod(folder, 0o700); }
    await page.getByRole('button', { name: '重试保存', exact: true }).click(); await saved(failedText);
    record('actual write failure reopens its error; native close keeps the same window and draft; retry reaches disk');
  }

  await graphToggle(true).click(); await page.locator('.note-graph canvas').waitFor();
  await compare(false);
  assert.equal(await book().isVisible(), false, 'graph opens without a textbook companion');
  await clickSelectedNode();
  assert.equal(await graphToggle(false).isVisible(), true, 'node selection must keep the graph open');
  assert.equal(await page.getByLabel('本地笔记知识图', { exact: true }).isVisible(), true);
  assert.equal(await paper().isVisible(), true, 'selected graph node must expose its same note');
  assert.equal(await page.locator('.vault-note-title').getAttribute('title'), notePath);
  await sameEditor();
  await bodyMode('live');
  await screenshot('graph-note');
  await compare(true); await loaded(88);
  a = await page.getByLabel('本地笔记知识图', { exact: true }).boundingBox(); b = await book().boundingBox();
  assert.ok(a.x + a.width <= b.x + 12, 'textbook comparison must sit to the right of the graph');
  await screenshot('graph-right-book');
  await jump(88);
  const beforeWheelTop = await book().evaluate((element) => element.scrollTop);
  await book().hover(); await page.mouse.wheel(0, 100);
  const beforeHide = await eventually(() => book().evaluate((element) => element.scrollTop), (value) => Math.abs(value - beforeWheelTop) > 5, 'manual comparison scroll did not move');
  await compare(false);
  assert.equal(await graphToggle(false).isVisible(), true);
  await compare(true); await loaded(88);
  await eventually(() => book().evaluate((element) => element.scrollTop), (top) => Math.abs(top - beforeHide) < 3, 'comparison hide/show lost the current reading position');
  record('real graph node selects the same editor; textbook comparison opens on the right and retains its scroll position');

  await graphToggle(false).click();
  await resizeWindow(app, page, { width: 900, height: 820 });
  a = await book().boundingBox(); b = await paper().boundingBox();
  assert.ok(a.y + a.height <= b.y + 12 && b.width > 850, 'medium book mode must put notes below the textbook');
  const separator = page.getByRole('separator', { name: /调整.*笔记/ });
  assert.equal(await separator.getAttribute('aria-orientation'), 'horizontal');
  const beforeResize = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus(); await separator.press('ArrowUp');
  assert.notEqual(Number(await separator.getAttribute('aria-valuenow')), beforeResize, 'keyboard resizing must change the panel height');
  await screenshot('book-bottom-note');
  await resizeWindow(app, page, { width: 720, height: 780 });
  await screenshot('narrow-book-note');
  await graphToggle(true).click(); await compare(false);
  await resizeWindow(app, page, { width: 720, height: 480 }, true);
  await screenshot('minimum-graph-note');
  const shortCanvas = await page.getByLabel('本地笔记知识图', { exact: true }).boundingBox();
  assert.ok(shortCanvas.height > 30, 'short window must keep a usable graph viewport');
  await resizeWindow(app, page, { width: 720, height: 780 });
  await screenshot('narrow-graph-note');
  await compare(true); await book().waitFor();
  assert.equal(await paper().isVisible(), false, 'narrow comparison must give the textbook sufficient width');
  await page.getByRole('button', { name: '返回图谱', exact: true }).waitFor();
  await screenshot('narrow-book-comparison');
  await page.getByRole('button', { name: '返回图谱', exact: true }).click();
  await paper().waitFor(); await sameEditor();
  await compare(true); await jump(88); await openExampleMarker();
  assert.equal(await graphToggle(false).isVisible(), true);
  assert.equal(await book().isVisible(), false, 'narrow textbook marker must return to the selected graph note');
  record('medium and narrow notes stack with keyboard resize; narrow comparison returns to the same graph and note');

  await resizeWindow(app, page, { width: 1440, height: 980 });
  await graphToggle(false).click();
  if (await page.getByRole('button', { name: '收起笔记', exact: true }).isVisible()) await page.getByRole('button', { name: '收起笔记', exact: true }).click();
  await jump(88);
  const fraction = () => page.locator('#page-88').evaluate((element) => {
    const paper = element.getBoundingClientRect(), pane = document.querySelector('.paper-scroller').getBoundingClientRect();
    return (pane.top - paper.top) / paper.height;
  });
  const beforeWheel = await fraction();
  await book().hover(); await page.mouse.wheel(0, 120);
  const beforeShelf = await eventually(fraction, (value) => Math.abs(value - beforeWheel) > .01, 'manual scroll did not move the page');
  const shelfPosition = { beforeWheel, beforeShelf, scrollTop: await book().evaluate((element) => element.scrollTop) };
  layouts.push({ name: 'shelf-position', ...shelfPosition });
  console.log('Shelf before:', shelfPosition);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await loaded(88);
  let afterShelf;
  await eventually(async () => { afterShelf = await fraction(); return afterShelf; }, (value) => Math.abs(value - beforeShelf) < .03, 'returning from shelf lost the last manual reading position').catch(async (error) => {
    const diagnostic = { beforeShelf, afterShelf, scrollTop: await book().evaluate((element) => element.scrollTop), page: await page.locator('.page-index').innerText() };
    layouts.push({ name: 'shelf-position-failure', ...diagnostic });
    console.log('Shelf after:', diagnostic); throw error;
  });
  record('scroll immediately before shelf return is flushed and restored when reading resumes');

  await jump(21);
  await page.locator('#page-21').getByRole('button', { name: /打开笔记：.*QA-跨页定位/ }).first().click();
  const multiChoices = page.getByRole('dialog', { name: '选择教材笔记', exact: true });
  if (await multiChoices.isVisible()) await multiChoices.getByRole('button').filter({ has: page.locator('strong', { hasText: 'QA-跨页定位' }) }).click();
  await page.locator('.vault-note-title').filter({ hasText: 'QA-跨页定位' }).waitFor();
  await loaded(21);
  await page.locator('#page-21 .desktop-anchor-boundary').waitFor();
  await eventually(() => page.locator('#page-21').evaluate((element) => {
    const sheet = element.getBoundingClientRect(), pane = document.querySelector('.paper-scroller').getBoundingClientRect();
    return (pane.top - sheet.top) / sheet.height;
  }), (value) => Math.abs(value - .3) < .03, 'opening the second anchor must locate its own page and region');
  assert.equal(await page.locator('.page-index').innerText(), '21/202');
  record('manual QA note opened from its second anchor stays on that page despite the previous note session');

  const titleInput = () => page.getByRole('textbox', { name: '笔记标题', exact: true });
  const titleFile = (name) => readFile(path.join(root, `${name}.md`), 'utf8');
  const expectAbsent = async (name) => assert.rejects(titleFile(name), { code: 'ENOENT' });
  const editTitle = async (value) => {
    await page.getByRole('button', { name: '修改笔记标题', exact: true }).click();
    await titleInput().fill(value);
  };
  await openQaNote('QA-标题原稿');
  await bodyMode('preview');
  assert.equal(await page.getByRole('button', { name: '修改笔记标题', exact: true }).isDisabled(), true);
  await bodyMode('live');
  await editTitle('QA-取消修改'); await titleInput().press('Escape');
  assert.equal(await titleFile('QA-标题原稿'), titleDraft); await expectAbsent('QA-取消修改');
  assert.equal(await titleInput().count(), 0);
  await page.getByRole('button', { name: '修改笔记标题', exact: true }).click();
  await titleInput().dispatchEvent('compositionstart');
  await titleInput().fill('QA-输入法尚未完成');
  await delay(800);
  assert.equal(await titleFile('QA-标题原稿'), titleDraft); await expectAbsent('QA-输入法尚未完成');
  await titleInput().dispatchEvent('compositionend'); await titleInput().press('Escape');
  await editTitle('QA-标题停输入自动保存');
  await eventually(() => titleFile('QA-标题停输入自动保存'), (value) => value === titleDraft, 'idle title change did not persist');
  await expectAbsent('QA-标题原稿');
  await editTitle('QA-标题失焦自动保存');
  await page.getByRole('button', { name: '实时预览', exact: true }).click();
  await eventually(() => titleFile('QA-标题失焦自动保存'), (value) => value === titleDraft, 'title blur did not persist');
  await expectAbsent('QA-标题停输入自动保存');
  record('title idle and blur save exact source; unfinished IME composition does not rename a file');
  await editTitle('QA-标题后立即移动');
  await page.getByRole('button', { name: '改名或移动', exact: true }).click();
  const moveDialog = page.getByRole('dialog', { name: '改名与移动笔记', exact: true });
  await moveDialog.waitFor();
  assert.equal(await moveDialog.getByRole('textbox', { name: '移动目标路径', exact: true }).inputValue(), 'QA-标题后立即移动.md');
  assert.equal(await titleFile('QA-标题后立即移动'), titleDraft);
  await moveDialog.getByRole('button', { name: '取消', exact: true }).click();
  record('moving immediately after editing a title uses the newly saved path');
  const longTitle = 'QA-重新理解这条知识并保留完整标题、原笔记身份与正文内容';
  await editTitle(longTitle); await titleInput().press('Enter');
  await eventually(() => titleFile(longTitle), (value) => value === titleDraft, 'title rename must preserve exact source including ID and body');
  await expectAbsent('QA-标题失焦自动保存');
  await page.locator('.vault-note-title').filter({ hasText: longTitle }).waitFor();
  await editTitle('QA-已存在');
  await page.getByRole('button', { name: '保存笔记标题', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '目标已存在' }).waitFor();
  assert.equal(await titleInput().inputValue(), 'QA-已存在');
  assert.equal(await titleFile(longTitle), titleDraft);
  assert.equal(await titleFile('QA-已存在'), '重名检测目标，不可覆盖。\n');
  await titleInput().press('Escape');
  await resizeWindow(app, page, { width: 720, height: 780 });
  for (const label of ['编辑正文', '只读预览', '实时预览', '笔记属性', '收起笔记']) {
    const control = page.getByRole('button', { name: label, exact: true });
    await control.focus();
    assert.equal(await control.evaluate((element) => element === document.activeElement), true);
    assert.ok(await control.getAttribute('title'), `${label} must provide an icon hint`);
  }
  await screenshot('narrow-editable-title');
  await resizeWindow(app, page, { width: 1440, height: 980 });
  record('inline title cancel writes nothing; rename preserves exact Markdown and ID; duplicate target keeps input and both files; narrow icons are reachable');

  await openQaNote('QA-带引用原标题');
  await editTitle('QA-带引用新标题'); await titleInput().press('Enter');
  await page.getByRole('button', { name: '确认改名并维护引用', exact: true }).waitFor();
  assert.equal(await titleFile('QA-带引用原标题'), linkedTitleDraft);
  assert.equal(await titleFile('QA-标题引用'), titleReference); await expectAbsent('QA-带引用新标题');
  await delay(800);
  await page.getByRole('button', { name: '实时预览', exact: true }).click();
  const priorCloseDialogs = await app.evaluate(() => globalThis.qaCloseDialogs.length);
  await requestNativeClose();
  await eventually(() => app.evaluate(() => globalThis.qaCloseDialogs.length), (count) => count > priorCloseDialogs, 'unconfirmed reference changes must keep the native window open');
  assert.equal(page.isClosed(), false);
  assert.equal(await titleInput().inputValue(), 'QA-带引用新标题');
  assert.equal(await titleFile('QA-带引用原标题'), linkedTitleDraft);
  assert.equal(await titleFile('QA-标题引用'), titleReference); await expectAbsent('QA-带引用新标题');
  await screenshot('title-reference-awaiting-confirmation');
  await titleInput().press('Escape');
  assert.equal(await titleFile('QA-带引用原标题'), linkedTitleDraft);
  assert.equal(await titleFile('QA-标题引用'), titleReference);
  await editTitle('QA-带引用新标题'); await titleInput().press('Enter');
  await page.getByRole('button', { name: '确认改名并维护引用', exact: true }).click();
  await eventually(() => titleFile('QA-带引用新标题'), (value) => value === linkedTitleDraft, 'referenced title rename changed identity or body');
  await expectAbsent('QA-带引用原标题');
  await eventually(() => titleFile('QA-标题引用'), (value) => value.includes('[[QA-带引用新标题.md|保留别名]]') && !value.includes('QA-带引用原标题'), 'title rename did not update saved references');
  await page.locator('.vault-note-title').filter({ hasText: 'QA-带引用新标题' }).waitFor();
  record('referenced title requires review; cancel leaves files unchanged; confirm renames the note and updates incoming references');
  await jump(88); await openExampleMarker(); await loaded(88);

  await bodyMode('edit'); await editor().focus(); await editor().press('ControlOrMeta+End');
  const closingText = `关闭原生窗口前输入的内容 ${Date.now()}`;
  await page.keyboard.insertText(`\n${closingText}`);
  assert.ok(!(await disk()).includes(closingText), 'native close test must begin with an unsaved edit');
  const nativeWindowClosed = page.waitForEvent('close');
  const nativeAppClosed = app.waitForEvent('close');
  await requestNativeClose(); await nativeWindowClosed; await nativeAppClosed;
  app = undefined;
  assert.ok((await disk()).includes(closingText), 'native close must write the latest edit before destroying the window');
  record('native window close immediately after typing flushes the current local Markdown before exit');
  offline = true;
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  await launch(); await loaded(88); await openExampleMarker();
  await page.locator('.vault-note-title').filter({ hasText: example.title }).waitFor();
  await bodyMode('edit');
  await editor().press('ControlOrMeta+End');
  assert.ok((await editor().innerText()).includes(persisted));
  assert.ok((await disk()).includes(persisted));
  assert.ok((await editor().innerText()).includes(closingText));
  await loaded(88);
  record('offline app restart reopens saved note and downloaded textbook');
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'passed', fixture, checks, layouts, errors, remote }, null, 2));
  await Promise.all(['failure.png', 'failure.txt'].map((file) => rm(path.join(evidence, file), { force: true })));
  console.log(JSON.stringify({ result: 'passed', evidence, fixture, checks: checks.length }));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
    await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'failed', fixture, checks, layouts, errors, remote, error: String(error) }, null, 2));
  throw error;
} finally {
  await closeApp();
  if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
