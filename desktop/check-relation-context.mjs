// Run after desktop:build. RELATIONS_FIXTURE points to check-default-relations evidence.
// Copy only its fixture vault/cache. Never alter the supplied evidence or personal data.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { originalLink } from './original-links.ts';

const project = path.resolve(import.meta.dirname, '..');
assert.ok(process.env.RELATIONS_FIXTURE, 'Set RELATIONS_FIXTURE to check-default-relations evidence');
const fixture = path.resolve(process.env.RELATIONS_FIXTURE);
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-relation-context-'));
const root = path.join(evidence, '独立笔记库'), data = path.join(evidence, 'app-data');
const cache = (await readdir(fixture)).find((name) => /^app-data-\d+$/.test(name));
assert.ok(cache, 'Fixture needs a completed local textbook download');
await mkdir(root);
await cp(path.join(fixture, '独立笔记库', '.textbook'), path.join(root, '.textbook'), { recursive: true });
await mkdir(data);
await cp(path.join(fixture, cache, 'textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true });
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const location = pack.source.locations['ch1-source-positive-negative'];
const href = originalLink([{ textbook: pack.textbook, pdf_page: location.page, rects: [[location.region.x, location.region.y, location.region.width, location.region.height]] }]);
const paragraphs = Array.from({ length: 60 }, (_, i) => `第${i}段：长文阅读现场，保存滚动位置与编辑草稿。`).join('\n\n');
const link = `[查阅原文](${href})`;
const disk = `${paragraphs}\n\n${link}\n\n磁盘正文。\n`;
const draft = `---\n坏: [\n---\n${paragraphs}\n\n${link}\n\n未保存长文现场。\n`;
const note = path.join(root, '长文返回.md'); await writeFile(note, disk);
const checks = [], errors = [], remote = [];
let app, page;
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
async function source(text) {
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit');
  await page.getByLabel('文件头模式', { exact: true }).selectOption('source');
  await editor().click(); await editor().press('ControlOrMeta+a'); await page.keyboard.insertText(text);
}
async function loaded(number, boundary = false) {
  await page.getByRole('button', { name: `第 ${number} 页，共 202 页，点击输入页码`, exact: true }).waitFor();
  await page.waitForFunction(({ number, boundary }) => {
    const img = document.querySelector(`#page-${number} .page-image`);
    return img?.complete && img.naturalWidth > 0 && (!boundary || document.querySelector(`#page-${number} .desktop-anchor-boundary`));
  }, { number, boundary });
}
async function openOriginal(mode = 'preview') {
  await page.getByLabel('正文模式', { exact: true }).selectOption(mode);
  const container = mode === 'preview' ? page.getByLabel('笔记只读预览', { exact: true }) : page.locator('.note-rendered-block');
  const entry = container.getByRole('link', { name: '查阅原文', exact: true });
  await entry.hover(); return entry;
}
const scrolls = () => page.locator('.vault-paper,.cm-scroller,.note-preview').evaluateAll((elements) => elements.map((element) => ({ className: element.className, top: element.scrollTop })));
try {
  console.log('Evidence:', evidence);
  app = await _electron.launch({ executablePath: path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [project, `--user-data-dir=${data}`] });
  await app.evaluate(({ session, dialog }, root) => { session.defaultSession.enableNetworkEmulation({ offline: true }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  page = await app.firstWindow(); page.setDefaultTimeout(20_000); await page.setViewportSize({ width: 1440, height: 980 });
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await page.locator('.vault-sidebar nav').getByRole('button', { name: '长文返回', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.note-anchors')?.textContent.includes('目录不可用'));
  await source(draft);
  await page.getByRole('button', { name: '展开教材分屏', exact: true }).click();
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill('88'); await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter'); await loaded(88);
  const textbook = page.getByLabel('教材连续阅读', { exact: true }); await textbook.hover(); await page.mouse.wheel(0, 130);
  // Wait for the reading anchor to follow the real user scroll before hiding it.
  await page.waitForFunction(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const textbookTop = await textbook.evaluate((element) => element.scrollTop);
  await page.getByRole('button', { name: '笔记库', exact: true }).click();
  for (const mode of ['preview', 'live']) {
    const entry = await openOriginal(mode);
    const before = await scrolls(); assert.ok(before.some((item) => item.top > 400), `${mode} must start deep in a long source`);
    await page.screenshot({ path: path.join(evidence, `long-source-${mode}-before.png`) });
    await entry.click(); await loaded(location.page, true);
    await page.getByRole('button', { name: '返回关联来源', exact: true }).click();
    await page.getByRole('separator', { name: '调整笔记与教材面板', exact: true }).waitFor({ state: 'detached' });
    await page.waitForFunction((before) => before.every((item) => Math.abs(document.querySelector('.' + item.className.split(' ').join('.')).scrollTop - item.top) < 2), before);
    const after = await scrolls(); await page.screenshot({ path: path.join(evidence, `long-source-${mode}-return.png`) });
    await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await loaded(88);
    await page.waitForFunction((top) => Math.abs(document.querySelector('.paper-scroller').scrollTop - top) < 2, textbookTop);
    await page.getByLabel('正文模式', { exact: true }).selectOption('preview');
    assert.deepEqual(await page.locator('.note-preview p').allTextContents(), [...paragraphs.split('\n\n'), '查阅原文', '未保存长文现场。']);
    await page.getByLabel('正文模式', { exact: true }).selectOption('edit');
    await editor().press('ControlOrMeta+Home');
    assert.ok((await editor().innerText()).startsWith('---\n坏: [\n---'));
    await editor().press('ControlOrMeta+End');
    assert.ok((await editor().innerText()).includes('未保存长文现场。'));
    assert.equal(await readFile(note, 'utf8'), disk);
    await page.getByRole('button', { name: '笔记库', exact: true }).click();
    checks.push({ mode, before, after, textbookPage: 88, textbookTop, draft: 'unchanged', disk: 'unchanged' });
  }
  for (const [kind, replacement] of [['deleted', '原文链接已移除。'], ['plain', `原文地址：${href}`], ['inline-code', '`' + link + '`'], ['fenced-code', '```md\n' + link + '\n```']]) {
    await source(draft); await (await openOriginal()).click(); await loaded(location.page, true);
    await source(draft.replace(link, replacement));
    await page.waitForFunction(() => !document.querySelector('.desktop-anchor-boundary') && !document.querySelector('[aria-label="关联原文查阅"]'));
    assert.ok((await editor().innerText()).includes('未保存长文现场。')); assert.equal(await readFile(note, 'utf8'), disk);
    checks.push({ staleLink: kind, highlights: 0, source: 'retained', disk: 'unchanged' });
  }
  await page.screenshot({ path: path.join(evidence, 'code-clears-highlight.png') });
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'passed', checks, errors, remote }, null, 2));
  console.log(JSON.stringify({ result: 'passed', evidence, checks }));
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  console.error('Evidence:', evidence); throw error;
} finally { if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }); await app.close(); } }
