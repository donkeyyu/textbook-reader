// Reuse only the isolated fixture produced by check-custom-catalog.mjs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
const project = path.resolve(import.meta.dirname, '..');
const evidence = process.env.CUSTOM_REUSE;
if (!evidence) throw new Error('CUSTOM_REUSE must name the isolated custom catalog check directory.');
const root = path.join(evidence, '笔记库'), data = path.join(evidence, 'app-data');
const book = '6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249';
const customFile = path.join(root, `.textbook/textbooks/${book}/custom.json`);
const env = { ...process.env }; delete env.TEXTBOOK_DOWNLOAD_BASE_URL;
const app = await _electron.launch({ executablePath: path.join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [project, `--user-data-dir=${data}`], env });
const page = await app.firstWindow(); page.setDefaultTimeout(30_000);
const button = (name) => page.getByRole('button', { name, exact: true });
const checks = [], errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function eventually(read, predicate) { for (let n = 0; n < 600; n++) { const value = await read(); if (predicate(value)) return value; await delay(50); } assert.fail('condition did not settle'); }
try {
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  await page.setViewportSize({ width: 1380, height: 980 }); await button('笔记库').click();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: /^(选择笔记库|切换笔记库)$/, exact: true }).first().click();
  await page.locator('.vault-sidebar nav').getByRole('button', { name: '甲', exact: true }).click();
  await page.getByLabel('正文模式', { exact: true }).selectOption('preview');
  assert.equal(await page.getByRole('button', { name: /^管理自定义目录/ }).isDisabled(), true);
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit'); checks.push('preview disables custom catalog writes');
  await page.getByRole('button', { name: /^管理自定义目录/ }).click();
  await page.getByLabel('自定义条目类型', { exact: true }).selectOption('chapter');
  await page.getByLabel('自定义目录名称', { exact: true }).fill('延迟响应核对章'); await button('添加目录条目').click();
  const entry = await eventually(async () => JSON.parse(await readFile(customFile, 'utf8')).chapters.find((entry) => entry.title === '延迟响应核对章'), Boolean);
  await button('关闭目录管理').click();
  const details = page.locator('.note-anchor').first(); if (!await details.evaluate((element) => element.open)) await details.locator('summary').click();
  await page.getByLabel('位置 1 章', { exact: true }).locator(`option[value="${entry.id}"]`).waitFor({ state: 'attached' });
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('textbooks:catalog'); let first = true;
    globalThis.customRace = { held: false, waiting: 0, block: false, blocked: [] };
    ipcMain._invokeHandlers.set('textbooks:catalog', async (...args) => {
      const result = await handler(...args);
      if (first) { first = false; globalThis.customRace.held = true; globalThis.customRace.originalToken = args[1]; return new Promise((resolve) => { globalThis.customRace.release = () => { globalThis.customRace.held = false; resolve(result); }; }); }
      globalThis.customRace.calls = (globalThis.customRace.calls ?? 0) + 1;
      if (globalThis.customRace.block && args[1] === globalThis.customRace.originalToken) { globalThis.customRace.waiting++; return new Promise((resolve) => { globalThis.customRace.blocked.push(() => resolve(result)); }); }
      return result;
    });
  });
  await eventually(() => app.evaluate(() => globalThis.customRace.held), Boolean);
  // No overlapping poll may reach main while this same poll is still held.
  await delay(2600); assert.equal(await app.evaluate(() => globalThis.customRace.calls ?? 0), 0);
  checks.push('held same-vault polling request does not stack more polls');
  await page.getByRole('button', { name: /^管理自定义目录/ }).click(); await button('删除 延迟响应核对章').click();
  await page.getByRole('status').filter({ hasText: '0 篇笔记，0 处引用' }).waitFor();
  await page.getByLabel('删除目录引用处理', { exact: true }).selectOption('@remove');
  await button('确认删除并处理引用').click(); await page.getByRole('status').filter({ hasText: '目录条目及引用处理已完成。' }).waitFor();
  await button('关闭目录管理').click();
  assert.equal(await page.getByLabel('位置 1 章', { exact: true }).locator(`option[value="${entry.id}"]`).count(), 0);
  await app.evaluate(() => { globalThis.customRace.block = true; globalThis.customRace.release(); });
  await eventually(() => app.evaluate(() => globalThis.customRace.waiting), (value) => value > 0);
  // The next poll is now held as well, so it cannot mask an obsolete response.
  assert.equal(await page.getByLabel('位置 1 章', { exact: true }).locator(`option[value="${entry.id}"]`).count(), 0);
  assert.equal(JSON.parse(await readFile(customFile, 'utf8')).chapters.some((candidate) => candidate.id === entry.id), false);
  checks.push('delete and explicit catalog refresh supersede delayed old response; removed candidate cannot revive');
  await page.screenshot({ path: path.join(evidence, 'stale-response-rejected.png') });
  await app.evaluate(({ dialog }, other) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] }); }, path.join(evidence, '独立库'));
  await button('切换笔记库').click();
  await page.locator('.vault-sidebar nav').getByRole('button', { name: '隔离', exact: true }).click();
  await page.getByLabel('正文模式', { exact: true }).selectOption('edit');
  const otherDetail = page.locator('.note-anchor').first(); if (!await otherDetail.evaluate((element) => element.open)) await otherDetail.locator('summary').click();
  await eventually(() => page.getByLabel('位置 1 章', { exact: true }).isEnabled(), Boolean);
  assert.equal(await page.getByLabel('位置 1 章', { exact: true }).locator('optgroup[label="自定义目录"] option').count(), 0);
  checks.push('held old-library poll does not block fresh catalog in another library');
  await page.screenshot({ path: path.join(evidence, 'held-old-vault-isolated.png') });
  await app.evaluate(() => { globalThis.customRace.block = false; globalThis.customRace.blocked.forEach((release) => release()); });
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'race-result.json'), JSON.stringify({ checks, errors, evidence }, null, 2)); console.log(JSON.stringify({ checks, evidence }));
} finally { await app.close(); }
