// Copy a prepared vault into disposable storage; never edit the supplied original.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const source = process.argv[2];
assert.ok(source, 'Pass a prepared portable vault');
const project = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'textbook-portable-open-'));
const root = path.join(temporary, 'copied-vault'), data = path.join(temporary, 'app-data');
await cp(source, root, { recursive: true });
await mkdir(data);
await writeFile(path.join(data, 'last-vault.json'), JSON.stringify({ root }));
const results = [];
let instance;
try {
  for (const round of ['cold', 'warm']) {
    const start = performance.now();
    instance = await _electron.launch({ args: [project, `--user-data-dir=${data}`], env: { ...process.env, TEXTBOOK_DOWNLOAD_BASE_URL: '' } });
    await instance.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
    const page = await instance.firstWindow();
    const external = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(async () => {
      const context = await window.textbookResources?.context();
      return context?.ok && context.value && (await window.textbookResources.status()).value?.phase === 'ready';
    });
    const readyMs = Math.round(performance.now() - start);
    const state = await page.evaluate(async () => {
      const api = window.textbookDesktop;
      const selected = await api.restore();
      if (!selected.ok || !selected.value) throw new Error('Missing restored vault');
      const token = selected.value.token;
      const notes = await window.textbookResources.notes(token);
      if (!notes.ok) throw new Error(notes.error);
      const target = notes.value.notes.find(note => note.path);
      const read = await api.read(token, target.path);
      const response = await fetch('textbook://app/textbooks/grade-7-volume-1/page-88.webp');
      return { notes: selected.value.notes.length, targetReadable: read.ok, pageStatus: response.status, pageBytes: (await response.arrayBuffer()).byteLength,
        context: (await window.textbookResources.context()).value };
    });
    assert.ok(state.notes >= 971); assert.equal(state.targetReadable, true);
    assert.equal(state.pageStatus, 200); assert.ok(state.pageBytes > 1000);
    await page.waitForFunction(({ vaultKey }) => JSON.parse(localStorage.getItem(`desktop-textbooks:${vaultKey}:textbook-shelf-v1`) || 'null')?.bookIds.length === 1, state.context);
    if (round === 'cold') await page.locator('.shelf-cover').click();
    await page.waitForFunction(() => { const image = document.querySelector('#page-1 .page-image'); return image?.complete && image.naturalWidth > 0; });
    const readableMs = Math.round(performance.now() - start);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    results.push({ round, readyMs, readableMs, notes: state.notes, pageBytes: state.pageBytes, networkRequests: external.length });
    await instance.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
    await instance.close(); instance = undefined;
    // Resume on the shelf again; saved membership must remain available.
    const noGlobalResources = await readFile(path.join(data, 'textbook-resources', '6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249', 'textbooks/grade-7-volume-1/page-1.webp')).catch(() => null);
    assert.equal(noGlobalResources, null, 'Copied vault must work without an app-data resource copy');
  }
  console.log(JSON.stringify({ copiedVaultOffline: true, results }, null, 2));
} finally {
  if (instance) { await instance.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await instance.close().catch(() => {}); }
  await rm(temporary, { recursive: true, force: true });
}
