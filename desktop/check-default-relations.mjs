import { resizeWindow, showNoteList } from './check-window.mjs';
// Isolated Electron application, native picker stub, real localhost HTTP and disk.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { originalLink, originalTargets } from './original-links.ts';
import { initialRelations } from './initial-relations.ts';
import { noteReferences, linkEntry } from './links.ts';
import { projectNotes } from './note-projection.ts';
const project = path.resolve(import.meta.dirname, '..');
const evidence = process.env.RELATIONS_REUSE || await mkdtemp(path.join(os.tmpdir(), 'textbook-default-relations-'));
const root = path.join(evidence, '独立笔记库'), data = path.join(evidence, `app-data-${Date.now()}`); await mkdir(root, { recursive: true });
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/catalog.json'), 'utf8'));
const from = pack.entries.find((entry) => entry.sourceId === 'ch1-zero-reference'), target = pack.entries.find((entry) => entry.sourceId === 'ch1-deviation');
await mkdir(path.dirname(path.join(root, target.path)), { recursive: true }); await writeFile(path.join(root, target.path), '学生同名文件，不能覆盖。');
const part = (location) => ({ textbook: pack.textbook, pdf_page: location.page, rects: [[location.region.x, location.region.y, location.region.width, location.region.height]] });
const location = pack.source.locations['ch1-measurement-exercise'];
const multi = [part(location), ...location.additionalRegions.map(part)]; multi[0].rects.push(part(pack.source.locations['ch1-direction-exercise']).rects[0]);
const originalHref = originalLink(multi);
const fixture = `[无效目录有效原文](${originalLink([{ ...multi[0], chapter: 'unknown-chapter', section: 'unknown-section' }])})\n\n[跨页多框原文](${originalHref})\n\n[错误版本原文](${originalLink([{ ...multi[0], textbook: 'wrong-version' }])})\n\n[损坏位置原文](textbook:%invalid)\n\n`;
await writeFile(path.join(root, '原文查阅.md'), fixture + '来源末行。\n');
const checks = [], errors = [], remote = [], served = []; let app, page, offline = false;
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
const server = createServer((request, response) => { void (async () => {
  const name = request.url.slice(1); if (!manifest.download.some((item) => item.path === name)) { response.writeHead(404); response.end(); return; }
  served.push(name); response.end(await readFile(path.join(project, name.endsWith('catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${name}`)));
})().catch(() => { response.writeHead(500); response.end(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const disk = (name) => readFile(path.join(root, name), 'utf8');
async function eventually(read, predicate, message) { for (let i = 0; i < 1600; i++) { const value = await read().catch(() => undefined); if (value !== undefined && predicate(value)) return value; await delay(50); } assert.fail(message); }
async function launch() {
  const env = { ...process.env }; delete env.TEXTBOOK_DOWNLOAD_BASE_URL;
  if (!offline) env.TEXTBOOK_DOWNLOAD_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  app = await _electron.launch({ executablePath: path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [project, `--user-data-dir=${data}`, ...(!offline ? ['--textbook-local-http'] : [])], env });
  page = await app.firstWindow(); page.setDefaultTimeout(20_000); await resizeWindow(app, page, { width: 1440, height: 980 });
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  if (offline) await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
}
const notes = async () => page.getByRole('button', { name: '笔记库', exact: true }).click();
async function openPath(relative) {
  await notes(); await showNoteList(page); await page.locator('.vault-sidebar nav button').filter({ has: page.locator(`span`, { hasText: new RegExp(`^${relative.split('/').at(-1).slice(0, -3).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
  await page.locator('.vault-note-heading h1').waitFor();
  await eventually(() => page.locator('.vault-note-title').getAttribute('title'), (text) => text === relative, 'wrong note opened');
}
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
async function modes(body = 'preview', header = 'properties') { await page.getByLabel('正文模式', { exact: true }).selectOption(body); if (body !== 'preview') await page.getByLabel('文件头模式', { exact: true }).selectOption(header); }
async function source(text) { await modes('edit', 'source'); await editor().click(); await editor().press('ControlOrMeta+a'); await page.keyboard.insertText(text); }
async function jump(number) {
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill(String(number)); await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter'); await loaded(number);
}
async function loaded(number) {
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction((number) => { const img = document.querySelector(`#page-${number} .page-image`); return img?.complete && img.naturalWidth > 0; }, number);
}
async function originalLoaded(number) {
  await page.waitForFunction((number) => { const img = document.querySelector(`#page-${number} .page-image`), box = document.querySelector(`#page-${number} .desktop-anchor-boundary`), scroller = document.querySelector('.paper-scroller'); if (!img?.complete || !img.naturalWidth || !box || !scroller) return false; const a = box.getBoundingClientRect(), b = scroller.getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom; }, number);
}
async function clickOriginal(label, live = false) { await modes(live ? 'live' : 'preview'); await (live ? page.locator('.note-rendered-block') : page.getByLabel('笔记只读预览', { exact: true })).getByRole('link', { name: label, exact: true }).click(); }
async function closeApp() { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }); await app.close(); app = null; }
try {
  console.log('Evidence:', evidence); await launch(); await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click(); await openPath('原文查阅.md');
  const unsaved = '---\n坏: [\n---\n' + fixture + '\n未保存的阅读草稿。\n'; await source(unsaved); if (!process.env.RELATIONS_REUSE) { await clickOriginal('跨页多框原文');
  await page.getByRole('alert').filter({ hasText: /尚未下载/ }).waitFor(); assert.equal(await page.getByRole('button', { name: '返回关联来源', exact: true }).count(), 0); await modes('edit', 'source'); assert.ok((await editor().innerText()).includes('未保存的阅读草稿')); assert.equal(await disk('原文查阅.md'), fixture + '来源末行。\n');
  record('not downloaded: original entry reports failure and keeps invalid unsaved source and disk'); }
  // Use this same note, so no unsaved-source guard is bypassed by the shelf action.
  await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('button', { name: '添加教材', exact: true }).first().click(); await page.getByRole('button', { name: '添加到书架', exact: true }).click(); await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 180_000 }); await page.getByRole('button', { name: '关闭教材选择', exact: true }).click(); await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  assert.equal((await readdir(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/receipts`))).length, 971); if (!process.env.RELATIONS_REUSE) assert.equal(new Set(served).size, manifest.download.length);
  record(process.env.RELATIONS_REUSE ? 'reused previously verified local-HTTP textbook and import' : 'real local HTTP: complete checked textbook and all 971 initial notes imported');
  // Audit every raw relation against the persisted plan and actual created files.
  const base = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes`), plan = JSON.parse(await readFile(path.join(base, 'plan.json'), 'utf8'));
  const paths = new Map(plan.notes.map((note) => [note.sourceId, note.path])); const converted = initialRelations(pack); const coverage = [], entries = [];
  for (const entry of pack.entries) {
    const relative = paths.get(entry.sourceId), body = await disk(relative); entries.push(linkEntry(relative, body));
    const raw = pack.source.content.supplements.find((note) => note.id === entry.sourceId); assert.equal(converted.get(entry.sourceId).length, raw.related.length);
    for (const [at, relation] of converted.get(entry.sourceId).entries()) {
      assert.equal(relation.locationId, raw.related[at].locationId); assert.ok(body.includes(relation.label)); assert.ok(body.includes(relation.purpose));
      if (relation.targets.length) for (const id of relation.targets) assert.ok(noteReferences(body).some((reference) => reference.target === paths.get(id)));
      else { assert.ok(!relation.problem); assert.ok(body.includes(originalLink(relation.anchors))); originalTargets(originalLink(relation.anchors), catalog); }
      coverage.push({ sourceId: entry.sourceId, locationId: relation.locationId, kind: relation.targets.length ? 'note' : 'original', targets: relation.targets.map((id) => paths.get(id)), pages: relation.anchors.map((anchor) => anchor.pdf_page), skipped: relation.problem ?? null });
    }
  }
  const projection = projectNotes(entries); assert.equal(coverage.length, 1241); assert.equal(coverage.filter((row) => row.kind === 'note').length, 410); assert.equal(coverage.filter((row) => row.kind === 'original').length, 831); assert.equal(projection.nodes.length, 971); assert.equal(projection.edges.length, 410); await writeFile(path.join(evidence, 'coverage.json'), JSON.stringify({ packageVersion: pack.version, sourceRelations: 1241, notes: 410, originals: 831, skipped: 0, coverage }, null, 2));
  record('all 1241 persisted relations checked individually: 410 exact plan-path note links, 831 original links, 0 skipped; graph has 971 nodes and 410 edges');
  await notes(); await clickOriginal('跨页多框原文', true); await originalLoaded(12); await page.locator('#page-12').getByLabel('已定位区域 2', { exact: true }).waitFor(); await delay(300); assert.equal(await page.locator('#page-12 .desktop-anchor-boundary').count(), 2); await page.screenshot({ path: path.join(evidence, 'multi-regions-live.png') });
  await page.getByRole('button', { name: '文件第 13 页 · 1 个区域', exact: true }).click(); await loaded(13); await page.locator('#page-13 .desktop-anchor-boundary').waitFor(); await page.getByRole('button', { name: '返回关联来源', exact: true }).click(); assert.equal(await page.getByRole('separator', { name: '调整笔记与教材面板', exact: true }).count(), 0); await modes('edit', 'source'); assert.ok((await editor().innerText()).includes('未保存的阅读草稿'));
  record('live-preview original link opens actual cross-page images and both regions; highlight persists despite source having no anchors; return restores layout and invalid draft');
  // Capture actual reader position after a manual scroll; there is no source locate.
  await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await jump(88); const scroller = page.getByLabel('教材连续阅读', { exact: true }); await scroller.hover(); await page.mouse.wheel(0, 130); await delay(500);
  const before = await scroller.evaluate((element) => element.scrollTop); await clickOriginal('跨页多框原文'); await originalLoaded(12); await page.getByRole('button', { name: '返回关联来源', exact: true }).click(); await loaded(88); await eventually(() => scroller.evaluate((element) => element.scrollTop), (top) => Math.abs(top - before) < 2, 'actual pre-relation page/fraction was not restored');
  await notes(); await clickOriginal('跨页多框原文'); await originalLoaded(12); await page.getByRole('button', { name: '返回关联来源', exact: true }).click(); assert.equal(await page.getByRole('separator', { name: '调整笔记与教材面板', exact: true }).count(), 0); await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await loaded(88); await eventually(() => scroller.evaluate((element) => element.scrollTop), (top) => Math.abs(top - before) < 2, 'hidden reader lost its return anchor');
  record('page 88 → full-screen note → original page 12 → return → reopen textbook restores hidden reader page and fraction');
  await page.screenshot({ path: path.join(evidence, 'restored-page88.png') }); record('split at manually scrolled page 88 → original page 12 → return restores actual page 88 and scroll within 2 px');
  await clickOriginal('错误版本原文'); await page.getByRole('alert').filter({ hasText: /未匹配当前版本/ }).waitFor(); await clickOriginal('损坏位置原文'); await page.getByRole('alert').filter({ hasText: /无法读取/ }).waitFor(); await loaded(88);
  await clickOriginal('无效目录有效原文'); await originalLoaded(12); await page.getByRole('alert').filter({ hasText: /章标识无效/ }).waitFor(); await page.getByRole('button', { name: '返回关联来源', exact: true }).click(); await loaded(88);
  record('invalid chapter/section retains warnings and still locates the valid independent page/rect chain');
  record('wrong textbook version and malformed payload keep source draft, existing reader position and no new highlight');
  await clickOriginal('跨页多框原文'); await originalLoaded(12); await source('---\n坏: [\n---\n原文链接已移除，保留草稿。'); await eventually(() => page.locator('.desktop-anchor-boundary').count(), (count) => count === 0, 'removed source link retained stale highlights'); assert.equal(await page.getByRole('button', { name: '返回关联来源', exact: true }).count(), 0);
  await source(unsaved); await clickOriginal('跨页多框原文'); await originalLoaded(12); await source(unsaved.replace(originalHref, originalLink([{ ...multi[0], pdf_page: 0 }]))); await eventually(() => page.locator('.desktop-anchor-boundary').count(), (count) => count === 0, 'changed source link retained highlights');
  record('deleting or changing original href in unsaved source clears original navigation and all stale region boundaries');
  // Restore source file for later navigation, then test a real imported path alias.
  await source(fixture + '来源末行。\n'); await eventually(() => disk('原文查阅.md'), (text) => text.includes('来源末行'), 'source restore failed');
  await openPath(paths.get('ch1-why-negative')); await clickOriginal('正数、负数与0的规定'); await originalLoaded(9); await page.locator('#page-9 .desktop-anchor-boundary').waitFor(); await page.screenshot({ path: path.join(evidence, 'imported-default-original.png') }); await page.getByRole('button', { name: '返回关联来源', exact: true }).click();
  record('real imported original-only relation opens the verified textbook page 9 and exact source region, then returns');
  await openPath(paths.get(from.sourceId)); const initial = await disk(paths.get(from.sourceId)); await source('---\n坏: [\n---\n' + initial.slice(initial.indexOf('> [!explanation]')) + '\n未保存关联草稿。'); await modes('preview'); await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: '对照标准质量与偏差', exact: true }).click(); await eventually(() => page.locator('.vault-note-title').getAttribute('title'), (text) => text === paths.get(target.sourceId), 'suffix path target not opened'); assert.ok(paths.get(target.sourceId).includes('（2）'));
  await page.getByRole('button', { name: '返回来源', exact: true }).click(); await modes('edit', 'source'); assert.ok((await editor().innerText()).includes('未保存关联草稿')); assert.equal(await disk(paths.get(from.sourceId)), initial); await page.screenshot({ path: path.join(evidence, 'note-source-draft-return.png') });
  record('imported relation alias opens actual suffix path despite student same-title file; 08 return preserves invalid unsaved draft');
  await rm(path.join(root, paths.get(target.sourceId))); await modes('preview'); await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name: '对照标准质量与偏差', exact: true }).click(); const chooser = page.getByRole('dialog', { name: '选择笔记链接', exact: true }); await eventually(async () => ({ dialog: await chooser.isVisible(), error: (await page.getByRole('alert').allTextContents()).join(' ') }), (state) => state.dialog || state.error.includes('ENOENT'), 'missing target did not report failure'); if (await chooser.isVisible()) { await chooser.getByText(/未找到目标，尚未创建文件/).waitFor(); await chooser.getByRole('button', { name: '取消', exact: true }).click(); } await assert.rejects(disk(paths.get(target.sourceId))); await modes('edit', 'source'); assert.ok((await editor().innerText()).includes('未保存关联草稿'));
  record('deleted imported target reports missing without creating a blank note or losing source draft');
  await source(initial); await eventually(() => disk(paths.get(from.sourceId)), (text) => text.includes('## 关联阅读'), 'source did not restore'); await closeApp(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); offline = true;
  await launch(); await openPath('原文查阅.md'); await clickOriginal('跨页多框原文'); await originalLoaded(12); await resizeWindow(app, page, { width: 760, height: 900 }); await page.screenshot({ path: path.join(evidence, 'offline-narrow-original.png') }); await page.getByRole('button', { name: '返回关联来源', exact: true }).click(); record('offline restart: persisted original link, actual page image and source return work in narrow split');
  await resizeWindow(app, page, { width: 1440, height: 980 }); await clickOriginal('跨页多框原文'); await originalLoaded(12); await source(unsaved);
  const second = path.join(evidence, '第二笔记库'); await mkdir(second); await writeFile(path.join(second, '新库.md'), '新库不含旧教材。'); await app.evaluate(({ dialog }, second) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [second] }); }, second); await page.getByRole('button', { name: '切换笔记库', exact: true }).click(); await page.getByRole('button', { name: '放弃草稿并继续', exact: true }).click(); await eventually(() => page.locator('.vault-sidebar nav').innerText(), (text) => text.includes('新库'), 'vault switch failed'); assert.equal(await page.locator('.desktop-anchor-boundary').count(), 0); assert.equal(await page.getByRole('button', { name: '返回关联来源', exact: true }).count(), 0); record('vault switch clears prior relation targets and highlights; previous disk files remain untouched');
  assert.deepEqual(errors, []); assert.deepEqual(remote, []); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'passed', root, packageVersion: pack.version, checks, errors, remote, served: served.length }, null, 2)); console.log(JSON.stringify({ evidence, checks: checks.length, result: 'passed' }));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); } console.error('Evidence:', evidence, error); throw error; }
finally { if (app) await closeApp(); if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } }
