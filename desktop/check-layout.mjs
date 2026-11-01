import { resizeWindow, showNoteList } from './check-window.mjs';
// Real Electron layout and interaction checks. Only the native folder picker is controlled.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const project = path.resolve(import.meta.dirname, '..');
const fixture = process.env.LAYOUT_FIXTURE;
assert.ok(fixture, 'Set LAYOUT_FIXTURE to an existing relation-context QA evidence directory; it is copied, never edited.');
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-layout-')));
console.log('Evidence:', evidence);
const root = path.join(evidence, '笔记库'), data = path.join(evidence, 'app-data');
await mkdir(root); await mkdir(data);
await cp(path.join(fixture, '独立笔记库/.textbook'), path.join(root, '.textbook'), { recursive: true });
await cp(path.join(fixture, 'app-data/textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true });
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const body = Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段。长文阅读与窗口边界检查。内容应当可以滚动、编辑和保存。`).join('\n\n');
const text = `---\ntags: [数学, 边界检查]\n学习状态: 正在理解\n相关: "[[目标|属性链接]]"\n_textbook:\n  schema_version: 1\n  anchors: [{textbook: ${pack.textbook}, pdf_page: 20, rects: [[0.12, 0.25, 0.55, 0.08]]}]\n---\n${body}\n\n[[目标|正文链接]]\n`;
await writeFile(path.join(root, '长文.md'), text); await writeFile(path.join(root, '目标.md'), '目标正文。');
for (let i = 0; i < 25; i++) await writeFile(path.join(root, `搜索 ${i}.md`), '搜索边界样本。');
const result = { evidence, executable: process.env.DESKTOP_EXECUTABLE ?? 'development Electron + built app', checks: [], errors: [], remote: [] };
let app, page;
async function capture(name) {
  if (!name.includes('dialog')) await page.locator('.vault-paper').evaluate((element) => { element.scrollTop = 0; });
  const measure = await page.evaluate(() => {
    const box = (e) => {
      const r = e.getBoundingClientRect(); let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
      if (!e.matches('dialog[open]')) for (let parent = e.parentElement; parent; parent = parent.parentElement) if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowY)) { const p = parent.getBoundingClientRect(); top = Math.max(top, p.top); bottom = Math.min(bottom, p.bottom); }
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, visibleHeight: Math.max(0, bottom - top), client: [e.clientWidth, e.clientHeight], scroll: [e.scrollWidth, e.scrollHeight] };
    };
    const selectors = ['.desktop-workspace', '.desktop-workspace-body', '.vault-app', '.vault-paper', '.note-document', '.cm-scroller', '.note-preview', '.note-search-panel', 'dialog[open]'];
    const containers = Object.fromEntries(selectors.map((s) => [s, [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).map(box)]));
    const outside = [...document.querySelectorAll('.desktop-workspace-tabs button,.vault-toolbar > button,.vault-toolbar .note-search > button,.vault-note-heading,.vault-problems,.note-modes,.note-metadata > summary,.note-search-panel,dialog[open]')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none').map((e) => ({ name: e.textContent, ...box(e) })).filter((r) => r.x < -1 || r.right > innerWidth + 1 || r.y < -1 || r.bottom > innerHeight + 1);
    return { viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], containers, outside };
  });
  await page.screenshot({ path: path.join(evidence, `${name}.png`) }); result.checks.push({ name, ...measure });
  console.log(name, JSON.stringify(measure));
}
try {
  const exe = process.env.DESKTOP_EXECUTABLE;
  app = await _electron.launch({ ...(exe ? { executablePath: exe } : {}), args: [...(exe ? [] : [project]), `--user-data-dir=${data}`], timeout: 30000 });
  await app.evaluate(({ session, dialog }, root) => { session.defaultSession.enableNetworkEmulation({ offline: true }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => result.errors.push(error.message)); page.on('request', (r) => { if (/^https?:/.test(r.url())) result.remote.push(r.url()); });
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await page.getByRole('button', { name: '长文', exact: true }).click();
  await page.getByLabel('正文模式', { exact: true }).selectOption('live'); await page.getByLabel('文件头模式', { exact: true }).selectOption('properties');
  for (const [name, width, height] of [['normal', 1100, 780], ['minimum', 720, 480]]) {
    await resizeWindow(app, page, { width, height }, true);
    await capture(name);
  }
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false);
  await showNoteList(page);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-current') === 'page');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '笔记列表', exact: true }).evaluate((e) => e === document.activeElement), true);
  await showNoteList(page); await page.getByRole('button', { name: '目标', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('.vault-note-heading h1'));
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false);
  await showNoteList(page); await page.getByRole('button', { name: '长文', exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: '长文' }).waitFor();
  await showNoteList(page);
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click(); await page.getByLabel('搜索本地笔记', { exact: true }).fill('目标');
  await page.getByLabel('本地搜索结果', { exact: true }).getByRole('button').first().click();
  await page.locator('.vault-note-heading h1').filter({ hasText: '目标' }).waitFor();
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false, 'successful search navigation must close the narrow list');
  await showNoteList(page); await page.getByRole('button', { name: '搜索笔记', exact: true }).click();
  await page.getByLabel('本地搜索结果', { exact: true }).getByRole('button').first().click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.vault-sidebar')).display === 'none');
  await showNoteList(page); await page.getByRole('button', { name: '知识图', exact: true }).click();
  await page.locator('.note-graph canvas').waitFor();
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false, 'entering graph must close the narrow list');
  await page.getByRole('button', { name: '返回笔记', exact: true }).click();
  await showNoteList(page); await page.getByRole('button', { name: '长文', exact: true }).click();
  await page.locator('.vault-note-heading h1').filter({ hasText: '长文' }).waitFor();
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click(); await page.getByLabel('搜索本地笔记', { exact: true }).fill('搜索边界');
  await page.getByLabel('本地搜索结果', { exact: true }).getByRole('button').first().waitFor(); await capture('minimum-search'); await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  if (await page.getByRole('button', { name: '改名或移动', exact: true }).isHidden()) await page.locator('.note-move-actions > summary').click();
  await page.getByRole('button', { name: '改名或移动', exact: true }).click(); await page.getByRole('dialog', { name: '改名与移动笔记', exact: true }).waitFor(); await capture('minimum-dialog');
  await page.getByRole('dialog', { name: '改名与移动笔记', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  if (await page.locator('.note-move-actions').getAttribute('open') !== null) await page.locator('.note-move-actions > summary').click();
  await resizeWindow(app, page, { width: 1100, height: 780 }, true);
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit'); await page.getByLabel('文件头模式', { exact: true }).selectOption('source');
  const beforeInvalid = await readFile(path.join(root, '长文.md'), 'utf8');
  const editor = page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
  await editor.click(); await editor.press('ControlOrMeta+a'); await page.keyboard.insertText('---\n坏: [\n---\n' + body);
  await resizeWindow(app, page, { width: 720, height: 480 }, true);
  await capture('minimum-invalid-yaml');
  await showNoteList(page); await page.getByRole('button', { name: '目标', exact: true }).click();
  const guard = page.getByRole('dialog').filter({ hasText: '还有未保存的草稿' }); await guard.waitFor();
  await guard.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok((await page.locator('.vault-problems').innerText()).includes('YAML 第'));
  assert.equal(await readFile(path.join(root, '长文.md'), 'utf8'), beforeInvalid);
  assert.equal(await page.locator('.vault-note-heading h1').innerText(), '长文');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.vault-sidebar').isVisible(), false);
  await page.getByRole('button', { name: '展开教材分屏', exact: true }).click(); await capture('minimum-split-invalid');
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click(); await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).or(page.getByRole('alert').filter({ hasText: /无法|失败|ERROR|不匹配/ })).first().waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('button', { name: '已添加', exact: true }).isVisible(), true, await page.locator('body').innerText()); await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await page.locator('.page-index').click(); await page.getByLabel('页码', { exact: true }).fill('20'); await page.getByLabel('页码', { exact: true }).press('Enter');
  await page.waitForFunction(() => { const img = document.querySelector('#page-20 .page-image'); return img?.complete && img.naturalWidth > 0; });
  async function jumpToPage() {
    await page.locator('.page-index').click(); await page.getByLabel('页码', { exact: true }).fill('20'); await page.getByLabel('页码', { exact: true }).press('Enter');
    await page.waitForFunction(() => { const img = document.querySelector('#page-20 .page-image'); return img?.complete && img.naturalWidth > 0; });
  }
  const fraction = () => page.locator('#page-20').evaluate((e) => { const r = e.getBoundingClientRect(), p = document.querySelector('.paper-scroller').getBoundingClientRect(); return (p.top - r.top) / r.height; });
  const splitter = page.getByRole('separator', { name: '调整笔记与教材面板', exact: true });
  async function dragLimit(maximum) {
    const before = await fraction(), bounds = await splitter.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(maximum ? await page.evaluate(() => innerWidth - 1) : 1, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
    const limit = Number(await splitter.getAttribute(maximum ? 'aria-valuemax' : 'aria-valuemin'));
    assert.equal(Number(await splitter.getAttribute('aria-valuenow')), limit, 'pointer drag did not honor its width limit');
    assert.ok(Math.abs(await fraction() - before) < .05, 'splitter drag lost the actual reader position');
  }
  async function checkWindow(name, width, height) {
    await resizeWindow(app, page, { width, height }, true);
    assert.equal(await splitter.getAttribute('aria-orientation'), 'vertical');
    assert.equal(await page.locator('.desktop-workspace-body').evaluate((e) => getComputedStyle(e).flexDirection), 'row');
    await jumpToPage();
    await capture(`${name}-default`);
    await dragLimit(false); await capture(`${name}-minimum-share`);
    await editor.click(); await editor.press('ControlOrMeta+End'); await page.keyboard.insertText(`边界草稿：${name}。`);
    assert.ok((await editor.innerText()).includes(`边界草稿：${name}。`));
    await dragLimit(true); await capture(`${name}-maximum-share`);
    await splitter.focus(); await page.keyboard.press('ArrowLeft');
    let share = Number(await splitter.getAttribute('aria-valuenow'));
    assert.ok(share >= Number(await splitter.getAttribute('aria-valuemin')));
    await page.keyboard.press('ArrowRight');
    share = Number(await splitter.getAttribute('aria-valuenow'));
    assert.ok(share <= Number(await splitter.getAttribute('aria-valuemax')));
  }
  await checkWindow('minimum-real-page', 720, 480);
  await checkWindow('breakpoint-real-page', 760, 640);
  // The selected ratio must be clamped again when the actual OS window shrinks.
  const beforeNativeShrink = await fraction();
  await resizeWindow(app, page, { width: 720, height: 480 }, true);
  await page.waitForFunction(() => document.querySelector('.desktop-workspace-resize')?.getAttribute('aria-valuenow') === '50');
  assert.ok(Math.abs(await fraction() - beforeNativeShrink) < .05, 'native window shrink lost reader position');
  await capture('minimum-after-native-shrink');
  await checkWindow('tall-narrow-real-page', 760, 780);
  await editor.click(); await editor.press('ControlOrMeta+End'); await page.keyboard.insertText('窄窗分屏草稿。');
  assert.ok((await editor.innerText()).includes('窄窗分屏草稿。'));
  assert.equal(await readFile(path.join(root, '长文.md'), 'utf8'), beforeInvalid);
  await checkWindow('wide-real-page', 1100, 780);
  assert.deepEqual(result.errors, []); assert.deepEqual(result.remote, []);
  for (const check of result.checks) {
    assert.equal(check.document[0] <= check.viewport[0], true, `${check.name}: document width`);
    assert.equal(check.document[1] <= check.viewport[1] + 1, true, `${check.name}: document height`);
    assert.deepEqual(check.outside, [], `${check.name}: controls outside app window`);
    if (check.name.includes('dialog')) assert.equal(check.containers['dialog[open]'].every((r) => r.visibleHeight === r.height), true, 'dialog exceeds window');
    for (const bounds of check.containers['.vault-app']) assert.ok(bounds.bottom <= check.viewport[1] + 1, `${check.name}: note app exceeds window`);
    const paper = check.containers['.vault-paper'][0];
    for (const selector of ['.note-document', '.cm-scroller', '.note-preview']) for (const bounds of check.containers[selector]) assert.ok(bounds.bottom <= paper.bottom + 1, `${check.name}: ${selector} exceeds its paper`);
    if (!check.name.includes('dialog')) for (const bounds of check.containers['.cm-scroller']) assert.ok(bounds.visibleHeight >= 80, `${check.name}: visible editor has less than 80px (${bounds.visibleHeight})`);
  }
  result.result = 'passed';
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => ''));
  throw error;
} finally {
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  await app?.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app?.close();
}
