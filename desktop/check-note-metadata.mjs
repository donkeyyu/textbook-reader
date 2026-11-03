// Run after npm run desktop:build. Only copied QA resources and a fresh note library are used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { parse } from './format.ts';
import { resizeWindow } from './check-window.mjs';

const project = path.resolve(import.meta.dirname, '..');
const previous = process.env.NOTE_METADATA_FIXTURE || JSON.parse(await readFile(path.join(project, 'output/reader-navigation/result.json'), 'utf8')).fixture;
const fixture = await mkdtemp(path.join(os.tmpdir(), 'textbook-note-metadata-'));
const root = path.join(fixture, '独立笔记库'), data = path.join(fixture, 'app-data');
const evidence = path.join(project, 'output/note-metadata');
await mkdir(data); await mkdir(evidence, { recursive: true });
await cp(path.join(previous, '独立笔记库'), root, { recursive: true });
await cp(path.join(previous, 'app-data/textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true });
const catalog = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/catalog.json'), 'utf8'));
const chapter = catalog.chapters.find((item) => item.start <= 20 && item.end >= 20);
const section = catalog.sections.find((item) => item.chapterId === chapter.id && item.start <= 20 && item.end >= 20);
assert.ok(section, 'fixture needs a known page/section relationship');
const title = 'QA-笔记位置与属性', filename = `${title}.md`, id = randomUUID();
const anchor = { textbook: catalog.textbookId, chapter: chapter.id, section: section.id, pdf_page: 20, rects: [[0.12, 0.25, 0.55, 0.08], [0.12, 0.4, 0.55, 0.07]] };
const initial = `---\n学习状态: 待理解\ntags: [数学, 回顾]\n_textbook:\n  schema_version: 1\n  id: ${id}\n  create_time: "2020-01-01T00:00:00Z"\n  update_time: "2020-01-01T00:00:00Z"\n  anchors: ${JSON.stringify([anchor])}\n---\n这是一篇界面回归笔记，不是教材解释。\n`;
await writeFile(path.join(root, filename), initial);
let app, page;
const errors = [], checks = [], layouts = [];
const disk = () => readFile(path.join(root, filename), 'utf8');
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
async function eventually(read, predicate, message) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await read().catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (value !== undefined && predicate(value)) return value;
    await delay(50);
  }
  assert.fail(message);
}
const mode = (name) => page.getByRole('button', { name, exact: true }).click();
const properties = () => page.getByRole('button', { name: '笔记属性', exact: true });
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
async function jump(number) {
  await page.locator('.page-index').click();
  await page.getByLabel('页码', { exact: true }).fill(String(number));
  await page.getByLabel('页码', { exact: true }).press('Enter');
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction((number) => { const image = document.querySelector(`#page-${number} .page-image`); return image?.complete && image.naturalWidth > 0; }, number);
}
async function draw(number, offset = 0) {
  const selector = page.locator(`#page-${number} .region-selector`);
  await selector.waitFor();
  const bounds = await selector.boundingBox(), reader = await page.getByLabel('教材连续阅读', { exact: true }).boundingBox();
  assert.ok(bounds && reader);
  const x = bounds.x + bounds.width * 0.2;
  const y = Math.max(bounds.y + 30, reader.y + 60) + offset;
  assert.ok(y + 40 < Math.min(bounds.y + bounds.height, reader.y + reader.height), 'drawing area must be visible');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + bounds.width * 0.25, y + 35, { steps: 8 }); await page.mouse.up();
  await selector.waitFor({ state: 'detached' });
}
async function screenshot(name) {
  const layout = await page.evaluate(() => {
    const paper = document.querySelector('.vault-paper');
    const visible = [...paper.querySelectorAll('.note-anchors button,.note-anchors select,.note-properties input,.note-properties select,.vault-note-actions button')].filter((element) => element.getClientRects().length);
    return { viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      paper: { width: paper.clientWidth, scrollWidth: paper.scrollWidth },
      outside: visible.map((element) => ({ label: element.getAttribute('aria-label') || element.textContent, rect: element.getBoundingClientRect().toJSON() })).filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1) };
  });
  assert.ok(layout.document[0] <= layout.viewport[0] + 1, `${name}: document horizontal overflow`);
  assert.ok(layout.paper.scrollWidth <= layout.paper.width + 1, `${name}: note horizontal overflow`);
  assert.deepEqual(layout.outside, [], `${name}: controls outside viewport`);
  layouts.push({ name, ...layout });
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}
try {
  app = await _electron.launch({ args: [project, `--user-data-dir=${data}`], timeout: 30_000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await resizeWindow(app, page, { width: 1440, height: 980 });
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).first().click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  const addBook = page.getByRole('button', { name: '添加到书架', exact: true });
  if (await addBook.isVisible()) await addBook.click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await page.getByRole('button', { name: '笔记列表', exact: true }).click();
  await page.locator('.vault-sidebar nav').getByRole('button', { name: title, exact: true }).click();
  await page.locator('.vault-note-title').filter({ hasText: title }).waitFor();
  await mode('实时预览');
  await page.evaluate(() => { window.qaMetadataEditor = document.querySelector('.cm-editor'); });
  const anchors = page.getByRole('region', { name: '笔记位置', exact: true });
  assert.equal(await anchors.locator('select:visible').count(), 0);
  assert.equal(await anchors.locator('.anchor-preview').count(), 0);
  assert.equal(await page.locator('.note-metadata').getAttribute('open'), null);
  const plain = await page.locator('.vault-paper').innerText();
  for (const internal of [id, '_textbook', 'schema_version', 'create_time', 'update_time']) assert.ok(!plain.includes(internal), `${internal} leaked into normal reading`);
  assert.equal(await disk(), initial, 'opening metadata must not rewrite a note');
  await screenshot('desktop-reading');
  record('default reading shows compact locations without selectors, repeated region previews or internal fields');

  await page.getByRole('button', { name: /^定位位置 1：/ }).click();
  await page.locator('#page-20 .desktop-anchor-boundary').first().waitFor();
  assert.equal(await page.locator('#page-20 .desktop-anchor-boundary').count(), 2);
  await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).click();
  await page.getByLabel('教材框选草稿', { exact: true }).waitFor();
  await draw(20);
  assert.equal(await page.locator('#page-20 .desktop-region').count(), 3);
  await page.getByRole('button', { name: '继续框选原页', exact: true }).click();
  await draw(20, 60);
  assert.equal(await page.locator('#page-20 .desktop-region').count(), 4);
  await page.getByRole('button', { name: '取消框选', exact: true }).click();
  assert.equal(await disk(), initial);
  await anchors.locator('.anchor-add > summary').click();
  await page.getByRole('button', { name: '从教材框选添加', exact: true }).click();
  await page.getByLabel('教材框选草稿', { exact: true }).waitFor();
  await page.getByRole('button', { name: '取消框选', exact: true }).click();
  await anchors.locator('.anchor-add > summary').click();
  assert.equal(await disk(), initial);
  record('location reveals both textbook boundaries; pointer continuation adds two draft regions; cancel preserves the file');

  await anchors.locator('.anchor-add > summary').click();
  await page.getByRole('button', { name: '从教材框选添加', exact: true }).click();
  await draw(20);
  await page.getByRole('button', { name: '继续框选当前页', exact: true }).click();
  await draw(20, 60);
  assert.equal(await page.locator('#page-20 .desktop-region').count(), 2);
  await jump(21);
  await page.getByRole('button', { name: '继续框选当前页', exact: true }).click();
  await draw(21);
  await page.getByRole('button', { name: '添加到当前笔记', exact: true }).click();
  await eventually(disk, (text) => parse(text).data._textbook.anchors.length === 3, 'continued multi-page regions did not save');
  const appended = parse(await disk()).data._textbook.anchors;
  assert.deepEqual(appended[0], anchor, 'adding regions must retain the original anchor');
  assert.deepEqual(appended.map((item) => [item.pdf_page, item.rects.length]), [[20, 2], [20, 2], [21, 1]]);
  for (const index of [3, 2]) {
    await anchors.locator('.anchor-settings > summary').nth(index - 1).click();
    await page.getByRole('button', { name: `移除位置 ${index}`, exact: true }).click();
    await eventually(disk, (text) => parse(text).data._textbook.anchors.length === index - 1, 'removing the QA location did not save');
  }
  assert.deepEqual(parse(await disk()).data._textbook.anchors, [anchor]);
  await anchors.locator('.anchor-add > summary').click();
  await page.getByRole('button', { name: /^定位位置 1：/ }).click();
  record('continued pointer drawing saves same-page and cross-page regions as new anchors while retaining the original');

  await anchors.locator('.anchor-settings > summary').click();
  assert.equal(await anchors.locator('select:visible').count(), 4);
  await page.getByLabel('位置 1 章', { exact: true }).selectOption('');
  await eventually(disk, (text) => parse(text).data._textbook.anchors[0].chapter === undefined, 'chapter removal did not save');
  assert.equal(await page.getByLabel('位置 1 节', { exact: true }).isDisabled(), true);
  let saved = parse(await disk()).data._textbook.anchors[0];
  assert.equal(saved.section, section.id); assert.equal(saved.pdf_page, 20); assert.deepEqual(saved.rects, anchor.rects);
  await page.getByLabel('位置 1 章', { exact: true }).selectOption(chapter.id);
  await eventually(disk, (text) => parse(text).data._textbook.anchors[0].chapter === chapter.id, 'chapter restore did not save');
  await page.getByLabel('位置 1 文件页', { exact: true }).selectOption('');
  await eventually(disk, (text) => parse(text).data._textbook.anchors[0].pdf_page === undefined, 'page removal did not save');
  assert.equal(await page.getByRole('button', { name: /^定位位置 1：/ }).count(), 0);
  saved = parse(await disk()).data._textbook.anchors[0]; assert.deepEqual(saved.rects, anchor.rects);
  await page.getByLabel('位置 1 文件页', { exact: true }).selectOption('20');
  await eventually(disk, (text) => parse(text).data._textbook.anchors[0].pdf_page === 20, 'page restore did not save');
  await screenshot('desktop-location-edit');
  await anchors.locator('.anchor-settings > summary').click();
  record('chapter and page edits save, retain dependent raw values and disable invalid targets until repaired');

  await properties().click();
  await page.getByLabel('属性值 学习状态', { exact: true }).fill('已理解');
  await eventually(disk, (text) => parse(text).data.学习状态 === '已理解', 'user property did not save');
  assert.equal(parse(await disk()).data._textbook.id, id);
  await page.getByLabel('文件头模式', { exact: true }).selectOption('source');
  await eventually(() => editor().innerText(), (text) => text.includes('_textbook'), 'source header did not appear');
  assert.ok(!(await editor().innerText()).includes(id), 'reserved fields should start folded in source mode');
  await properties().click();
  await eventually(() => editor().innerText(), (text) => !text.includes('_textbook'), 'closing properties left the YAML header visible');
  assert.equal(await page.evaluate(() => window.qaMetadataEditor === document.querySelector('.cm-editor')), true);
  await properties().click();
  await page.getByLabel('文件头模式', { exact: true }).selectOption('properties');
  await screenshot('desktop-properties');
  await properties().click();
  await page.getByLabel('笔记信息', { exact: true }).click();
  assert.ok((await page.locator('.note-information-content').innerText()).includes(id));
  await page.getByLabel('笔记信息', { exact: true }).click();
  record('user property saves separately; source toggle and collapse preserve one editor; internal identity is only in explicit note information');

  await mode('只读预览');
  assert.equal(await page.getByRole('button', { name: '编辑位置 1 区域', exact: true }).count(), 0);
  assert.equal(await anchors.locator('.anchor-add').count(), 0);
  await anchors.locator('.anchor-settings > summary').click();
  assert.equal(await anchors.locator('select').count(), 0);
  await anchors.locator('.anchor-settings > summary').click();
  await properties().click();
  assert.equal(await page.getByLabel('属性值 学习状态', { exact: true }).count(), 0);
  await properties().click();
  await mode('实时预览');
  await resizeWindow(app, page, { width: 760, height: 900 });
  await screenshot('narrow-reading');
  await anchors.locator('.anchor-settings > summary').click();
  await properties().click();
  await screenshot('narrow-location-properties');
  assert.deepEqual(errors, []);
  record('read-only mode exposes no mutations; desktop and narrow controls remain inside the note and viewport');
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'passed', fixture, checks, layouts, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', evidence, fixture, checks: checks.length }));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
    await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'failed', fixture, checks, layouts, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
}
