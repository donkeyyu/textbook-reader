// Real Electron UI + filesystem regression. Only the native picker is stubbed;
// OS dialogs and Windows runtime verification stay with tickets 15 and 13.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-links-check-'));
const root = path.join(evidence, '中文 笔记库'), userData = path.join(evidence, 'app-data');
await mkdir(root); await mkdir(path.join(root, '七年级')); await mkdir(path.join(root, '八年级'));
const book = JSON.parse(await readFile(path.join(project, 'src/textbook/book.json'), 'utf8'));
const original = '---\n用户链接: "[[中文 空格|属性别名]]"\n列表: ["[[中文 空格]]"]\n_textbook:\n  schema_version: 1\n  id: source-note\n---\n# 来源正文\n\n[[中文 空格|唯一入口]]\n\n[[相反数|重名入口]]\n\n[[未找到|缺失入口]]\n\n`[[代码目标]]` 和 \\[[转义目标]] 和 [[中文 空格#标题]]。\n\n最后一行。\n';
const target = '没有 ID 的手动文件，打开不能修改。';
const fixture = {
  '来源.md': original, '中文 空格.md': target, '草稿目标.md': '草稿不应产生引用。',
  '七年级/相反数.md': `---\n_textbook:\n  anchors: [{textbook: ${book.documentSha256}, chapter: chapter-1, pdf_page: 20}]\n---\n数轴上方向相反的两个数。`,
  '八年级/相反数.md': '用字母表示相反数。',
  '重复.md': '---\n属性引用: "[[相反数|同名入口]]"\n---\n[[相反数|同名入口]]\n\n[[相反数|同名入口]]\n\n> [!hint] 提示\n> [[相反数|同名入口]]\n',
  'Case.md': '区分大小写。', 'a#b[d].md': '语法字符文件名。',
};
for (const [name, source] of Object.entries(fixture)) await writeFile(path.join(root, name), source);
const disk = (name = '来源.md') => readFile(path.join(root, name), 'utf8');
const checks = [], pageErrors = [], outbound = [];
const record = (check) => { checks.push(check); console.log(`PASS ${check}`); };
let instance, page;
async function eventually(read, predicate, message) {
  for (let n = 0; n < 160; n++) { const value = await read().catch(() => undefined); if (value !== undefined && predicate(value)) return value; await delay(50); }
  assert.fail(message);
}
async function launch() {
  instance = await _electron.launch({ ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE } : {}), args: [...(process.env.DESKTOP_EXECUTABLE ? [] : [project]), `--user-data-dir=${userData}`] });
  instance.process().stderr.on('data', (bytes) => { if (bytes.toString().includes('无法启动')) console.error(bytes.toString()); });
  await instance.evaluate(({ dialog }) => { dialog.showErrorBox = (title, message) => console.error(title, message); });
  page = await instance.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.context().setOffline(true);
  await page.route(/https?:\/\//, (route) => { outbound.push(route.request().url()); return route.abort(); });
}
const modes = async (body, header) => {
  await page.getByRole('combobox', { name: '正文模式', exact: true }).selectOption(body);
  if (header) await page.getByRole('combobox', { name: '文件头模式', exact: true }).selectOption(header);
};
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
async function source(text) {
  await modes('edit', 'source'); await editor().click(); await editor().press('ControlOrMeta+a'); await page.keyboard.insertText(text);
}
async function open(name) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}
async function previewLink(name) {
  await modes('preview'); await page.getByLabel('笔记只读预览', { exact: true }).getByRole('link', { name, exact: true }).click();
}
async function back() {
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  await eventually(() => page.getByRole('combobox', { name: '正文模式', exact: true }).isEnabled(), Boolean, 'navigation remained busy');
}
async function saved(predicate, name = '来源.md') { await eventually(() => disk(name), predicate, 'source did not save'); await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor(); }
try {
  await launch();
  await instance.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
  await open('来源');
  assert.equal(await disk(), original);
  // Real click on a rendered live-preview link, then return to its source.
  await page.locator('.note-rendered-block').getByRole('link', { name: '唯一入口', exact: true }).click();
  await page.getByRole('heading', { name: '中文 空格', exact: true }).waitFor();
  assert.equal(await disk('中文 空格.md'), target);
  await page.getByText('关联与反向引用', { exact: false }).click();
  const incoming = () => page.getByLabel('已保存的反向引用', { exact: true });
  await incoming().getByRole('button').filter({ hasText: '来源' }).getByText('3 处引用', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'live-navigation-backlinks.png') });
  await back();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '正文模式', exact: true }).inputValue(), 'live');
  record('offline live-link click; manual target without ID untouched; body/list/property links deduplicated into one backlink; return restores mode');

  await previewLink('重名入口');
  const dialog = page.getByRole('dialog', { name: '选择笔记链接', exact: true });
  await dialog.getByRole('heading', { name: '同名笔记，请选择目标', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button').filter({ hasText: '七年级/相反数' }).count(), 1);
  await dialog.getByText(/数学 · 七年级上册 · 人教版 · 2024 年审定.*文件第 20 页/).waitFor();
  await dialog.getByText('用字母表示相反数。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'ambiguous-readonly.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await modes('edit', 'properties');
  await page.getByText('关联与反向引用', { exact: false }).click();
  await page.getByRole('button', { name: '修复链接 2', exact: true }).click();
  await dialog.getByRole('textbox', { name: '链接显示别名', exact: true }).fill('保留别名');
  await dialog.getByRole('button').filter({ hasText: '七年级/相反数' }).click();
  await saved((text) => text.includes('[[七年级/相反数.md|保留别名]]'));
  await previewLink('保留别名');
  await page.getByRole('heading', { name: '七年级/相反数', exact: true }).waitFor();
  await back();
  record('ambiguous names never guess; candidate path + existing anchor + summary; selected target saved as explicit path and alias, then opened');

  await open('重复'); await modes('live', 'properties');
  const repeatedLinks = page.locator('.note-rendered-block').getByRole('link', { name: '同名入口', exact: true });
  await repeatedLinks.nth(1).click();
  await dialog.getByRole('button').filter({ hasText: '七年级/相反数' }).click();
  await saved((text) => text.includes('[[相反数|同名入口]]\n\n[[七年级/相反数.md|同名入口]]'), '重复.md');
  assert.ok((await disk('重复.md')).includes('属性引用: "[[相反数|同名入口]]"'));
  await repeatedLinks.nth(2).click();
  await dialog.getByRole('button').filter({ hasText: '八年级/相反数' }).click();
  await saved((text) => text.includes('> [[八年级/相反数.md|同名入口]]'), '重复.md');
  await page.getByText('关联与反向引用', { exact: false }).click();
  await page.locator('.note-link-row').filter({ hasText: '属性 属性引用' }).getByRole('button').first().click();
  await dialog.getByRole('button').filter({ hasText: '七年级/相反数' }).click();
  await saved((text) => text.includes('属性引用: "[[七年级/相反数.md|同名入口]]"'), '重复.md');
  assert.ok((await disk('重复.md')).includes('---\n[[相反数|同名入口]]'));
  await repeatedLinks.first().click();
  const externalRepeated = `${await disk('重复.md')}\n外部变更候选期间。\n`;
  await writeFile(path.join(root, '重复.md'), externalRepeated);
  await eventually(() => dialog.isVisible(), (visible) => !visible, 'stale picker remained after external reload');
  assert.equal(await disk('重复.md'), externalRepeated);
  record('second identical body link, callout and property reference repair independently; external change closes stale picker without rewriting');
  await open('来源');

  // Auto-completion is driven by native keyboard input, and writes a path.
  await modes('edit', 'properties'); await editor().click(); await editor().press('ControlOrMeta+End');
  await page.keyboard.insertText('\n\n[[');
  await page.getByRole('option').filter({ has: page.locator('.cm-completionLabel', { hasText: /^中文 空格$/ }) }).waitFor();
  await page.keyboard.insertText('a#');
  const option = page.getByRole('option').filter({ hasText: 'a#b[d]' }); await option.waitFor(); await delay(200); await option.click();
  await saved((text) => text.includes('[[a\\#b\\[d\\].md|a\\#b\\[d\\]]]'));
  await previewLink('a#b[d]');
  await page.getByRole('heading', { name: 'a#b[d]', exact: true }).waitFor();
  await back();
  record('typing [[ opens completion; special filename characters escaped; selected escaped path opens through preview');

  const beforeDraft = await disk();
  const invalid = '---\n坏: [\n---\n[[草稿目标|草稿入口]]\n\n未保存现场';
  await source(invalid); await page.getByText(/YAML 第/).first().waitFor();
  await previewLink('草稿入口'); await page.getByRole('heading', { name: '草稿目标', exact: true }).waitFor();
  await page.getByText('关联与反向引用', { exact: false }).click();
  await page.getByLabel('已保存的反向引用', { exact: true }).getByText('尚无已保存的引用。', { exact: true }).waitFor();
  await modes('live', 'properties');
  await back();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '正文模式', exact: true }).inputValue(), 'preview');
  await modes('edit', 'source');
  await editor().press('ArrowLeft'); await page.keyboard.insertText('光标');
  assert.ok((await editor().innerText()).includes('未保存现光标场'));
  await editor().press('ControlOrMeta+z');
  assert.ok((await editor().innerText()).includes('未保存现场'));
  assert.equal(await disk(), beforeDraft);
  await source(`${beforeDraft}\n[[草稿目标|已保存入口]]\n`);
  await saved((text) => text.includes('已保存入口'));
  await previewLink('已保存入口');
  await page.getByText('关联与反向引用', { exact: false }).click();
  await incoming().getByRole('button').filter({ hasText: '来源' }).getByText('1 处引用', { exact: true }).waitFor();
  await back();
  record('invalid YAML draft navigates safely; disk-only backlinks exclude draft then include saved link; return restores source draft/mode/cursor/undo');

  const beforeConflict = await disk();
  await source(invalid); await page.getByText(/YAML 第/).first().waitFor();
  await previewLink('草稿入口'); await page.getByRole('heading', { name: '草稿目标', exact: true }).waitFor();
  await writeFile(path.join(root, '来源.md'), `${beforeConflict}\n外部编辑保留。\n`);
  await back();
  await page.locator('.vault-conflict').waitFor();
  await modes('edit', 'source');
  assert.ok((await editor().innerText()).includes('未保存现场'));
  assert.ok((await disk()).includes('外部编辑保留。'));
  await page.getByRole('button', { name: '采用磁盘版本', exact: true }).click();
  await page.getByRole('button', { name: '保留恢复记录并采用磁盘', exact: true }).click();
  await eventually(() => editor().innerText(), (text) => text.includes('外部编辑保留。') && !text.includes('未保存现场'), 'conflict adoption did not retain disk');
  record('external edit while source draft is parked returns to explicit conflict; recovery protects draft before adopting disk');

  await previewLink('缺失入口');
  await dialog.getByText(/未找到目标，尚未创建文件/).waitFor();
  assert.equal((await readdir(root)).includes('未找到.md'), false);
  assert.equal(await dialog.getByRole('button', { name: /创建/ }).count(), 0, 'preview does not write');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await modes('edit', 'properties'); await editor().click(); await editor().press('ControlOrMeta+End');
  await page.keyboard.insertText('创建前现场'); await saved((text) => text.endsWith('创建前现场'));
  await modes('live', 'properties');
  await page.locator('.note-rendered-block').getByRole('link', { name: '缺失入口', exact: true }).click();
  await dialog.getByRole('button', { name: '创建“未找到.md”草稿', exact: true }).click();
  await page.getByRole('heading', { name: '未找到', exact: true }).waitFor();
  assert.equal((await readdir(root)).includes('未找到.md'), false, 'creation is explicit draft until saved');
  await writeFile(path.join(root, '未找到.md'), '外部同名文件，不能覆盖。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await eventually(() => disk('未找到（2）.md'), (text) => /id: [a-f0-9-]{36}/.test(text), 'new UUID note missing');
  await back();
  await saved((text) => text.includes('[[未找到（2）.md|缺失入口]]'));
  assert.equal(await disk('未找到.md'), '外部同名文件，不能覆盖。');
  await modes('edit', 'properties'); await editor().press('ArrowLeft'); await page.keyboard.insertText('光标');
  await saved((text) => text.endsWith('创建前现光标场'));
  await editor().press('ControlOrMeta+z'); await saved((text) => text.endsWith('创建前现场'));
  await editor().press('ControlOrMeta+z'); await saved((text) => !text.includes('创建前现场') && text.includes('[[未找到（2）.md|缺失入口]]'));
  record('missing target needs explicit create/save; UUID and collision suffix protect external file; exact source link follows the actual created path');

  // External create/delete must update the same persistent index without restarts.
  await writeFile(path.join(root, '外部新增.md'), '[[中文 空格]]');
  await eventually(() => page.getByRole('navigation').getByRole('button', { name: '外部新增', exact: true }).count(), (count) => count === 1, 'external note not discovered');
  await previewLink('唯一入口');
  await page.getByText('关联与反向引用', { exact: false }).click();
  await incoming().getByRole('button').filter({ hasText: '外部新增' }).waitFor();
  await rm(path.join(root, '外部新增.md'));
  await eventually(() => incoming().getByRole('button').filter({ hasText: '外部新增' }).count(), (count) => count === 0, 'deleted backlink remained');
  assert.equal(await disk('中文 空格.md'), target);
  const mtime = (await stat(path.join(root, '中文 空格.md'))).mtimeMs;
  await instance.close(); await launch();
  await page.getByRole('heading', { name: '中文 空格', exact: true }).waitFor();
  await page.getByText('关联与反向引用', { exact: false }).click();
  await incoming().getByRole('button').filter({ hasText: '来源' }).waitFor();
  assert.equal((await stat(path.join(root, '中文 空格.md'))).mtimeMs, mtime);
  record('external create/delete rebuild backlinks; offline restart reconstructs index; reading ID-less target never writes');

  const hideRecoveries = page.getByRole('button', { name: '收起恢复记录', exact: true });
  if (await hideRecoveries.count()) await hideRecoveries.click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 760, height: 700 }));
  await incoming().getByRole('button').filter({ hasText: '来源' }).click();
  await page.getByRole('heading', { name: '来源', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await page.getByRole('heading', { name: '中文 空格', exact: true }).waitFor();
  await page.getByText('关联与反向引用', { exact: false }).click();
  await incoming().getByRole('button').filter({ hasText: '来源' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'narrow-backlinks-offline.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(outbound, []); assert.deepEqual(pageErrors, []);
  record('760px window fits; all operations offline; no renderer exceptions or external requests');
  console.log(JSON.stringify({ result: 'PASS', evidence, root, checks }, null, 2));
} catch (cause) {
  await page?.screenshot({ path: path.join(evidence, 'failed.png') }).catch(() => {});
  console.error(JSON.stringify({ evidence, body: await page?.locator('body').innerText().catch(() => ''), pageErrors }, null, 2)); throw cause;
} finally {
  await instance?.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
  await instance?.close().catch(() => {});
}
