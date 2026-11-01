// Real Electron regression for note modes. The OS picker is covered separately.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { parse } from 'yaml';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-modes-check-'));
const root = path.join(evidence, '库甲'), other = path.join(evidence, '库乙');
const userData = path.join(evidence, 'app-data');
await mkdir(root); await mkdir(other);
await mkdir(path.join(root, '.textbook'));
await writeFile(path.join(root, '.textbook', 'settings.json'), JSON.stringify({ propertyTypes: { unknown: 'future-type' } }));
const fixture = `---
# 保留注释
id: 用户身份
anchors: 用户位置
score: 2
tags: [甲, 乙]
unknown:
  nested: keep
_textbook:
  schema_version: 1
  id: builtin-identity
  create_time: "2026-10-31T14:20:00+08:00"
  update_time: "2026-10-31T14:20:00+08:00"
  anchors:
    - textbook: test-book
      chapter: chapter-one
      section: section-one
      pdf_page: 20
      rects: [[0.1, 0.2, 0.3, 0.4]]
---
# 连续纸面

可原位修改的段落。

> [!explanation] 理解标题
> 理解正文 $x^2 + 1$。

> [!hint]- 折叠提示
> 提示正文。

> [!warning]+ 注意标题
> 注意正文。

> [!personal] 个人标题
> 个人正文。

> [!mystery]- 未知标题
> 未知正文保留。

> [!__proto__] 原型类型
> 保留正文。

- 列表一
- 列表二

[普通链接](https://example.com) 和 [[另一篇]]。

[引用链接][ref]

[ref]: https://example.org/reference

$$\\frac{1}{2} + \\sqrt{4}$$

<script>window.untrustedHtml = true</script>
<img src="https://example.com/tracker" onerror="window.untrustedHtml = true">

最后一行。
` + '\n行内代码 `price $` 后的公式 $x$。\n\n转义美元 \\$5 与公式 $y$。\n\n```text\n$x$ 保持代码文字\n```\n';
await writeFile(path.join(root, '模式.md'), fixture);
await writeFile(path.join(root, '另一篇.md'), '---\nscore: 文本分数\n---\n另一篇正文。\n');
const readonly = '---\nscore: 3\n_textbook:\n  schema_version: 2\n  id: future-identity\n  anchors: [{textbook: future-book, pdf_page: 3}]\n---\n未来格式只读正文。\n';
await writeFile(path.join(root, '只读.md'), readonly);
await writeFile(path.join(root, '注释文件头.md'), '---\n"_textbook": # 内置注释\n  schema_version: 1\n  id: quoted-identity\n  update_time: "2026-10-31T14:20:00+08:00"\n用户字段: keep\n---\n有注释的文件头。\n');
await writeFile(path.join(root, '撤销.md'), '手写笔记原文。');
await writeFile(path.join(root, '隐藏文件头.md'), '---\n用户字段: protected\n_textbook:\n  schema_version: 1\n  id: hidden-header-identity\n---\n只替换正文，保留文件头。');
await writeFile(path.join(other, '乙笔记.md'), '---\nscore: 88\n---\n乙库正文。\n');
const settingsFile = (directory) => path.join(directory, '.textbook', 'settings.json');
const disk = async (name = '模式.md', directory = root) => readFile(path.join(directory, name), 'utf8');
const data = (source) => parse(source.split(/\r?\n---(?:\r?\n|$)/)[0].replace(/^---\r?\n/, ''));
async function eventually(read, predicate, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && predicate(value)) return value;
    await delay(50);
  }
  assert.fail(message);
}
async function settings(directory = root) {
  return JSON.parse(await eventually(() => readFile(settingsFile(directory), 'utf8'), (text) => { try { JSON.parse(text); return true; } catch { return false; } }, 'settings remained unavailable'));
}
const pageErrors = [], outbound = [];
let instance, page;
async function launch() {
  instance = await _electron.launch({ ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE } : {}), args: [...(process.env.DESKTOP_EXECUTABLE ? [] : [project]), `--user-data-dir=${userData}`] });
  page = await instance.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.route(/https?:\/\//, (route) => { outbound.push(route.request().url()); return route.abort(); });
  await page.getByRole('button', { name: /^(选择|切换)笔记库$/ }).waitFor();
}
async function choose(directory) {
  await instance.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, directory);
  await page.getByRole('button', { name: /^(选择|切换)笔记库$/ }).click();
}
async function openNote(name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
  await eventually(() => page.getByRole('button', { name: '新建笔记', exact: true }).isEnabled(), Boolean, 'note stayed busy');
}
const editor = () => page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true });
const bodyMode = () => page.getByRole('combobox', { name: '正文模式', exact: true });
const headerMode = () => page.getByRole('combobox', { name: '文件头模式', exact: true });
async function modes(body, header) {
  await bodyMode().selectOption(body);
  if (header) await headerMode().selectOption(header);
}
async function source(text) {
  await modes('edit', 'source');
  await page.locator('.cm-content[contenteditable="true"]:visible').waitFor();
  await editor().click(); await editor().press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}
async function saved(predicate, name = '模式.md') {
  await eventually(() => disk(name), predicate, `${name} did not save expected content`);
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
}
const checks = [];
function record(check) { checks.push(check); console.log(`PASS ${check}`); }
await launch();
try {
  await choose(root);
  await openNote('模式');
  assert.equal(await bodyMode().inputValue(), 'live');
  assert.equal(await headerMode().inputValue(), 'properties');
  await page.getByRole('region', { name: '笔记位置', exact: true }).getByText('test-book', { exact: true }).waitFor();
  assert.equal(await disk(), fixture, 'opening must not rewrite a note');
  await page.locator('.note-rendered-block').filter({ hasText: '可原位修改的段落' }).waitFor();
  assert.equal(await page.locator('.note-properties').filter({ visible: true }).getByRole('textbox', { name: '属性值 id', exact: true }).inputValue(), '用户身份');
  assert.equal(await page.getByRole('combobox', { name: '属性类型 unknown', exact: true }).inputValue(), 'unsupported');
  await page.getByText('此属性的显示类型尚不支持，原配置已保留。可明确选择新的显示类型。', { exact: true }).waitFor();
  assert.equal((await settings(root)).propertyTypes.unknown, 'future-type');
  record('default live + properties; opening without file mutation; existing anchors read-only display');

  // Each writable body mode has both independent header views. Preview always
  // renders the header as read-only properties and keeps the previous preference.
  for (const header of ['source', 'properties']) {
    for (const body of ['edit', 'live']) {
      await modes(body, header);
      assert.equal(await bodyMode().inputValue(), body); assert.equal(await headerMode().inputValue(), header);
      assert.equal(await page.locator('.note-property-rows:visible').count(), header === 'properties' ? 1 : 0);
      await editor().waitFor();
      if (body === 'live') assert.ok(await page.locator('.note-rendered-block').count() > 0);
    }
    await modes('preview');
    assert.equal(await headerMode().count(), 0);
    assert.equal(await page.locator('.note-properties:visible input, .note-properties:visible textarea, .note-properties:visible select, .note-properties:visible button').count(), 0);
    assert.equal(await page.locator('.note-document [contenteditable="true"]:visible').count(), 0);
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 0);
    await page.getByRole('region', { name: '笔记位置', exact: true }).getByText('test-book', { exact: true }).waitFor();
    await modes('edit');
    assert.equal(await headerMode().inputValue(), header);
  }
  record('edit/live × source/properties and preview × both retained header preferences; preview fully read-only');
  await modes('edit', 'source');
  assert.ok(await page.locator('.cm-foldPlaceholder').count() > 0, '_textbook folded by default');
  await page.locator('.cm-foldPlaceholder').first().click();
  await page.getByRole('textbox', { name: '笔记 Markdown 源码', exact: true }).getByText('  id: builtin-identity', { exact: true }).waitFor();
  await openNote('注释文件头');
  await page.locator('.cm-foldPlaceholder').waitFor();
  await page.locator('.cm-foldPlaceholder').click();
  await editor().getByText('  id: quoted-identity', { exact: true }).waitFor();
  await openNote('模式');
  await modes('edit', 'properties');
  await eventually(() => page.getByRole('button', { name: '保存', exact: true }).isEnabled(), Boolean, 'note remained busy');
  if (await page.locator('.note-information').getAttribute('open') === null) await page.locator('.note-information summary').click();
  await page.locator('.note-information').getByText('builtin-identity', { exact: true }).waitFor();
  record('reserved metadata folded in source, expanded on demand, information panel read-only');

  await openNote('另一篇');
  assert.equal(await page.getByRole('combobox', { name: '属性类型 score', exact: true }).inputValue(), 'number');
  await page.getByText('显示类型为数值；文件值是文本，未转换。', { exact: true }).waitFor();
  await openNote('模式');
  await page.getByRole('textbox', { name: '属性值 id', exact: true }).fill('用户新身份');
  await saved((text) => data(text).id === '用户新身份');
  assert.equal(data(await disk())._textbook.id, 'builtin-identity');
  assert.equal(data(await disk()).anchors, '用户位置');
  await page.getByRole('textbox', { name: '新增属性名', exact: true }).fill('新增字段');
  await page.getByRole('combobox', { name: '新增属性类型', exact: true }).selectOption('text');
  await page.getByRole('button', { name: '添加属性', exact: true }).click();
  await page.getByRole('textbox', { name: '属性值 新增字段', exact: true }).fill('新值');
  await saved((text) => data(text).新增字段 === '新值');
  await page.getByRole('button', { name: '删除属性 新增字段', exact: true }).click();
  await saved((text) => !Object.hasOwn(data(text), '新增字段'));
  await page.getByRole('textbox', { name: '属性 tags 第 1 项', exact: true }).fill('丙');
  await page.getByRole('button', { name: '添加属性 tags 列表项', exact: true }).click();
  await page.getByRole('textbox', { name: '属性 tags 第 3 项', exact: true }).fill('丁');
  await saved((text) => data(text).tags.join(',') === '丙,乙,丁');
  await page.getByRole('button', { name: '删除属性 tags 第 2 项', exact: true }).click();
  await saved((text) => data(text).tags.join(',') === '丙,丁');
  const score = page.getByRole('textbox', { name: '属性值 score', exact: true });
  await score.fill('-12.5'); await score.press('Tab');
  await saved((text) => data(text).score === -12.5);
  const beforeType = await disk();
  await page.getByRole('combobox', { name: '属性类型 score', exact: true }).selectOption('boolean');
  await page.getByText('显示类型为开关；文件值是数值，未转换。', { exact: true }).waitFor();
  await eventually(() => readFile(settingsFile(root), 'utf8'), (text) => JSON.parse(text).propertyTypes.score === 'boolean', 'property type did not persist');
  assert.equal(await disk(), beforeType, 'type selection must not change note values or time');
  await openNote('另一篇');
  assert.equal(await page.getByRole('combobox', { name: '属性类型 score', exact: true }).inputValue(), 'boolean');
  await page.getByText('显示类型为开关；文件值是文本，未转换。', { exact: true }).waitFor();
  assert.equal(data(await disk('另一篇.md')).score, '文本分数');
  await openNote('模式');
  const preserved = await disk();
  assert.ok(preserved.includes('# 保留注释')); assert.deepEqual(data(preserved).unknown, { nested: 'keep' });
  record('properties add/edit/delete; list editing; builtin names isolated; unknown YAML and comments preserved; shared type without value coercion');

  // Invalid and duplicate YAML never reach disk; the same source remains editable.
  for (const [repairIndex, invalid] of ['---\nscore: [\n---\n无效草稿', '---\nscore: 1\nscore: 2\n---\n重复草稿'].entries()) {
    const prior = await disk();
    await source(invalid);
    await page.getByText(/YAML 第 \d+ 行，第 \d+ 列/).first().waitFor();
    await modes('live', 'properties');
    await page.getByText(/属性写入已暂停/).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '新增属性名', exact: true }).count(), 0);
    await delay(900); assert.equal(await disk(), prior);
    await modes('preview');
    await modes('edit', 'source');
    assert.ok((await editor().innerText()).includes(invalid.endsWith('无效草稿') ? '无效草稿' : '重复草稿'));
    await source(`${preserved}\n修复成功${repairIndex}\n`);
    await saved((text) => text.includes(`修复成功${repairIndex}`) && text.includes('连续纸面') && !text.includes('重复草稿') && !text.includes('无效草稿'));
  }
  record('invalid/duplicate YAML errors include line and column; autosave and properties pause; mode changes retain draft; repair resumes');

  await modes('preview');
  const preview = page.getByLabel('笔记只读预览', { exact: true });
  await preview.locator('.note-callout-explanation header').filter({ hasText: '理解标题' }).waitFor();
  const hint = preview.locator('.note-callout-hint');
  assert.equal(await hint.getAttribute('open'), null);
  await hint.locator('summary').click(); assert.notEqual(await hint.getAttribute('open'), null);
  await hint.getByText('提示正文。', { exact: true }).waitFor();
  const warning = preview.locator('.note-callout-warning');
  assert.notEqual(await warning.getAttribute('open'), null);
  const unknown = preview.locator('.note-callout-mystery');
  assert.equal(await unknown.getAttribute('open'), null);
  await unknown.locator('summary').click(); await unknown.getByText('未知正文保留。', { exact: true }).waitFor();
  await preview.locator('.note-callout-__proto__ header').filter({ hasText: '原型类型' }).waitFor();
  await preview.locator('.note-callout-__proto__').getByText('保留正文。', { exact: true }).waitFor();
  await preview.locator('mjx-container svg').first().waitFor();
  await preview.locator('code').filter({ hasText: /^price \$$/ }).waitFor();
  await preview.locator('pre code').filter({ hasText: '$x$ 保持代码文字' }).waitFor();
  assert.ok(await preview.locator('mjx-container svg').count() >= 4, 'formulas after code and escaped dollar render separately');
  await preview.getByText(/转义美元 \$5 与公式/).waitFor();
  assert.equal(await preview.locator('li').count(), 2);
  assert.equal(await preview.getByRole('link', { name: '普通链接', exact: true }).getAttribute('aria-disabled'), 'true');
  assert.equal(await preview.getByRole('link', { name: '引用链接', exact: true }).getAttribute('title'), 'https://example.org/reference');
  assert.equal(await page.evaluate(() => window.untrustedHtml), undefined);
  assert.equal(await preview.locator('script, img').count(), 0);
  assert.deepEqual(outbound, []);
  await page.screenshot({ path: path.join(evidence, 'preview-callouts-offline.png') });
  await preview.locator('.math-display').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'preview-formulas-offline.png') });
  record('known/unknown callouts, fold toggles, list/link rendering, offline MathJax SVG, HTML and remote images inert');

  await modes('live', 'properties');
  assert.ok(await page.locator('.note-rendered-block a[title="https://example.org/reference"]').count() > 0, 'live reference links retain definitions');
  const rendered = page.locator('.note-rendered-block').filter({ hasText: '可原位修改的段落' });
  await rendered.click();
  await editor().press('End'); await page.keyboard.insertText(' 原位编辑成功');
  await saved((text) => text.includes('可原位修改的段落。 原位编辑成功'));
  await modes('preview');
  await preview.getByText('可原位修改的段落。 原位编辑成功', { exact: true }).waitFor();
  record('live rendering enters original block and saves edited source; same text appears in preview');

  // Switch modes immediately after typing, before the autosave debounce.
  // Native typing and undo test the retained CodeMirror instance and selection.
  await modes('edit', 'properties');
  await editor().click(); await editor().press('ControlOrMeta+End');
  await page.keyboard.insertText('未保存切换现场');
  assert.ok(!(await disk()).includes('未保存切换现场'), 'workspace switch begins with an unsaved edit');
  await page.getByRole('button', { name: '教材书架', exact: true }).click();
  await page.getByRole('button', { name: '笔记库', exact: true }).click();
  assert.ok((await editor().innerText()).includes('未保存切换现场'));
  await modes('preview'); await modes('edit', 'properties');
  await editor().press('ArrowLeft'); await page.keyboard.insertText('光标');
  await saved((text) => text.includes('未保存切换现光标场'));
  await editor().press('ControlOrMeta+z');
  await saved((text) => text.includes('未保存切换现场') && !text.includes('光标'));
  record('workspace/textbook entry and mode switches retain unsaved edit, cursor location and undo history');
  await openNote('撤销');
  await modes('edit', 'source');
  await page.locator('.cm-content[contenteditable="true"]:visible').waitFor();
  await editor().click(); await editor().press('ControlOrMeta+End');
  await page.keyboard.insertText(' 首次编辑');
  await saved((text) => text.endsWith('首次编辑'), '撤销.md');
  const generatedId = data(await disk('撤销.md'))._textbook.id;
  await editor().press('ControlOrMeta+End'); await page.keyboard.insertText(' 第二次编辑');
  await saved((text) => text.endsWith('第二次编辑'), '撤销.md');
  await editor().press('ControlOrMeta+z');
  await saved((text) => text.endsWith('首次编辑') && data(text)._textbook.id === generatedId, '撤销.md');
  record('body undo after generated metadata/save preserves note identity and reverts user text');
  await openNote('隐藏文件头');
  await modes('edit', 'properties');
  await page.locator('.cm-content[contenteditable="true"]:visible').waitFor();
  await editor().click(); await editor().press('ControlOrMeta+Home'); await editor().press('Backspace');
  await delay(750);
  assert.equal(data(await disk('隐藏文件头.md'))._textbook.id, 'hidden-header-identity');
  assert.equal(data(await disk('隐藏文件头.md')).用户字段, 'protected');
  await editor().press('ControlOrMeta+a'); await page.keyboard.insertText('替换后的正文。');
  await saved((text) => text.endsWith('替换后的正文。') && data(text)._textbook.id === 'hidden-header-identity' && data(text).用户字段 === 'protected', '隐藏文件头.md');
  await editor().press('ControlOrMeta+z');
  await saved((text) => text.endsWith('只替换正文，保留文件头。') && data(text)._textbook.id === 'hidden-header-identity' && data(text).用户字段 === 'protected', '隐藏文件头.md');
  record('properties view protects hidden YAML from Home/Backspace and select-all body replacement; undo keeps metadata');
  await openNote('模式');

  // Settings are per vault. Existing fields written outside the app are protected.
  await modes('live', 'properties');
  await eventually(() => readFile(settingsFile(root), 'utf8'), (text) => JSON.parse(text).editor?.bodyMode === 'live' && JSON.parse(text).editor?.frontmatterMode === 'properties', 'intermediate root mode prefs did not settle');
  await bodyMode().selectOption('edit');
  await eventually(() => readFile(settingsFile(root), 'utf8'), (text) => JSON.parse(text).editor?.bodyMode === 'edit', 'root body preference did not settle');
  await headerMode().selectOption('source');
  await eventually(() => readFile(settingsFile(root), 'utf8'), (text) => JSON.parse(text).editor?.frontmatterMode === 'source', 'root header preference did not settle');
  const externalSettings = (await settings(root));
  assert.equal(externalSettings.propertyTypes.unknown, 'future-type');
  externalSettings.external = { keep: true }; externalSettings.editor.frontmatterMode = 'properties';
  await writeFile(settingsFile(root), JSON.stringify(externalSettings));
  await bodyMode().selectOption('live');
  await page.getByRole('alert').filter({ hasText: '设置已被外部修改' }).waitFor();
  assert.deepEqual((await settings(root)).external, { keep: true });
  assert.equal((await settings(root)).editor.bodyMode, 'edit');
  await page.getByRole('button', { name: '重新读取配置', exact: true }).click();
  await eventually(() => headerMode().inputValue(), (value) => value === 'properties', 'settings reload did not apply external header mode');
  await modes('edit', 'source');
  await choose(other); await openNote('乙笔记');
  assert.equal(await bodyMode().inputValue(), 'live'); assert.equal(await headerMode().inputValue(), 'properties');
  assert.equal(await page.getByRole('combobox', { name: '属性类型 score', exact: true }).inputValue(), 'number');
  await modes('preview');
  await eventually(() => readFile(settingsFile(other), 'utf8'), (text) => JSON.parse(text).editor?.bodyMode === 'preview', 'other mode prefs did not settle');
  await choose(root);
  await page.getByRole('heading', { name: '模式', exact: true }).waitFor();
  assert.equal(await bodyMode().inputValue(), 'edit'); assert.equal(await headerMode().inputValue(), 'source');
  assert.deepEqual((await settings(root)).external, { keep: true });
  const mtime = (await stat(path.join(root, '模式.md'))).mtimeMs;
  await delay(400);
  await instance.close(); await launch();
  await page.getByRole('heading', { name: '模式', exact: true }).waitFor();
  assert.equal(await bodyMode().inputValue(), 'edit'); assert.equal(await headerMode().inputValue(), 'source');
  assert.equal((await stat(path.join(root, '模式.md'))).mtimeMs, mtime);
  record('settings external modification blocks stale write; reload preserves unknown fields; per-vault modes/types and restart without note write');

  await openNote('只读');
  await page.getByLabel('笔记只读预览', { exact: true }).getByText('未来格式只读正文。', { exact: true }).waitFor();
  assert.equal(await page.locator('.note-properties:visible input, .note-properties:visible textarea, .note-properties:visible select, .note-properties:visible button').count(), 0);
  assert.equal(await page.locator('.note-document [contenteditable="true"]:visible').count(), 0);
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 0);
  assert.equal(await disk('只读.md'), readonly);
  record('future schema note read-only body/properties/anchors with no write controls');
  await openNote('模式');
  await modes('live', 'properties');
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 760, height: 700 }));
  await page.locator('.vault-source .cm-scroller').evaluate((element) => { element.scrollTop = 0; });
  await page.locator('.note-rendered-block').filter({ hasText: '可原位修改的段落' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'live-properties-narrow.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(pageErrors, []);
  record('760 px window no horizontal overflow; no renderer exceptions');
  console.log(JSON.stringify({ result: 'PASS', evidence, checks }, null, 2));
} catch (cause) {
  await page?.screenshot({ path: path.join(evidence, 'failed.png') }).catch(() => undefined);
  console.error(JSON.stringify({ evidence, state: await page?.locator('body').innerText().catch(() => ''), pageErrors }, null, 2));
  throw cause;
} finally {
  await instance?.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => undefined);
  await instance?.close().catch(() => undefined);
}
