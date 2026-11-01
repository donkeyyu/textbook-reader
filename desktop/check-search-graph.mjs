// Isolated Electron + filesystem. Reuse an explicitly supplied 971-note QA
// vault and verified textbook resources; no first-download claim is made here.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
const project = path.resolve(import.meta.dirname, '..');
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-search-graph-check-')));
console.log(`Evidence: ${evidence}`);
const [fixtureVault, fixtureData] = process.argv.slice(2);
assert.ok(fixtureVault && fixtureData, 'Pass a verified 971-note QA vault and its app-data directory. Both are copied, never edited.');
const smallRoot = path.join(evidence, '笔记库'), data = path.join(evidence, 'app-data');
let root = smallRoot;
await mkdir(root); await mkdir(path.join(root, '甲')); await mkdir(path.join(root, '乙'));
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const fixture = {
  '来源.md': '---\ntags: [旧标签]\n属性: "[[目标]]"\n---\n初始正文 [[目标]] [[目标]] [[相反数]] [[缺失]]',
  '目标.md': '缺 ID 的手动正文 [[来源]]',
  '甲/相反数.md': `---\n_textbook: {anchors: [{textbook: ${pack.textbook}, chapter: chapter-1, pdf_page: 20}, {textbook: ${pack.textbook}, pdf_page: 21}]}\n---\n数轴上的相反数。`,
  '乙/相反数.md': '代数中的相反数。',
  '副本甲.md': '---\n_textbook: {id: repeated}\n---\n第一份重复身份。',
  '副本乙.md': '---\n_textbook: {id: repeated}\n---\n第二份重复身份。',
  '只有定位.md': `---\n_textbook: {anchors: [{textbook: ${pack.textbook}, pdf_page: 20}]}\n---\n只有教材位置，不生成虚构连线。`,
};
for (const [name, source] of Object.entries(fixture)) await writeFile(path.join(root, name), source);
let app, page;
const errors = [], outbound = [], checks = [], timings = {};
const record = (name) => { checks.push(name); console.log(`PASS ${name}`); };
async function launch() {
  const env = { ...process.env, TEXTBOOK_DOWNLOAD_BASE_URL: '' };
  app = await _electron.launch({ executablePath: process.env.DESKTOP_EXECUTABLE || path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [...(process.env.DESKTOP_EXECUTABLE ? [] : [project]), `--user-data-dir=${data}`], env, timeout: 30_000 });
  page = await app.firstWindow({ timeout: 30_000 }); page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) outbound.push(request.url()); });
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  // Pixi's native devtools hook: observe the actual renderer, without app changes.
  await page.evaluate(() => { globalThis.__PIXI_APP_INIT__ = (app) => { window.qaNoteGraph = app; }; });
}
async function eventually(read, predicate, message) {
  for (let count = 0; count < 240; count++) { const value = await read().catch(() => undefined); if (value !== undefined && predicate(value)) return value; await delay(50); }
  assert.fail(message);
}
async function ready() { await page.getByRole('button', { name: '新建笔记', exact: true }).waitFor(); await eventually(() => page.getByRole('button', { name: '新建笔记', exact: true }).isEnabled(), Boolean, 'editor stayed busy'); }
async function search(query) { if (!await page.getByLabel('搜索本地笔记', { exact: true }).isVisible()) await page.getByRole('button', { name: '搜索笔记', exact: true }).click(); await page.getByLabel('搜索本地笔记', { exact: true }).fill(query); }
const results = () => page.getByLabel('本地搜索结果', { exact: true });
async function closeSearch() { if (await page.getByRole('button', { name: '收起搜索', exact: true }).isVisible()) await page.getByRole('button', { name: '收起搜索', exact: true }).click(); }
async function open(name) { await closeSearch(); await page.locator('.vault-sidebar nav').getByRole('button', { name, exact: true }).click(); await page.getByRole('heading', { name, exact: true }).waitFor(); await ready(); }
async function setSource(text) { await page.getByLabel('正文模式', { exact: true }).selectOption('edit'); await page.getByLabel('文件头模式', { exact: true }).selectOption('source'); const editor = page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }); await editor.click(); await editor.press('ControlOrMeta+a'); await page.keyboard.insertText(text); }
async function saved(name, text) { await eventually(() => readFile(path.join(root, name), 'utf8'), (source) => source.includes(text), 'content did not reach disk'); await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor(); await ready(); }
async function graph() { await closeSearch(); if (!await page.getByLabel('本地笔记知识图', { exact: true }).isVisible()) await page.getByRole('button', { name: '知识图', exact: true }).click(); await page.locator('.note-graph canvas').waitFor(); await page.waitForFunction(() => window.qaNoteGraph?.stage.children[0]?.children[1]?.children.length > 0); }
const graphState = () => page.evaluate(() => { const app = window.qaNoteGraph, world = app.stage.children[0]; return { x: world.x, y: world.y, scale: world.scale.x, drawnNodes: world.children[1].children.length, labels: world.children[2].children.map((item) => item.text), width: app.screen.width, height: app.screen.height }; });
async function clickNode(title) {
  const point = await page.evaluate((title) => {
    const app = window.qaNoteGraph, world = app.stage.children[0], labels = world.children[2].children;
    const index = labels.findIndex((label) => label.text.replace(/\s/g, '') === title.replace(/\s/g, ''));
    if (index < 0) throw new Error(`No drawn node ${title}`);
    const dot = world.children[1].children[index], rect = app.canvas.getBoundingClientRect();
    const point = { x: rect.x + world.x + dot.x * world.scale.x, y: rect.y + world.y + dot.y * world.scale.y };
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) throw new Error('Test target is outside the actual canvas');
    return point;
  }, title);
  await page.mouse.click(point.x, point.y);
}
async function clickBlank() {
  const point = await page.evaluate(() => {
    const app = window.qaNoteGraph, world = app.stage.children[0], rect = app.canvas.getBoundingClientRect();
    for (let y = 60; y < rect.height - 150; y += 50) for (let x = 30; x < rect.width - 200; x += 50) {
      if (world.children[1].children.every((dot) => Math.hypot(world.x + dot.x * world.scale.x - x, world.y + dot.y * world.scale.y - y) > 30)) return { x: rect.x + x, y: rect.y + y };
    }
    throw new Error('No blank test point');
  });
  await page.mouse.click(point.x, point.y);
}
try {
  await launch();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click(); await ready();
  await search('初始正文'); await results().getByRole('button').click(); await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  await setSource('---\ntags: [新标签]\n属性: "[[目标]]"\n---\n保存后的唯一正文 [[目标]] [[目标]] [[相反数]] [[缺失]]');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await saved('来源.md', '保存后的唯一正文');
  await search('初始正文'); assert.equal(await results().getByRole('button').count(), 0);
  await search('新标签 唯一正文'); await results().getByRole('button').click(); await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  await search('旧标签'); assert.equal(await results().getByRole('button').count(), 0);
  record('search → real editor input → save → body and top-level tag results update from disk');
  await search('相反数'); assert.equal(await results().getByRole('button').count(), 3);
  await results().getByText(/文件第 20 页/).waitFor(); await results().getByText('代数中的相反数。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'same-name-search.png') });
  await results().getByRole('button').filter({ hasText: '甲/相反数' }).click(); await page.getByRole('heading', { name: '相反数', exact: true }).waitFor();
  assert.equal(await readFile(path.join(root, '甲/相反数.md'), 'utf8'), fixture['甲/相反数.md']);
  await open('来源'); await graph(); await delay(2200);
  let state = await graphState(); assert.equal(state.drawnNodes, 7); assert.equal(await page.getByLabel('本地笔记知识图').getAttribute('data-edge-count'), '2');
  assert.equal(state.labels.filter((label) => label.includes('ID')).length, 2);
  await page.getByText('2 篇笔记存在 ID 冲突', { exact: false }).waitFor();
  await page.locator('.note-graph-settings summary').click(); await page.getByRole('button', { name: '缩小本地笔记图', exact: true }).click(); await page.locator('.note-graph-settings summary').click();
  const canvas = page.getByLabel('本地笔记图画布', { exact: true }); await canvas.focus(); await canvas.press('ArrowRight'); await canvas.press('ArrowDown');
  const before = await graphState();
  await page.screenshot({ path: path.join(evidence, 'manual-duplicate-graph.png') });
  await clickNode('目标'); await page.getByRole('heading', { name: '目标', exact: true }).waitFor();
  assert.equal(await readFile(path.join(root, '目标.md'), 'utf8'), fixture['目标.md']);
  await page.getByRole('button', { name: '返回来源', exact: true }).click(); await page.getByRole('heading', { name: '来源', exact: true }).waitFor(); await ready();
  await graph(); const after = await graphState(); assert.deepEqual([after.x, after.y, after.scale], [before.x, before.y, before.scale]);
  record('real Pixi canvas retains all paths (multi-anchor, missing/duplicate IDs); node pointer click and source return preserve pan/zoom');
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  const persisted = await readFile(path.join(root, '来源.md'), 'utf8');
  await setSource('---\n坏: [\n---\n未保存检索幽灵 [[副本甲]]');
  await search('未保存检索幽灵'); assert.equal(await results().getByRole('button').count(), 0); await closeSearch();
  await graph(); await clickBlank();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('本地笔记知识图', { exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('button', { name: '笔记库', exact: true }).click();
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  assert.ok((await page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }).innerText()).includes('未保存检索幽灵'));
  await graph(); await clickNode('目标'); await page.getByRole('heading', { name: '目标', exact: true }).waitFor();
  await graph(); await clickBlank(); await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await page.getByRole('heading', { name: '选一篇笔记，继续写', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回来源', exact: true }).click(); await ready();
  assert.ok((await page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }).innerText()).includes('未保存检索幽灵'));
  await page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }).press('ArrowLeft'); await page.keyboard.insertText('光标'); await page.keyboard.press('ControlOrMeta+z');
  assert.ok((await page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }).innerText()).includes('未保存检索幽灵'));
  assert.equal(await readFile(path.join(root, '来源.md'), 'utf8'), persisted);
  await setSource(persisted); await saved('来源.md', '保存后的唯一正文');
  record('invalid YAML draft excluded from search/graph; view/shelf switches and graph navigation retain draft, cursor and undo scene');
  await writeFile(path.join(root, '外加.md'), '---\ntags: [外加标签]\n---\n外部新增正文 [[来源]]');
  await search('外加标签'); await results().getByRole('button').waitFor();
  await writeFile(path.join(root, '外加.md'), '---\ntags: [外改标签]\n---\n外部修改正文 [[目标]]');
  await search('外改标签'); await results().getByRole('button').waitFor();
  await rm(path.join(root, '外加.md')); await eventually(() => results().getByRole('button').count(), (count) => count === 0, 'deleted result remained');
  // Hold one completed old IPC response outside main's operation queue, then delete.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('vault:links');
    globalThis.qaHoldIndex = { next: true, held: false, release: null };
    ipcMain.removeHandler('vault:links');
    ipcMain.handle('vault:links', async (...args) => { const result = await original(...args); if (globalThis.qaHoldIndex.next) { globalThis.qaHoldIndex.next = false; globalThis.qaHoldIndex.held = true; await new Promise((resolve) => { globalThis.qaHoldIndex.release = resolve; }); } return result; });
  });
  await writeFile(path.join(root, '延迟删除.md'), '不能复活的旧结果 [[来源]]');
  await eventually(() => app.evaluate(() => globalThis.qaHoldIndex.held), Boolean, 'old index response was not held');
  await rm(path.join(root, '延迟删除.md'));
  await search('不能复活'); await eventually(() => results().getByRole('button').count(), (count) => count === 0, 'delete was not reflected');
  await app.evaluate(() => globalThis.qaHoldIndex.release()); await delay(500);
  assert.equal(await results().getByRole('button').count(), 0); await graph(); assert.equal((await graphState()).drawnNodes, 7);
  record('external add/edit/delete updates tags and edges; delayed old IPC result cannot resurrect deleted search result or drawn node');
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await app.close(); app = null;
  async function countNotes(directory) {
    let count = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) count += await countNotes(path.join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.md')) count++;
    }
    return count;
  }
  assert.equal(await countNotes(fixtureVault), 971);
  root = path.join(evidence, '971篇笔记库'); await cp(fixtureVault, root, { recursive: true, force: false, errorOnExist: true });
  await rm(path.join(data, 'textbook-resources'), { recursive: true, force: true });
  await cp(path.join(fixtureData, 'textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true, force: false, errorOnExist: true });
  assert.equal(await countNotes(root), 971);
  await launch(); await page.getByRole('button', { name: '笔记库', exact: true }).click(); await ready();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '切换笔记库', exact: true }).click(); await ready();
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  const importStart = performance.now(); await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 60_000 }); timings.cachedAddMs = performance.now() - importStart;
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill('88'); await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await page.waitForFunction(() => { const image = document.querySelector('#page-88 .page-image'); return image?.complete && image.naturalWidth > 0; });
  const sourceId = 'ch3-q-p88-example4', entry = pack.entries.find((item) => item.sourceId === sourceId);
  await page.locator(`button[data-supplement-ids~="${sourceId}"]`).click();
  const choices = page.getByRole('complementary', { name: '选择本地笔记', exact: true });
  if (await choices.count()) await choices.getByRole('button', { name: entry.title, exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor(); await ready();
  const plan = JSON.parse(await readFile(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/plan.json`), 'utf8'));
  const target = plan.notes.find((item) => item.sourceId === sourceId);
  await page.getByLabel('正文模式').selectOption('edit'); const editor = page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
  await editor.click(); await editor.press('ControlOrMeta+End'); await page.keyboard.insertText('\n本地保存独有检索词');
  const saveStart = performance.now(); await page.getByRole('button', { name: '保存', exact: true }).click(); await saved(target.path, '本地保存独有检索词'); timings.scaleSaveMs = performance.now() - saveStart;
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  assert.equal(await page.locator('.reader-tools-browse').count(), 0, 'desktop reader must not retain static search/graph controls');
  await page.getByRole('group', { name: '查阅本地笔记', exact: true }).getByRole('button', { name: '搜索笔记', exact: true }).click();
  const searchStart = performance.now(); await page.getByLabel('搜索本地笔记', { exact: true }).waitFor(); await search('本地保存独有检索词'); await results().getByRole('button').waitFor(); timings.scaleSearchMs = performance.now() - searchStart;
  await results().getByRole('button').click(); await ready();
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  const graphStart = performance.now(); await page.getByRole('group', { name: '查阅本地笔记', exact: true }).getByRole('button', { name: '知识图', exact: true }).click(); await graph(); await eventually(() => graphState(), (state) => state.drawnNodes === 971, '971 real nodes were not drawn'); timings.scaleGraphMs = performance.now() - graphStart;
  await delay(2500); const scaleState = await graphState(); assert.ok(scaleState.labels.some((label) => label.replace(/\s/g, '') === entry.title.replace(/\s/g, ''))); assert.ok(scaleState.labels.every((label) => !label.includes('/')));
  await page.screenshot({ path: path.join(evidence, '971-content-graph.png') });
  await page.locator('.note-graph-settings summary').click(); await page.getByRole('button', { name: '定位当前笔记', exact: true }).click(); await page.locator('.note-graph-settings summary').click();
  await delay(200); await clickNode(entry.title); await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor();
  assert.ok((await editor.innerText()).includes('本地保存独有检索词'));
  await graph(); await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.locator(`button[data-supplement-ids~="${sourceId}"]`).click();
  if (await choices.count()) await choices.getByRole('button', { name: entry.title, exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor();
  assert.equal(await page.getByLabel('本地笔记知识图', { exact: true }).isVisible(), false);
  record('copied verified 971-note library/resources; textbook marker, search and actual scale-canvas node open the same edited local file; graph labels use basenames');
  await app.close(); app = null;
  await launch(); await page.getByRole('button', { name: '笔记库', exact: true }).click(); await ready();
  await search('本地保存独有检索词'); await results().getByRole('button').click(); await ready();
  assert.ok((await page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }).innerText()).includes('本地保存独有检索词'));
  await graph(); await eventually(() => graphState(), (state) => state.drawnNodes === 971, 'offline rebuild missed nodes');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 900));
  await page.getByLabel('本地笔记图画布').focus(); await page.keyboard.press('/'); await page.getByLabel('搜索本地笔记').fill('本地保存独有检索词');
  const searchBounds = await page.getByRole('search', { name: '搜索已保存笔记', exact: true }).boundingBox();
  assert.ok(searchBounds.x >= 0 && searchBounds.x + searchBounds.width <= 760, 'narrow search panel must fit the viewport');
  await page.screenshot({ path: path.join(evidence, 'narrow-offline-search.png') });
  await page.getByLabel('搜索本地笔记').press('ArrowDown'); await page.keyboard.press('Enter');
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(evidence, 'narrow-offline-editor.png') });
  assert.equal(await readFile(path.join(smallRoot, '目标.md'), 'utf8'), fixture['目标.md']);
  record('network-disabled process restart rebuilds disk-only search/graph; 760px keyboard search opens saved note; missing-ID scan remains read-only');
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ evidence, root, fixtureVault, fixtureData, checks, timings, errors, outbound }, null, 2));
  console.log(JSON.stringify({ result: 'passed', evidence, timings }));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); throw error; }
finally { if (app) app.process().kill('SIGTERM'); }
