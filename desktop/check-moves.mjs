// Real Electron controls and disk assertions; the native folder picker belongs to 15.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rename, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { parse } from 'yaml';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-moves-electron-'));
const root = path.join(evidence, '笔记库'), userData = path.join(evidence, 'app-data');
console.log('Evidence:', evidence);
await mkdir(root); await mkdir(path.join(root, '七年级')); await mkdir(path.join(root, '复习'));
const time = '2020-01-01T00:00:00Z';
const source = (body, extra = '') => `---\n# 未知字段与注释保留\n未知: {a: [1, true]}\n_textbook:\n  schema_version: 1\n  id: ${randomUUID()}\n  create_time: "${time}"\n  update_time: "${time}"\n  ai_source: {source_id: unchanged-origin, version: "1"}\n${extra}---\n${body}\n`;
const original = source('原笔记正文。');
const first = source('[[相反数]] [[七年级/相反数|正文别名]] [[复习/相反数|另一个同名]]', '相关: "[[七年级/相反数|属性甲]] 与 [[七年级/相反数|属性乙]]"\n');
const second = source('[[七年级/相反数|只读后重试]]');
await writeFile(path.join(root, '七年级/相反数.md'), original);
await writeFile(path.join(root, '复习/相反数.md'), source('另一个同名目标。'));
await writeFile(path.join(root, '甲引用.md'), first); await writeFile(path.join(root, '乙引用.md'), second);
const metadata = (text) => parse(text.split('\n---\n')[0].replace(/^---\n/, ''))._textbook;
const disk = (name) => readFile(path.join(root, name), 'utf8');
let instance, page;
const errors = [];
async function launch() {
  instance = await _electron.launch({ args: [project, `--user-data-dir=${userData}`] });
  page = await instance.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '选择笔记库', exact: true }).or(page.getByRole('button', { name: '切换笔记库', exact: true })).waitFor();
}
async function select() {
  await instance.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '选择笔记库', exact: true }).click();
}
const dialog = () => page.getByRole('dialog', { name: '改名与移动笔记', exact: true });
async function preview(to) {
  await page.getByRole('button', { name: '改名或移动', exact: true }).click();
  await page.getByRole('textbox', { name: '移动目标路径', exact: true }).fill(to);
  await page.getByRole('button', { name: '预览引用变更', exact: true }).click();
}
async function screenshot(name) { await page.screenshot({ path: path.join(evidence, name) }); }
try {
  await launch(); await select();
  await page.getByRole('button', { name: '相反数 · 七年级', exact: true }).click();
  await page.getByRole('heading', { name: '相反数', exact: true }).waitFor();
  assert.equal(await disk('七年级/相反数.md'), original);
  await preview('复习/相反数.md');
  await dialog().getByRole('alert').filter({ hasText: '目标已存在' }).waitFor();
  assert.equal(await disk('七年级/相反数.md'), original);
  await page.getByRole('textbox', { name: '移动目标路径', exact: true }).fill('复习/中文新名称.md');
  await page.getByRole('button', { name: '预览引用变更', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '2 篇，4 处' }).waitFor();
  assert.equal(await disk('甲引用.md'), first);
  await screenshot('01-preview.png');
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 720, height: 620 }));
  await screenshot('02-narrow-preview.png');
  await chmod(path.join(root, '乙引用.md'), 0o400);
  await page.getByRole('button', { name: '确认改名并维护引用', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '尚未全部完成' }).waitFor();
  assert.equal(await disk('乙引用.md'), second); assert.equal(await disk('复习/中文新名称.md'), original);
  assert.equal(metadata(await disk('复习/中文新名称.md')).update_time, time);
  assert.equal(metadata(await disk('复习/中文新名称.md')).id, metadata(original).id);
  assert.ok((await disk('甲引用.md')).includes('[[复习/中文新名称.md|属性甲]]'));
  const firstSaved = await disk('甲引用.md');
  await screenshot('03-partial-failure.png');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '恢复记录', exact: true }).click();
  await page.locator('.vault-recoveries article').filter({ hasText: '乙引用.md' }).getByRole('button', { name: '打开写入前版本', exact: true }).click();
  await page.getByRole('heading', { name: '乙引用（恢复）', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === '保存' && !button.disabled));
  assert.equal(await page.getByText('草稿已保留，可重试保存或另存。', { exact: true }).count(), 0);
  assert.notEqual(metadata(await disk('乙引用（恢复）.md')).id, metadata(second).id);
  await screenshot('03b-original-recovery-copy.png');
  await chmod(path.join(root, '乙引用.md'), 0o600);
  await page.getByRole('button', { name: '查看并重试', exact: true }).click();
  await page.getByRole('button', { name: '重试未完成项', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '2 篇引用已完成' }).waitFor();
  await dialog().getByRole('button', { name: '关闭', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await disk('甲引用.md'), firstSaved);
  assert.ok((await disk('乙引用.md')).includes('[[复习/中文新名称.md|只读后重试]]'));
  await screenshot('04-retry-complete.png');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '中文新名称 · 复习', exact: true }).click();
  await page.getByRole('heading', { name: '中文新名称', exact: true }).waitFor();
  await page.getByRole('button', { name: '甲引用', exact: true }).click();
  await page.getByRole('combobox', { name: '正文模式', exact: true }).selectOption('preview');
  await page.getByRole('link', { name: '正文别名', exact: true }).click();
  await page.getByRole('heading', { name: '中文新名称', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await page.getByRole('heading', { name: '甲引用', exact: true }).waitFor();
  assert.ok((await disk('甲引用.md')).includes('[[相反数]]'));
  assert.ok((await disk('甲引用.md')).includes('[[复习/相反数|另一个同名]]'));
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 780 }));
  await screenshot('05-link-return-and-names.png');

  const external = source('外部移动原件。'), externalRefs = source('[[外部原件|旧名]] [[外部原件]]');
  await writeFile(path.join(root, '外部原件.md'), external); await writeFile(path.join(root, '外部引用.md'), externalRefs);
  await page.getByRole('button', { name: '外部原件', exact: true }).click();
  await page.getByRole('heading', { name: '外部原件', exact: true }).waitFor();
  await rename(path.join(root, '外部原件.md'), path.join(root, '复习/外部改名.md'));
  await page.getByRole('button', { name: '预览引用修复', exact: true }).waitFor();
  assert.equal(await disk('外部引用.md'), externalRefs);
  await page.getByRole('button', { name: '预览引用修复', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '1 篇，2 处' }).waitFor();
  await screenshot('06-external-repair-preview.png');
  await page.getByRole('button', { name: '确认修复引用', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '1 篇引用已完成' }).waitFor();
  assert.equal(await disk('复习/外部改名.md'), external);
  assert.ok((await disk('外部引用.md')).includes('[[复习/外部改名.md|旧名]]'));
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();

  for (const [name, sameScan] of [['同轮占用', true], ['后续占用', false]]) {
    const moved = source('仍是原 ID 的外移原件。'), replacement = source('不同 ID 的替代文件。');
    const references = source(`[[${name}|原有别名]]`);
    await writeFile(path.join(root, `${name}.md`), moved); await writeFile(path.join(root, `${name}引用.md`), references);
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    if (sameScan) {
      // One main-thread turn gives the watcher the complete external change set.
      await instance.evaluate(({ app }, { from, to, replacement }) => {
        const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
        const fs = require('node:fs'); fs.renameSync(from, to); fs.writeFileSync(from, replacement);
      }, { from: path.join(root, `${name}.md`), to: path.join(root, `复习/${name}.md`), replacement });
    } else {
      await rename(path.join(root, `${name}.md`), path.join(root, `复习/${name}.md`));
      await page.getByRole('button', { name: '预览引用修复', exact: true }).waitFor();
      await writeFile(path.join(root, `${name}.md`), replacement);
    }
    const notice = page.locator('.note-move-actions details > div').filter({ hasText: `发现外部路径变化：${name}.md →` });
    await notice.getByText('原路径已被其他文件占用，存在身份冲突；请手动核对引用。', { exact: false }).waitFor();
    assert.equal(await notice.getByRole('button', { name: '预览引用修复', exact: true }).count(), 0);
    await page.getByRole('button', { name: `${name}引用`, exact: true }).click();
    await page.getByRole('heading', { name: `${name}引用`, exact: true }).waitFor();
    assert.equal(await notice.isVisible(), true);
    assert.equal(await disk(`${name}引用.md`), references);
    assert.equal(await disk(`${name}.md`), replacement); assert.equal(await disk(`复习/${name}.md`), moved);
    await screenshot(sameScan ? '06b-same-scan-occupied.png' : '06c-late-occupied.png');
  }

  const duplicate = source('重复 ID 测试。'), duplicateRef = source('[[旧重复]]');
  await writeFile(path.join(root, '旧重复.md'), duplicate); await writeFile(path.join(root, '重复引用.md'), duplicateRef);
  await page.getByRole('button', { name: '旧重复', exact: true }).click();
  await page.getByRole('heading', { name: '旧重复', exact: true }).waitFor();
  await rename(path.join(root, '旧重复.md'), path.join(root, '七年级/重复一.md'));
  await writeFile(path.join(root, '复习/重复二.md'), duplicate);
  await page.getByText('ID 冲突，不能确认外部移动目标。', { exact: false }).waitFor();
  assert.equal(await disk('重复引用.md'), duplicateRef);
  await screenshot('07-duplicate-id-warning.png');

  await writeFile(path.join(root, '中断.md'), source('真实进程中断。')); await writeFile(path.join(root, '中断引用.md'), source('[[中断|恢复链接]]'));
  await page.getByRole('button', { name: '中断', exact: true }).click();
  await preview('复习/中断恢复.md');
  await dialog().getByRole('status').filter({ hasText: '1 篇，1 处' }).waitFor();
  await instance.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const { Vault } = require('./build-desktop/vault.js'); const originalMove = Vault.prototype.moveFile;
    Vault.prototype.moveFile = function (...args) { this.moveCheckpoint = async (stage) => { if (stage === 'linked') process.exit(42); }; return originalMove.apply(this, args); };
  });
  const exited = new Promise((resolve) => instance.process().once('exit', resolve));
  await page.getByRole('button', { name: '确认改名并维护引用', exact: true }).click().catch(() => {});
  await exited;
  await launch();
  await page.getByRole('button', { name: '查看并重试', exact: true }).click();
  await page.getByRole('button', { name: '重试未完成项', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '1 篇引用已完成' }).waitFor();
  assert.ok((await disk('中断引用.md')).includes('[[复习/中断恢复.md|恢复链接]]'));
  await screenshot('08-real-process-recovery.png');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();

  const offlineRef = source('[[关闭时旧路径]]');
  await writeFile(path.join(root, '关闭时旧路径.md'), source('关闭后移动。')); await writeFile(path.join(root, '关闭时引用.md'), offlineRef);
  await page.getByRole('button', { name: '关闭时旧路径', exact: true }).click();
  await page.getByRole('heading', { name: '关闭时旧路径', exact: true }).waitFor();
  await instance.close();
  await rename(path.join(root, '关闭时旧路径.md'), path.join(root, '复习/关闭时新路径.md'));
  await launch();
  assert.equal(await disk('关闭时引用.md'), offlineRef);
  assert.equal(await page.getByRole('button', { name: '预览引用修复', exact: true }).count(), 0);
  await page.getByRole('button', { name: '关闭时引用', exact: true }).click();
  await page.getByRole('link', { name: '关闭时旧路径', exact: true }).click();
  await page.getByRole('dialog', { name: '选择笔记链接', exact: true }).waitFor();
  await screenshot('09-no-history-missing-link.png');
  await page.getByRole('dialog', { name: '选择笔记链接', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  const blockedReference = source('[[预检只读|仍未改写]]').replace('schema_version: 1', 'schema_version: 2');
  await writeFile(path.join(root, '预检只读.md'), source('预检时已存在只读来源。'));
  await writeFile(path.join(root, '较新引用.md'), blockedReference);
  await page.getByRole('button', { name: '预检只读', exact: true }).click();
  await preview('复习/预检只读已移动.md');
  await dialog().getByText('较新格式只读，不能改写引用。', { exact: false }).waitFor();
  await page.getByRole('button', { name: '确认改名并维护引用', exact: true }).click();
  await dialog().getByRole('status').filter({ hasText: '1 项需手动核对' }).waitFor();
  assert.equal(await disk('较新引用.md'), blockedReference);
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '查看未处理项', exact: true }).waitFor();
  await screenshot('10-manual-reference-stays-visible.png');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, evidence, checks: ['collision', 'Chinese move', 'aliases and unknown YAML', 'partial failure and retry', 'original recovery to a new identity', 'link navigation and return', 'external repair', 'same-scan old path identity conflict', 'occupied path updates an existing notice', 'duplicate ID', 'real Electron process exit and retry', 'no-history missing link', 'pre-existing readonly reference remains visible after closing'], pageErrors: errors }, null, 2));
} catch (error) {
  console.error('Evidence:', evidence); if (page && !page.isClosed()) await screenshot('failure.png'); throw error;
} finally { if (instance && instance.process().exitCode === null) await instance.close(); }
