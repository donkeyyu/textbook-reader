import { resizeWindow, showNoteList } from './check-window.mjs';
// Real Electron UI path. Only the native folder picker is controlled; OS validation belongs to 15.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, realpath, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { pathLink, noteReferences } from './links.ts';
import { parse } from './format.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { originalTargets } from './original-links.ts';
import { initialRelations } from './initial-relations.ts';
assert.ok(process.env.DESKTOP_EXECUTABLE, 'Set DESKTOP_EXECUTABLE to the isolated DMG-installed app.');

const project = path.resolve(import.meta.dirname, '..');
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-integrated-17-')));
console.log(`Evidence: ${evidence}`);
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'), 'utf8'));
const fixture = process.env.INTEGRATED_FIXTURE;
const root = path.join(evidence, '笔记库'); const data = path.join(evidence, 'app-data'); await mkdir(root);
if (fixture) {
  await cp(path.join(fixture, '笔记库'), root, { recursive: true });
  await mkdir(data);
  await cp(path.join(fixture, 'app-data/textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true });
} else {
await mkdir(path.join(root, '集成目录'));
await writeFile(path.join(root, '手动文件.md'), '# 手动文件\n\n读取不应生成 ID 或历史时间。\n');
const importRoot = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes`); await mkdir(importRoot, { recursive: true });
// A real filesystem failure after the first note installation, before its receipt.
await writeFile(path.join(importRoot, 'receipts'), '阻止收据目录，稍后重试');
const occupied = path.join(root, pack.entries[0].path); await mkdir(path.dirname(occupied), { recursive: true }); await writeFile(occupied, '学生已有同名内容');
}
const sameName = path.join(root, pack.entries[0].path);
const importRoot = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes`);
let httpFailure = true; const hits = new Map(); const checks = []; const record = (text) => { checks.push(text); console.log("PASS", text); };
let offline = Boolean(fixture); let app; let page; const errors = []; const remote = []; const timings = {};
const server = createServer((request, response) => { void (async () => {
  const name = request.url.slice(1); const entry = manifest.download.find((entry) => entry.path === name);
  if (!entry) { response.writeHead(404); response.end(); return; }
  hits.set(name, (hits.get(name) ?? 0) + 1);
  if (httpFailure && name === manifest.download[4].path) { response.writeHead(503); response.end(); return; }
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
  page.setDefaultTimeout(30000);
  await resizeWindow(app, page, { width: 1380, height: 980 });
  await page.getByRole('button', { name: '教材书架', exact: true }).waitFor();
  await page.evaluate(() => { globalThis.__PIXI_APP_INIT__ = (app) => { window.qaNoteGraph = app; }; });
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
  const plan = JSON.parse(await readFile(path.join(importRoot, 'plan.json'), 'utf8'));
  const imported = plan.notes.find((item) => item.sourceId === sourceId);
  assert.equal(await page.locator('.vault-note-title').getAttribute('title'), imported.path);
  assert.equal(parse(await disk(imported.path)).data._textbook.id, imported.id);
  timings.markerOpenMs = Math.round(performance.now() - start);
  return entry;
}
async function append(text) {
  const editor = page.locator('.cm-content[contenteditable=true]'); await editor.click(); await page.keyboard.press('Meta+End'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.insertText(text);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor({ timeout: 30_000 });
}
const disk = (name) => readFile(path.join(root, name), 'utf8');
async function eventually(read, predicate, message) { for (let i = 0; i < 400; i++) { const result = await read().catch(() => undefined); if (result !== undefined && predicate(result)) return result; await delay(50); } assert.fail(message); }
async function open(name) {
  await page.getByRole('button', { name: '笔记库', exact: true }).click();
  await showNoteList(page);
  const label = name.endsWith('.md') ? name.includes('/') ? `${path.basename(name, '.md')} · ${path.dirname(name)}` : name.slice(0, -3) : name;
  await page.locator('.vault-sidebar nav').getByRole('button', { name: label, exact: true }).click();
  await page.locator('.vault-note-heading').getByRole('heading', { name: path.basename(name, '.md'), exact: true }).waitFor();
  await eventually(() => page.locator('.vault-list-actions button').first().isEnabled(), Boolean, 'navigation remained busy');
}
async function metadata() { if (await page.locator('.note-metadata').getAttribute('open') === null) await page.locator('.note-metadata > summary').click(); }
async function position() { await metadata(); if (await page.locator('.note-anchor').first().getAttribute('open') === null) await page.locator('.note-anchor > summary').first().click(); }
async function verifyResources() {
  return page.evaluate(async (manifest) => {
    for (const entry of manifest.download) {
      const response = await fetch(`/${entry.path}`); if (response.status !== 200) throw new Error(entry.path);
      const bytes = await response.arrayBuffer(); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== entry.bytes || hash !== entry.sha256) throw new Error(`Invalid ${entry.path}`);
      if (entry.path.endsWith('.webp')) { const image = new Image(); image.src = `/${entry.path}`; await image.decode(); }
    }
    const fonts = await Promise.all([document.fonts.load('500 16px "Study Serif"'), ...[400, 500, 600, 700, 800].map((weight) => document.fonts.load(`${weight} 16px Nunito`))]);
    if (fonts.some((faces) => faces.length !== 1 || faces[0].status !== 'loaded')) throw new Error('Font load failed');
    return { resources: manifest.download.length, fonts: fonts.length, papers: document.querySelectorAll('.paper-list > .paper').length };
  }, manifest);
}
async function draw(number, rect) {
  await jump(number); await page.getByRole('button', { name: '框选当前页', exact: true }).click();
  const selector = page.locator(`#page-${number} .region-selector`); await selector.waitFor(); const bounds = await selector.boundingBox(); assert.ok(bounds);
  await page.mouse.move(bounds.x + rect[0] * bounds.width, bounds.y + rect[1] * bounds.height); await page.mouse.down();
  await page.mouse.move(bounds.x + (rect[0] + rect[2]) * bounds.width, bounds.y + (rect[1] + rect[3]) * bounds.height, { steps: 8 }); await page.mouse.up();
  await selector.waitFor({ state: 'detached' });
}
async function integratedPath(plan, initialPath) {
  const manual = await disk('手动文件.md'); await open('手动文件'); assert.equal(await disk('手动文件.md'), manual);
  await showNoteList(page); await page.getByRole('button', { name: '新建笔记', exact: true }).click(); await page.getByLabel('新笔记名称', { exact: true }).fill('集成目标'); await page.getByRole('button', { name: '创建草稿', exact: true }).click();
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit'); await page.getByLabel('文件头模式', { exact: true }).selectOption('properties');
  const editor = page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }); await editor.click(); await page.keyboard.insertText('应用新建与自动保存。');
  await eventually(() => disk('集成目标.md'), (s) => s.includes('应用新建与自动保存。'), 'auto-save did not write new note');
  await editor.press('ControlOrMeta+End'); await page.keyboard.insertText(' 快捷键保存。'); await editor.press('ControlOrMeta+s');
  await eventually(() => disk('集成目标.md'), (s) => s.includes('快捷键保存。'), 'shortcut did not write');
  const targetIdentity = parse(await disk('集成目标.md')).data._textbook;
  assert.match(targetIdentity.id, /^[a-f\d]{8}-[a-f\d-]{27}$/i); assert.ok(Number.isFinite(Date.parse(targetIdentity.create_time)));
  record('manual read is unchanged; UI creates UUID/time note, auto-save and real save shortcut persist');
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await draw(20, [.15, .25, .45, .06]); await draw(20, [.15, .38, .4, .06]); await draw(21, [.15, .25, .45, .07]);
  await page.getByLabel('框选新笔记名称', { exact: true }).fill('集成框选'); await page.getByRole('button', { name: '从框选新建笔记', exact: true }).click();
  await eventually(() => disk('集成框选.md'), (s) => parse(s).data._textbook.anchors?.length === 2, 'selection not saved');
  assert.deepEqual(parse(await disk('集成框选.md')).data._textbook.anchors.map((a) => [a.pdf_page, a.rects.length]), [[20, 2], [21, 1]]);
  await position(); await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click(); await jump(20);
  const region = page.locator('#page-20 .desktop-region').first(); await region.click(); const before = await region.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 12, before.y + before.height / 2 + 8, { steps: 6 }); await page.mouse.up();
  await page.getByRole('button', { name: '保存区域调整', exact: true }).click();
  await eventually(() => disk('集成框选.md'), (s) => parse(s).data._textbook.anchors[0].rects[0][0] > .15, 'drag was not saved');
  await page.getByRole('button', { name: '笔记库', exact: true }).click(); await position();
  await page.getByRole('button', { name: '管理自定义目录', exact: true }).click(); const manager = page.getByRole('dialog', { name: '管理自定义目录', exact: true });
  await manager.getByLabel('自定义目录名称', { exact: true }).fill('集成复习章'); await manager.getByRole('button', { name: '添加目录条目', exact: true }).click();
  const customPath = path.join(root, `.textbook/textbooks/${pack.textbook}/custom.json`);
  const custom = () => readFile(customPath, 'utf8').then(JSON.parse);
  const chapter = (await eventually(custom, (d) => d.chapters.some((x) => x.title === '集成复习章'), 'chapter not saved')).chapters.find((x) => x.title === '集成复习章').id;
  await manager.getByLabel('自定义条目类型', { exact: true }).selectOption('section'); await manager.getByLabel('自定义节父章', { exact: true }).selectOption(chapter);
  await manager.getByLabel('自定义目录名称', { exact: true }).fill('集成复习节'); await manager.getByRole('button', { name: '添加目录条目', exact: true }).click();
  const section = (await eventually(custom, (d) => d.sections.some((x) => x.title === '集成复习节'), 'section not saved')).sections.find((x) => x.title === '集成复习节').id;
  await manager.getByRole('button', { name: '关闭目录管理', exact: true }).click();
  await page.getByLabel('位置 1 章', { exact: true }).selectOption(chapter); await page.getByLabel('位置 1 节', { exact: true }).selectOption(section);
  await eventually(() => disk('集成框选.md'), (s) => parse(s).data._textbook.anchors?.[0]?.section === section, 'first shared section not saved');
  await open('集成目标'); await metadata(); await page.getByRole('button', { name: '添加位置', exact: true }).click(); await position();
  await page.getByLabel('位置 1 教材', { exact: true }).selectOption(pack.textbook); await page.getByLabel('位置 1 章', { exact: true }).selectOption(chapter); await page.getByLabel('位置 1 节', { exact: true }).selectOption(section);
  await eventually(() => disk('集成目标.md'), (s) => parse(s).data._textbook.anchors?.[0]?.section === section, 'second note cannot reuse shared section');
  record('pointer multi-box/cross-page creation and actual drag persist normalized anchors; two notes reuse same chapter/section IDs');
  await open('集成框选'); await metadata(); await page.locator('.note-property-create > summary').click();
  await page.getByLabel('新增属性名', { exact: true }).fill('参考'); await page.getByRole('button', { name: '添加属性', exact: true }).click();
  await page.getByLabel('属性值 参考', { exact: true }).fill('[[集成目标.md|属性跳转]]');
  await append('[[集成目标.md|正文跳转]]\n\n集成正文检索词。');
  await page.getByLabel('新增属性名', { exact: true }).fill('tags'); await page.getByLabel('新增属性类型', { exact: true }).selectOption('list'); await page.getByRole('button', { name: '添加属性', exact: true }).click();
  await page.getByRole('button', { name: '添加属性 tags 列表项', exact: true }).click(); await page.getByLabel('属性 tags 第 1 项', { exact: true }).fill('集成标签');
  await eventually(() => disk('集成框选.md'), (s) => parse(s).data.tags?.[0] === '集成标签', 'tag not saved');
  await page.getByLabel('正文模式', { exact: true }).selectOption('preview'); await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: '正文跳转', exact: true }).click();
  await page.getByRole('heading', { name: '集成目标', exact: true }).waitFor(); await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await page.locator('.vault-note-heading').getByRole('heading', { name: '集成框选', exact: true }).waitFor();
  await eventually(() => page.locator('.vault-list-actions button').first().isEnabled(), Boolean, 'source return remained busy');
  if (await page.locator('.note-links > details').getAttribute('open') === null) await page.locator('.note-links > details > summary').click();
  await page.locator('.note-link-row').getByRole('button').filter({ hasText: '属性跳转' }).click(); await page.getByRole('heading', { name: '集成目标', exact: true }).waitFor();
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit'); await page.locator('.note-move-actions > summary').click(); await page.getByRole('button', { name: '改名或移动', exact: true }).click();
  const move = page.getByRole('dialog', { name: '改名与移动笔记', exact: true }); await move.getByLabel('移动目标路径', { exact: true }).fill('集成目录/改名目标.md'); await move.getByRole('button', { name: '预览引用变更', exact: true }).click();
  await move.getByRole('status').filter({ hasText: '1 篇，2 处' }).waitFor(); await move.getByRole('button', { name: '确认改名并维护引用', exact: true }).click(); await move.getByRole('status').filter({ hasText: '已完成' }).waitFor(); await move.getByRole('button', { name: '关闭', exact: true }).click();
  const renamed = parse(await disk('集成目录/改名目标.md')).data._textbook; assert.equal(renamed.id, targetIdentity.id); assert.equal(renamed.create_time, targetIdentity.create_time);
  const refs = noteReferences(await disk('集成框选.md')); assert.equal(refs.filter((r) => r.target === '集成目录/改名目标.md').length, 2); assert.deepEqual(refs.map((r) => r.alias).sort(), ['属性跳转', '正文跳转']);
  record('body and user-property links navigate; UI rename/move preserves ID and aliases and rewrites both exact references');
  const relations = initialRelations(pack); const paths = new Map(plan.notes.map((x) => [x.sourceId, x.path])); let originals = 0, links = 0;
  const catalog = JSON.parse(await readFile(path.join(root, `.textbook/textbooks/${pack.textbook}/catalog.json`), 'utf8'));
  for (const [id, items] of relations) { const source = await disk(paths.get(id)); for (const item of items) { assert.ok(source.includes(item.purpose)); if (item.targets.length) { for (const target of item.targets) assert.ok(noteReferences(source).some((r) => r.target === paths.get(target))); links++; } else originals++; } }
  assert.deepEqual([links, originals], [410, 831]);
  const sourceEntry = [...relations].find(([, rows]) => rows.some((r) => r.targets.length));
  await open(paths.get(sourceEntry[0])); await page.getByLabel('正文模式', { exact: true }).selectOption('preview');
  const reference = noteReferences(await disk(paths.get(sourceEntry[0])))[0]; await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: reference.alias ?? reference.target, exact: true }).first().click(); await page.getByRole('button', { name: '返回来源', exact: true }).click();
  const originalEntry = [...relations].find(([, rows]) => rows.some((r) => !r.targets.length)); await open(paths.get(originalEntry[0])); await page.getByLabel('正文模式', { exact: true }).selectOption('preview');
  const originalLink = page.getByLabel('笔记只读预览', { exact: true }).locator('[data-original-link]').first(); const href = await originalLink.getAttribute('data-original-link'); const target = originalTargets(href, catalog)[0];
  await originalLink.click(); await page.getByRole('button', { name: `第 ${target.page} 页，共 202 页，点击输入页码`, exact: true }).waitFor(); await page.waitForFunction((number) => { const img = document.querySelector(`#page-${number} .page-image`), box = document.querySelector(`#page-${number} .desktop-anchor-boundary`), scroller = document.querySelector('.paper-scroller'); if (!img?.complete || !img.naturalWidth || !box || !scroller) return false; const a = box.getBoundingClientRect(), b = scroller.getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom; }, target.page); assert.equal(await page.locator(`#page-${target.page} .desktop-anchor-boundary`).count(), target.rects.length); await page.screenshot({ path: path.join(evidence, 'default-original-loaded.png') });
  await page.getByRole('button', { name: '返回关联来源', exact: true }).click();
  record('all 1241 actual persisted default relations retain purpose; 410 note / 831 original; both real navigation paths return');
  const initial = plan.notes.find((x) => path.join(root, x.path) === initialPath); await open(initial.path);
  await page.getByLabel('正文模式', { exact: true }).selectOption('live');
}
async function persistentFiles() {
  const files = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const full = path.join(entry.parentPath, entry.name), relative = path.relative(root, full);
    files[relative] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return files;
}
async function searchGraphAndVaults(plan) {
  await page.getByRole('button', { name: '笔记库', exact: true }).click();
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click(); await page.getByLabel('搜索本地笔记', { exact: true }).fill('集成标签 集成正文检索词');
  const results = page.getByLabel('本地搜索结果', { exact: true }); await results.getByRole('button').waitFor(); assert.equal(await results.getByRole('button').count(), 1); await results.getByRole('button').click(); await page.getByRole('heading', { name: '集成框选', exact: true }).waitFor();
  if (await page.getByRole('button', { name: '收起搜索', exact: true }).isVisible()) await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  await page.getByRole('button', { name: '知识图', exact: true }).click(); await page.locator('.note-graph canvas').waitFor();
  await page.waitForFunction(() => window.qaNoteGraph?.stage.children[0]?.children[1]?.children.length > 971);
  const point = await page.evaluate(() => { const app = window.qaNoteGraph, world = app.stage.children[0], labels = world.children[2].children; const i = labels.findIndex((x) => x.text.replace(/\s/g, '') === '集成框选'); if (i < 0) throw new Error('Missing actual graph label'); const dot = world.children[1].children[i], b = app.canvas.getBoundingClientRect(); return { x: b.x + world.x + dot.x * world.scale.x, y: b.y + world.y + dot.y * world.scale.y, count: world.children[1].children.length }; });
  await page.mouse.click(point.x, point.y); await page.getByRole('heading', { name: '集成框选', exact: true }).waitFor(); assert.equal(await page.locator('.vault-note-title').getAttribute('title'), '集成框选.md');
  await page.screenshot({ path: path.join(evidence, 'offline-search-and-graph-note.png') });
  const priorMode = await page.getByLabel('正文模式', { exact: true }).inputValue();
  const custom = await disk(`.textbook/textbooks/${pack.textbook}/custom.json`), source = await disk('集成框选.md');
  const other = path.join(evidence, '第二库'); await mkdir(other); await writeFile(path.join(other, '第二库笔记.md'), '第二库原文。');
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, other); await page.getByRole('button', { name: '切换笔记库', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.vault-name-label')?.textContent === '第二库' && !document.querySelector('.vault-list-actions button')?.disabled);
  await showNoteList(page); await page.getByRole('button', { name: '第二库笔记', exact: true }).click(); assert.equal(await page.locator('.vault-sidebar nav button').count(), 1);
  assert.equal(await page.getByLabel('正文模式', { exact: true }).inputValue(), 'live');
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('heading', { name: '添加一本教材，开始阅读', exact: true }).waitFor(); await page.getByRole('button', { name: '笔记库', exact: true }).click();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root); await page.getByRole('button', { name: '切换笔记库', exact: true }).click(); await page.getByRole('heading', { name: '集成框选', exact: true }).waitFor();
  assert.equal(await disk('集成框选.md'), source); assert.equal(await disk(`.textbook/textbooks/${pack.textbook}/custom.json`), custom); assert.equal(plan.notes.length, 971);
  assert.equal(await page.getByLabel('正文模式', { exact: true }).inputValue(), priorMode);
  record(`offline restart: saved tag/body search, pointer opens same actual graph node (${point.count} nodes); vault switch isolates files/shelf and restores original note/custom data`);
}
try {
  await launch();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  let plan, initialSnapshot;
  if (fixture) {
    plan = JSON.parse(await readFile(path.join(importRoot, 'plan.json'), 'utf8'));
    initialSnapshot = await readFile(path.join(importRoot, 'source.json'), 'utf8');
    record(`copied verified local fixture ${fixture}; no new first-download claim`);
    await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
    await page.getByRole('button', { name: '添加到书架', exact: true }).click();
    await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  } else {
  // Merely reading the shelf did not generate notes or a plan.
  await assert.rejects(readFile(path.join(importRoot, 'plan.json')));
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  const start = performance.now(); await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'HTTP_ERROR' }).first().waitFor();
  await assert.rejects(readFile(path.join(data, 'textbook-resources', pack.textbook, 'complete.json')));
  httpFailure = false; await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  record('real HTTP 503 fails without complete flag; retry resumes downloaded bytes');
  await page.getByRole('alert').filter({ hasText: '不访问教材目录' }).first().waitFor({ timeout: 90_000 });
  console.log('First explicit add stopped on the blocked receipt directory.');
  plan = JSON.parse(await readFile(path.join(importRoot, 'plan.json'), 'utf8'));
  await rm(path.join(importRoot, 'receipts')); await mkdir(path.join(importRoot, 'receipts'));
  // Receipt validation now precedes creation. Block an unreferenced later file
  // with an actual directory so the retry exercises a real partial installation.
  const targetIds = new Set(pack.source.content.supplements.flatMap((item) => item.related.flatMap((relation) => pack.source.content.supplements.filter((target) => target.locationId === relation.locationId).map((target) => target.id))));
  const blocked = plan.notes.find((item, index) => index > 0 && !targetIds.has(item.sourceId));
  assert.ok(blocked);
  const blockedPath = path.join(root, blocked.path); await mkdir(blockedPath);
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  const interruptedPath = path.join(root, plan.notes[0].path);
  let interrupted;
  for (let attempt = 0; attempt < 600; attempt++) { interrupted = await readFile(interruptedPath, 'utf8').catch(() => null); if (interrupted) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.ok(interrupted, 'partial import must actually install the first note');
  await page.getByRole('alert').first().waitFor({ timeout: 30000 });
  await writeFile(interruptedPath, interrupted + '\n中断后学生的修改\n');
  await page.screenshot({ path: path.join(evidence, 'import-failed.png') });
  assert.equal(await readFile(sameName, 'utf8'), '学生已有同名内容');
  await rm(blockedPath, { recursive: true });
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 120_000 });
  console.log('All 971 initial notes imported after a partial failure; existing content preserved.');
  timings.downloadAndImportWithFailureMs = Math.round(performance.now() - start);
  assert.equal((await readdir(path.join(importRoot, 'receipts'))).length, 971);
  initialSnapshot = await readFile(path.join(importRoot, 'source.json'), 'utf8');
  assert.ok((await readFile(interruptedPath, 'utf8')).endsWith('中断后学生的修改\n'));
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  }
  assert.deepEqual(JSON.parse(initialSnapshot), pack, 'local initial source snapshot differs from installed package');
  await page.getByRole('button', { name: /^(开始|继续)阅读$/ }).click(); await jump(88);
  const verified = await verifyResources(); assert.deepEqual(verified, { resources: 405, fonts: 6, papers: 202 });
  record('405 resources byte hashes/image decode, six fonts and 202 actual reader pages');
  const entry = await openFromMarker('ch3-q-p88-example4');
  assert.equal(await page.locator('#supplement-panel .personal-note').count(), 0);
  if (fixture) await page.getByLabel('正文模式').selectOption('live');
  assert.equal(await page.getByLabel('正文模式').inputValue(), 'live');
  // Default live rendering and local diagram are visible before editing.
  await page.locator('.note-initial-diagram').waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.note-initial-diagram'); return image?.complete && image.naturalWidth > 0; });
  await page.getByLabel('正文模式').selectOption('edit'); await append('编辑模式写入：保留原有面积推导。');
  const targetPlan = plan.notes.find((item) => item.sourceId === entry.sourceId); const targetPath = path.join(root, targetPlan.path);
  let saved = await readFile(targetPath, 'utf8'); assert.ok(saved.includes('编辑模式写入：保留原有面积推导。'));
  const id = targetPlan.id;
  assert.equal(parse(saved).data._textbook.id, id);
  assert.deepEqual(parse(saved).data._textbook.ai_source.source_id, entry.sourceId);
  const linked = plan.notes.find((item) => item.sourceId === 'ch3-triangle-base-height');
  await append(pathLink(linked.path, '集成验证：底与高'));
  await page.getByLabel('正文模式').selectOption('preview');
  await page.locator('.note-preview .math-inline svg').first().waitFor();
  await page.locator('.note-preview .note-initial-diagram').waitFor();
  assert.equal(await page.locator('.cm-content[contenteditable=true]').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'unified-preview.png') });
  // A textbook marker and a path link share the same editable note navigation.
  await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: '集成验证：底与高', exact: true }).first().click();
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
  await integratedPath(plan, targetPath);
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: /更多操作/ }).click(); await page.getByRole('menuitem', { name: '移出书架', exact: true }).click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click(); const retry = performance.now();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click(); await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 60_000 });
  timings.readdMs = Math.round(performance.now() - retry);
  assert.equal(await readFile(targetPath, 'utf8'), saved); assert.equal(await readFile(sameName, 'utf8'), '学生已有同名内容');
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await app.evaluate(({ session }) => session.defaultSession.clearCache());
  const preserved = await persistentFiles();
  await app.close(); app = null;
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); offline = true;
  await launch();
  assert.deepEqual(await persistentFiles(), preserved, 'restart/index rebuild changed persistent vault data');
  record(`restart rebuilt memory index with ${Object.keys(preserved).length} persistent file hashes unchanged`);
  await page.getByRole('button', { name: '笔记库', exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor();
  await page.getByLabel('正文模式').selectOption('edit'); await append('断网关闭重开后继续编辑。');
  assert.ok((await readFile(targetPath, 'utf8')).includes('断网关闭重开后继续编辑。'));
  await resizeWindow(app, page, { width: 760, height: 780 }); await page.getByLabel('正文模式').selectOption('preview');
  await page.locator('.note-preview .math-inline svg').first().waitFor();
  await page.screenshot({ path: path.join(evidence, 'offline-unified-narrow.png') });
  await showNoteList(page);
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('button', { name: '继续阅读', exact: true }).click(); await jump(88);
  await page.screenshot({ path: path.join(evidence, 'offline-textbook.png') });
  await openFromMarker(entry.sourceId);
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false, 'marker reopening the same note must close the narrow list');
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await verifyResources();
  await searchGraphAndVaults(plan);
  assert.equal(await readFile(path.join(importRoot, 'source.json'), 'utf8'), initialSnapshot);
  assert.equal(await disk('手动文件.md'), '# 手动文件\n\n读取不应生成 ID 或历史时间。\n');
  assert.equal(parse(await readFile(targetPath, 'utf8')).data._textbook.ai_source.version, pack.version);
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ executable: process.env.DESKTOP_EXECUTABLE, root, data, checks, requests: Object.fromEntries(hits), count: 971, version: pack.version, archive: 'unpublished', timings, fixture: fixture ?? null, failureRetry: !fixture, sameNamePreserved: true, markerSameNote: true, pathLinkRoundtrip: true, editLivePreview: true, offlineRestart: true, errors, remote }, null, 2));
  console.log(JSON.stringify({ evidence, timings, result: 'passed' }));
} catch (error) {
  console.error(error);
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  console.error('Evidence:', evidence); throw error;
} finally {
  if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); } if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
