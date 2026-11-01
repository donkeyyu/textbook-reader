// Isolated Electron UI + real local HTTP. Only native directory selection is
// controlled; all catalog and Markdown handlers use actual files.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { parse } from './format.ts';
const project = path.resolve(import.meta.dirname, '..');
const evidence = process.env.CUSTOM_REUSE || await mkdtemp(path.join(os.tmpdir(), 'textbook-custom-'));
const root = path.join(evidence, '笔记库'), data = path.join(evidence, 'app-data'), other = path.join(evidence, '独立库');
await mkdir(root, { recursive: true }); await mkdir(other, { recursive: true });
const catalog = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'), 'utf8'));
const book = catalog.textbookId, folder = `.textbook/textbooks/${book}`, customFile = path.join(root, folder, 'custom.json');
const anchor = { textbook: book, pdf_page: 20, rects: [[.12, .25, .55, .08]], extra: { keep: true } };
const note = (anchors = [anchor]) => `---\n保留属性: 原值\n_textbook:\n  schema_version: 1\n  anchors: ${JSON.stringify(anchors)}\n---\n两篇笔记复用目录。\n`;
if (!process.env.CUSTOM_REUSE) for (const name of ['甲', '乙']) await writeFile(path.join(root, `${name}.md`), note());
let app, page, retained, retainedSource, offline = false; const checks = [], errors = [], remote = [], requests = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
const server = createServer((request, response) => { void (async () => {
  const relative = request.url.slice(1), entry = manifest.download.find((item) => item.path === relative);
  if (!entry) { response.writeHead(404); response.end(); return; }
  requests.push(relative);
  response.end(await readFile(path.join(project, relative.endsWith('catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${relative}`)));
})().catch(() => { response.writeHead(500); response.end(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function eventually(read, predicate, message) { for (let i = 0; i < 1200; i++) { const result = await read().catch(() => undefined); if (result !== undefined && predicate(result)) return result; await delay(50); } assert.fail(message); }
const disk = (name) => readFile(path.join(root, name), 'utf8');
const custom = async () => JSON.parse(await readFile(customFile, 'utf8'));
const anchors = async (name) => parse(await disk(`${name}.md`)).data._textbook.anchors;
const button = (name) => page.getByRole('button', { name, exact: true });
async function launch() {
  const env = { ...process.env }; delete env.TEXTBOOK_DOWNLOAD_BASE_URL;
  if (!offline) env.TEXTBOOK_DOWNLOAD_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  app = await _electron.launch({ executablePath: path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [project, `--user-data-dir=${data}`, ...(!offline ? ['--textbook-local-http'] : [])], env, timeout: 30_000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  if (offline) await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  await page.setViewportSize({ width: 1380, height: 980 });
}
async function picker(folder) { await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder); }
async function open(name) {
  await button('笔记库').click(); await page.locator('.vault-sidebar nav').getByRole('button', { name, exact: true }).click({ timeout: 60_000 });
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit'); await page.getByLabel('文件头模式', { exact: true }).selectOption('properties');
}
async function manage() { await page.getByRole('button', { name: /^管理自定义目录/ }).click(); await page.getByRole('dialog', { name: '管理自定义目录', exact: true }).waitFor(); await page.getByLabel('自定义目录名称', { exact: true }).waitFor(); }
async function create(title, kind = 'chapter', parent) {
  await page.getByLabel('自定义条目类型', { exact: true }).selectOption(kind);
  if (kind === 'section') await page.getByLabel('自定义节父章', { exact: true }).selectOption(parent);
  await page.getByLabel('自定义目录名称', { exact: true }).fill(title); await button('添加目录条目').click();
  await eventually(custom, (data) => (kind === 'chapter' ? data.chapters : data.sections).some((entry) => entry.title === title && (kind === 'chapter' || entry.chapterId === parent)), 'custom entry did not save');
}
async function selectPosition(chapter, section) {
  const detail = page.locator('.note-anchor').first(); if (!await detail.evaluate((element) => element.open)) await detail.locator('summary').click();
  await page.getByLabel('位置 1 章', { exact: true }).selectOption(chapter);
  if (section) await page.getByLabel('位置 1 节', { exact: true }).selectOption(section);
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
}
async function preview(title) { await button(`删除 ${title}`).first().click(); await page.getByRole('region', { name: '目录删除预览', exact: true }).waitFor(); }
async function finish() { await button('确认删除并处理引用').click(); await page.getByRole('status').filter({ hasText: '目录条目及引用处理已完成。' }).waitFor(); }
try {
  console.log('Evidence:', evidence);
  if (!process.env.CUSTOM_FINISH) {
  await launch(); await picker(root);
  {
    if (process.env.CUSTOM_REUSE) {
      await page.getByRole('button', { name: /^(选择笔记库|切换笔记库)$/, exact: true }).first().click();
    } else await button('选择笔记库').click();
    await open('甲');
    await button('教材书架').click(); await button('添加教材').first().click();
    if (await button('添加到书架').isVisible()) await button('添加到书架').click();
    await button('已添加').waitFor({ timeout: 300_000 });
    await button('关闭教材选择').click(); await button('开始阅读').click();
    if (!process.env.CUSTOM_REUSE) assert.equal(requests.length, manifest.download.length);
    assert.equal((await readdir(path.join(root, folder, 'initial-notes/receipts'))).length, 971);
    record(process.env.CUSTOM_REUSE ? 'reopens prior real HTTP fixture with all resources and 971 notes' : 'actual local HTTP downloads all resources and imports all 971 notes');
  }
  await open('甲'); await manage();
  await create('专题复习'); let current = await custom(); const chapter = current.chapters.find((entry) => entry.title === '专题复习').id;
  await create('复习要点', 'section', chapter); current = await custom(); const section = current.sections.find((entry) => entry.title === '复习要点' && entry.chapterId === chapter).id;
  await create('替代要点', 'section', chapter); const replacement = (await custom()).sections.find((entry) => entry.title === '替代要点').id;
  await create('留存章'); retained = (await custom()).chapters.find((entry) => entry.title === '留存章').id;
  await create('复习要点', 'section', retained);
  const count = (await custom()).chapters.length;
  await page.getByLabel('自定义条目类型', { exact: true }).selectOption('chapter'); await page.getByLabel('自定义目录名称', { exact: true }).fill(catalog.chapters[0].title); await button('添加目录条目').click();
  await page.getByRole('status').filter({ hasText: '同父级已有' }).waitFor(); assert.equal((await custom()).chapters.length, count);
  await page.screenshot({ path: path.join(evidence, 'created-and-reused.png') }); await button('关闭目录管理').click();
  await selectPosition(chapter, section);
  const grouped = await page.getByLabel('位置 1 章', { exact: true }).locator('optgroup').evaluateAll((groups) => groups.map((group) => group.label)); assert.deepEqual(grouped, ['教材索引', '自定义目录']);
  await open('乙'); await selectPosition(chapter, section);
  assert.deepEqual((await anchors('甲'))[0], { ...anchor, chapter, section }); assert.deepEqual((await anchors('乙'))[0], { ...anchor, chapter, section });
  record('UI creates stable chapter/section; two notes share candidates; index name reuses, other parents may reuse labels');
  await manage(); await button('改名 专题复习').click(); await page.getByLabel('自定义目录名称', { exact: true }).fill('专题复习纲要'); await button('保存目录名称').click();
  await eventually(custom, (data) => data.chapters.some((entry) => entry.id === chapter && entry.title === '专题复习纲要'), 'rename failed'); await button('关闭目录管理').click();
  await page.locator('.note-anchor summary').filter({ hasText: '专题复习纲要' }).waitFor(); await open('甲'); await page.locator('.note-anchor summary').filter({ hasText: '专题复习纲要' }).waitFor();
  record('rename keeps stable ID and updates both note summaries');
  await manage(); await preview('复习要点'); await page.getByRole('status').filter({ hasText: '2 篇笔记，2 处引用' }).waitFor();
  const beforeCancel = [await disk('甲.md'), await disk('乙.md'), await readFile(customFile, 'utf8')];
  await button('取消删除').click(); assert.deepEqual([await disk('甲.md'), await disk('乙.md'), await readFile(customFile, 'utf8')], beforeCancel);
  await preview('复习要点'); await page.getByLabel('删除目录引用处理', { exact: true }).selectOption(replacement);
  await page.getByRole('status').filter({ hasText: '2 篇笔记，2 处引用' }).waitFor();
  await page.waitForFunction((replacement) => document.querySelector('[aria-label="删除目录引用处理"]')?.value === replacement && [...document.querySelectorAll('button')].some((button) => button.textContent === '确认删除并处理引用' && !button.disabled), replacement);
  const externalOriginal = await disk('乙.md'); await writeFile(path.join(root, '乙.md'), externalOriginal + '外部追加。');
  await button('确认删除并处理引用').click(); await page.getByRole('alert').filter({ hasText: /部分引用未处理/ }).waitFor();
  assert.equal((await anchors('甲'))[0].section, replacement); assert.equal((await anchors('乙'))[0].section, section); assert.ok((await custom()).sections.some((entry) => entry.id === section));
  await page.screenshot({ path: path.join(evidence, 'partial-failure.png') });
  record('delete preview shows actual two-note/two-anchor count; cancel is inert; external edit gives per-file partial result and retains directory');
  await writeFile(path.join(root, '乙.md'), externalOriginal);
  await button('重试目录删除未完成项').click(); await page.getByRole('status').filter({ hasText: '目录条目及引用处理已完成。' }).waitFor();
  await button('返回目录管理').click(); await preview('专题复习纲要'); await page.getByLabel('删除目录引用处理', { exact: true }).selectOption('@remove'); await finish();
  for (const name of ['甲', '乙']) assert.deepEqual((await anchors(name))[0], anchor);
  await page.screenshot({ path: path.join(evidence, 'delete-complete.png') }); await button('关闭目录管理').click();
  record('retry resolves only uncompleted note; chapter deletion explicitly clears chapter/section and preserves pages/rects/unknown fields');
  // Persistent catalog update: drop one stable ID and reorder the arrays.
  const indexed = catalog.sections[0];
  await selectPosition(indexed.chapterId, indexed.id);
  const updated = structuredClone(catalog); updated.chapters.reverse(); updated.sections = updated.sections.filter((entry) => entry.id !== indexed.id);
  await writeFile(path.join(root, folder, 'catalog.json'), JSON.stringify(updated));
  await page.getByRole('note').filter({ hasText: '节标识无效或不属于所选章' }).waitFor();
  assert.equal((await anchors('甲'))[0].section, indexed.id); assert.ok((await custom()).chapters.some((entry) => entry.id === retained));
  await page.screenshot({ path: path.join(evidence, 'stale-index.png') });
  record('actual persisted catalog reorder/removal keeps stale section ID visible and leaves custom file intact');
  // A future or invalid custom file is visible/read-only, then restores without writes.
  retainedSource = await readFile(customFile, 'utf8');
  for (const raw of [JSON.stringify({ ...JSON.parse(retainedSource), schemaVersion: 2 }), '{ invalid JSON']) {
    await writeFile(customFile, raw); await manage(); await button('重新读取目录').click(); await page.getByRole('alert').filter({ hasText: /自定义目录|JSON/ }).first().waitFor();
    assert.equal(await button('添加目录条目').isDisabled(), true); assert.equal(await readFile(customFile, 'utf8'), raw); await button('关闭目录管理').click();
  }
  await writeFile(customFile, retainedSource); await manage(); await button('重新读取目录').click(); await button('关闭目录管理').click();
  record('newer and malformed custom files stay untouched and disable writes with visible recovery feedback');
  await page.getByLabel('位置 1 章', { exact: true }).selectOption(retained); await page.getByLabel('位置 1 节', { exact: true }).selectOption(''); await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  await button('定位位置 1').click(); await page.getByLabel('已定位区域 1', { exact: true }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('#page-20 .page-image'); return image?.complete && image.naturalWidth > 0; });
  await page.setViewportSize({ width: 760, height: 900 }); await manage();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === '关闭目录管理' && !button.disabled));
  await page.screenshot({ path: path.join(evidence, 'narrow-management.png') });
  const overflow = await page.getByRole('dialog', { name: '管理自定义目录', exact: true }).evaluate((element) => element.scrollWidth > element.clientWidth + 1); assert.equal(overflow, false);
  await button('关闭目录管理').click(); await page.screenshot({ path: path.join(evidence, 'narrow-split-page.png') });
  record('custom classification still opens actual page 20 and original region; narrow split and management remain operable');
  await button('笔记库').click(); await picker(other);
  await mkdir(path.join(other, folder), { recursive: true }); await writeFile(path.join(other, folder, 'catalog.json'), JSON.stringify(catalog)); await writeFile(path.join(other, '隔离.md'), note());
  await button('切换笔记库').click(); await open('隔离'); await manage(); await page.getByText('还没有自定义目录。可添加章，或在已有章下添加节。', { exact: true }).waitFor(); await button('关闭目录管理').click();
  await picker(root); await button('切换笔记库').click(); await open('甲');
  record('switch to another vault has no shared custom candidates; return restores original library');
  await app.close(); app = undefined; offline = true; await new Promise((resolve) => server.close(resolve));
  } else {
    offline = true; await new Promise((resolve) => server.close(resolve));
    retainedSource = await readFile(customFile, 'utf8'); retained = (await custom()).chapters.find((entry) => entry.title === '留存章').id;
    checks.push(...(await readFile(path.join(evidence, 'first-pass.log'), 'utf8')).split('\n').filter((line) => line.startsWith('PASS ')).map((line) => line.slice(5)));
  }
  await launch(); await open('甲');
  const detail = page.locator('.note-anchor').first(); if (!await detail.evaluate((element) => element.open)) await detail.locator('summary').click();
  await page.getByLabel('位置 1 章', { exact: true }).locator(`option[value="${retained}"]`).waitFor({ state: 'attached' });
  await manage(); await page.getByRole('button', { name: '改名 留存章', exact: true }).waitFor(); await button('关闭目录管理').click();
  await button('定位位置 1').click(); await page.getByLabel('已定位区域 1', { exact: true }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('#page-20 .page-image'); return image?.complete && image.naturalWidth > 0; });
  await page.screenshot({ path: path.join(evidence, 'offline-reopened.png') });
  assert.equal(await readFile(customFile, 'utf8'), retainedSource); assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  record('offline process restart retains shared custom data and opens verified page/region with zero network or renderer errors');
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ checks, errors, remote, requests: requests.length, root, data, evidence }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, errors, remote }));
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => '')); }
  console.error('Evidence:', evidence); throw error;
} finally { if (app) await app.close(); if (server.listening) await new Promise((resolve) => server.close(resolve)); }
