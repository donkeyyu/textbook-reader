// Uses isolated real Electron input; only folder selection is controlled. No native OS dialogs.
// Both builds use the same cloned 971-note vault and the same local textbook resources.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { _electron } from 'playwright-core';
const project = path.resolve(import.meta.dirname, '..');
let app, page;
const deadline = setTimeout(() => { console.error('Runtime performance check exceeded 360000 ms.'); app?.process().kill('SIGTERM'); process.exit(124); }, 360_000); deadline.unref();
const beforeApp = process.env.INITIAL_NOTES_BEFORE_APP;
const [sourceVault, sourceData] = process.argv.slice(2);
assert.ok(beforeApp && sourceVault && sourceData, 'Set INITIAL_NOTES_BEFORE_APP; pass a 971-note vault and its resource app-data.');
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-marker-performance-')));
console.log(`Evidence: ${evidence}`);
const root = path.join(evidence, 'vault'), data = path.join(evidence, 'app-data');
await cp(sourceVault, root, { recursive: true, force: false, errorOnExist: true }); await mkdir(data);
await cp(path.join(sourceData, 'textbook-resources'), path.join(data, 'textbook-resources'), { recursive: true });
const pack = JSON.parse(await readFile(path.join(project, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8'));
const plan = JSON.parse(await readFile(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/plan.json`), 'utf8'));
assert.equal(plan.notes.length, 971);
const results = [], errors = [];
async function ready() { await page.waitForFunction(() => [...document.querySelectorAll('.vault-sidebar button')].some((button) => button.textContent === '新建笔记' && !button.disabled)); }
async function add() {
  await page.getByRole('button', { name: '添加教材', exact: true }).first().click();
  await page.getByRole('button', { name: '添加到书架', exact: true }).click();
  await page.getByRole('button', { name: '已添加', exact: true }).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: '关闭教材选择', exact: true }).click();
}
async function readBook() {
  await page.getByRole('button', { name: /^(开始阅读|继续阅读)$/ }).click();
  await page.locator('.page-index').click(); await page.getByRole('textbox', { name: '页码', exact: true }).fill('88');
  await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await page.getByRole('button', { name: '第 88 页，共 202 页，点击输入页码', exact: true }).waitFor();
}
try {
  for (const [phase, appRoot] of [['before', beforeApp], ['after', project]]) {
    console.log(`${phase}: launching isolated Electron process`);
    app = await _electron.launch({ timeout: 30_000, executablePath: path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [appRoot, `--user-data-dir=${data}`], env: { ...process.env, TEXTBOOK_DOWNLOAD_BASE_URL: '' } });
    page = await app.firstWindow({ timeout: 30_000 }); page.setDefaultTimeout(30_000);
    console.log(`${phase}: first window ready`);
    page.on('pageerror', (error) => errors.push({ phase, error: error.message }));
    await page.getByRole('button', { name: '笔记库', exact: true }).click();
    if (phase === 'before') {
      await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
      await page.getByRole('button', { name: '选择笔记库', exact: true }).click(); await ready();
    } else await ready();
    await page.getByRole('button', { name: '教材书架', exact: true }).click();
    if (phase === 'before') await add();
    await readBook();
    for (const sourceId of ['ch3-q-p88-example4', 'ch3-triangle-base-height', 'ch3-q-p88-example4']) {
      const entry = pack.entries.find((item) => item.sourceId === sourceId);
      const marker = page.locator(`button[data-supplement-ids~="${sourceId}"]`);
      await marker.scrollIntoViewIfNeeded(); const start = performance.now(); await marker.click();
      const choices = page.getByRole('complementary', { name: '选择本地笔记', exact: true });
      if (await choices.count()) await choices.getByRole('button', { name: entry.title, exact: true }).click();
      await page.locator('.vault-note-heading h1').filter({ hasText: entry.title }).waitFor({ timeout: 30_000 });
      const result = { phase, action: 'marker open', sourceId, ms: Math.round(performance.now() - start) }; results.push(result); console.log(JSON.stringify(result));
      await ready(); await page.getByRole('button', { name: '教材书架', exact: true }).click();
    }
    // Open the same target through its real marker before each build's save measurements.
    const target = pack.entries.find((item) => item.sourceId === 'ch3-q-p88-example4');
    await page.locator('button[data-supplement-ids~="ch3-q-p88-example4"]').click();
    const choices = page.getByRole('complementary', { name: '选择本地笔记', exact: true });
    if (await choices.count()) await choices.getByRole('button', { name: target.title, exact: true }).click();
    await page.locator('.vault-note-heading h1').filter({ hasText: target.title }).waitFor(); await ready();
    await page.getByLabel('正文模式').selectOption('edit');
    const targetPath = plan.notes.find((item) => item.sourceId === target.sourceId).path;
    for (let round = 0; round < 3; round++) {
      const editor = page.locator('.cm-content[contenteditable=true]'); await editor.click(); await page.keyboard.press('Meta+End'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
      const text = `${phase} 实际保存 ${round}`; await page.keyboard.insertText(text);
      const start = performance.now(); await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor({ timeout: 30_000 });
      assert.ok((await readFile(path.join(root, targetPath), 'utf8')).includes(text));
      const result = { phase, action: 'save', round, ms: Math.round(performance.now() - start) }; results.push(result); console.log(JSON.stringify(result)); await ready();
    }
    await page.screenshot({ path: path.join(evidence, `${phase}-editor.png`) });
    await page.getByRole('button', { name: '教材书架', exact: true }).click(); await page.getByRole('button', { name: '返回书架', exact: true }).click();
    await page.getByRole('button', { name: /更多操作/ }).click(); await page.getByRole('menuitem', { name: '移出书架', exact: true }).click();
    const start = performance.now(); await add(); const result = { phase, action: 'readd', ms: Math.round(performance.now() - start) }; results.push(result); console.log(JSON.stringify(result));
    await app.close(); app = null;
  }
  assert.deepEqual(errors, []); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ root, beforeApp, afterApp: project, count: 971, results, errors }, null, 2));
  console.log(JSON.stringify({ evidence, result: 'passed' }));
} catch (error) {
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ message: String(error), stack: error.stack, results, errors }, null, 2));
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally { clearTimeout(deadline); if (app) app.process().kill('SIGTERM'); }
