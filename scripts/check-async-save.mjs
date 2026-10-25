import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { openNote } from './check-related-return.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const personalKey = `textbook-personal-v1:${book.documentSha256}`;

async function replaceNote(page, text) {
  if (await page.evaluate(() => document.querySelector('.note-mode-toggle').getAttribute('aria-pressed') === 'true')) await page.click('.note-mode-toggle');
  await page.focus('.personal-note .cm-content');
  await page.press('.personal-note .cm-content', 'ControlOrMeta+a');
  if (text) await page.keyboard.insertText(text);
  else await page.press('.personal-note .cm-content', 'Backspace');
}

async function savedNote(page, id, expected) {
  await page.waitForFunction(({ key, id, expected }) => {
    const value = JSON.parse(localStorage.getItem(key))?.notes?.[id] ?? null;
    return value === expected && !document.querySelector('.personal-note [data-dirty="true"]');
  }, { key: personalKey, id, expected });
}

async function withEmptyNotes(page, ids, { testOrigin } = {}, run) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  assert.equal(new URL(await page.url()).origin, new URL(testOrigin).origin);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  const raw = await page.evaluate((key) => localStorage.getItem(key), personalKey);
  const data = raw === null ? { notes: {} } : JSON.parse(raw);
  for (const id of ids) assert.ok(!data.notes[id]?.trim(), `Test source already has a note: ${id}`);
  try { await run(); }
  finally {
    await page.evaluate(() => {
      const test = window.asyncSaveTest;
      if (test) {
        test.failAll = true;
        for (const request of test.requests) request.release(true);
        if (test.confirm) window.confirm = test.confirm;
      }
    });
    await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'));
    await page.evaluate(({ key, raw }) => {
      delete window.asyncSaveTest;
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    }, { key: personalKey, raw });
    await page.reload();
    await page.waitForSelector('.page-index');
  }
}

// Dedicated Vite server: defer the real storage function without adding a test
// hook to application code. Each release either writes normally or rejects.
export async function startAsyncSaveServer(port = 5181) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{
      name: 'async-save-browser-check', enforce: 'pre',
      transform(source, id) {
        if (!id.endsWith('/src/reader/personal.ts')) return;
        assert.ok(source.includes('export function savePersonal('));
        return source.replace('export function savePersonal(', 'function savePersonalSync(') + `
export function savePersonal(...args: Parameters<typeof savePersonalSync>) {
  const test = (window as any).asyncSaveTest;
  if (!test) return savePersonalSync(...args);
  if (test.failAll) return Promise.reject(new Error('Test cleanup'));
  return new Promise<void>((resolve, reject) => {
    let released = false;
    test.requests.push({ data: args[0], release(fail = false) {
      if (released) return;
      released = true;
      try {
        if (fail) throw new Error('Delayed save failed');
        savePersonalSync(...args);
        resolve();
      } catch (cause) { reject(cause); }
    }});
  });
}`;
      },
    }],
  });
  await server.listen();
  return server;
}

async function requestCount(page, count) {
  await page.waitForFunction((count) => window.asyncSaveTest.requests.length === count, count);
}

async function release(page, index, fail = false) {
  await page.evaluate(({ index, fail }) => window.asyncSaveTest.requests[index].release(fail), { index, fail });
}

// Run against startAsyncSaveServer(), with an explicit independent testOrigin.
export async function checkAsyncNoteSave(page, options) {
  const id = 'ch1-measurement-exercise';
  return withEmptyNotes(page, [id], options, async () => {
    await openNote(page, id);
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    try {
      await replaceNote(page, 'First revision');
      await requestCount(page, 1);
      await replaceNote(page, 'Intermediate revision');
      await replaceNote(page, 'Latest revision');
      assert.equal(await page.evaluate(() => window.asyncSaveTest.requests.length), 1, 'Later writes cannot finish before the first write');
      assert.equal(await page.evaluate(() => document.querySelector('.personal-note .markdown-editor').dataset.dirty), 'true');
      await page.evaluate(() => {
        window.asyncSaveTest.confirm = window.confirm;
        window.asyncSaveTest.prompts = 0;
        window.confirm = () => { window.asyncSaveTest.prompts++; return false; };
      });
      await page.click('button[aria-label="关闭解读"]');
      await page.click('#related-ch1-measurement-exercise-ch1-source-standard-comparison');
      assert.deepEqual(await page.evaluate(() => ({
        draft: document.querySelector('.personal-note .cm-content').textContent,
        prompts: window.asyncSaveTest.prompts,
      })), { draft: 'Latest revision', prompts: 2 }, 'Canceled close and node switch retain the pending draft');
      await release(page, 0);
      await requestCount(page, 2);
      assert.equal(await page.evaluate(() => window.asyncSaveTest.requests[1].data.notes['ch1-measurement-exercise']), 'Intermediate revision', 'Waiting input retains its write order');
      assert.equal(await page.evaluate(() => document.querySelector('.personal-note .markdown-editor').dataset.dirty), 'true', 'Old success cannot confirm the latest draft');
      await release(page, 1);
      await requestCount(page, 3);
      assert.equal(await page.evaluate(() => window.asyncSaveTest.requests[2].data.notes['ch1-measurement-exercise']), 'Latest revision');
      await release(page, 2, true);
      await page.waitForSelector('.personal-note [role="alert"]');
      await page.click('button[aria-label="关闭解读"]');
      await page.click('#related-ch1-measurement-exercise-ch1-source-standard-comparison');
      assert.equal(await page.evaluate(() => document.querySelector('.personal-note .cm-content').textContent), 'Latest revision', 'Failed close and switch leave the draft available');
      await page.click('.note-retry');
      await requestCount(page, 4);
      await replaceNote(page, 'Edited during retry');
      await release(page, 3);
      await requestCount(page, 5);
      assert.ok(await page.evaluate(() => !!document.querySelector('.personal-note [role="alert"]')), 'An old retry success cannot clear the latest draft error');
      await release(page, 4);
      await savedNote(page, id, 'Edited during retry');
      assert.equal(await page.evaluate(() => !!document.querySelector('.personal-note [role="alert"]')), false);
      await replaceNote(page, '');
      await requestCount(page, 6);
      assert.equal(await page.evaluate(() => document.querySelector('.personal-note .markdown-editor').dataset.dirty), 'true', 'Pending deletion stays dirty');
      await release(page, 5);
      await savedNote(page, id, null);
      await replaceNote(page, 'Before close');
      await requestCount(page, 7);
      await replaceNote(page, 'Before close newer');
      await page.evaluate(() => { window.confirm = () => true; });
      await page.click('button[aria-label="关闭解读"]');
      assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel')), false);
      await openNote(page, id);
      await replaceNote(page, 'After reopen latest');
      await release(page, 6);
      await requestCount(page, 8);
      await release(page, 7);
      await requestCount(page, 9);
      await release(page, 8);
      await savedNote(page, id, 'After reopen latest');
      assert.equal(await page.evaluate(() => document.querySelector('.personal-note .cm-content').textContent), 'After reopen latest', 'Cross-mount writes retain their original order');
      console.log('PASS async notes: serial revisions, delayed success, failure/retry, pending deletion, protected close/switch, close/reopen during writes');
    } finally {
      await page.evaluate(() => { window.confirm = window.asyncSaveTest.confirm ?? window.confirm; });
    }
  });
}

export async function checkAsyncPersonalSave(page, { testOrigin } = {}) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  assert.equal(new URL(await page.url()).origin, new URL(testOrigin).origin);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  const raw = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith('textbook-personal-v1:')) ?? null);
  assert.equal(raw, null, 'Personal check requires an unused test origin');
  await page.click('button:text-is("添加补充")');
  await page.press('.region-selector', 'Enter');
  await page.fill('.personal-title input', 'QA async title');
  await page.focus('.markdown-source .cm-content');
  await page.keyboard.insertText('First personal body');
  await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
  try {
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 1);
    assert.equal(await page.evaluate(() => document.querySelector('.editor-actions button[type="submit"]').disabled), true);
    await page.fill('.personal-title input', 'Newer title');
    await page.press('.markdown-source .cm-content', 'ControlOrMeta+a');
    await page.keyboard.insertText('Newer body');
    await release(page, 0);
    await page.waitForFunction(() => !document.querySelector('.editor-actions button[type="submit"]').disabled);
    assert.deepEqual(await page.evaluate(() => ({
      title: document.querySelector('.personal-title input')?.value,
      body: document.querySelector('.cm-content')?.textContent,
      dirty: document.querySelector('.markdown-editor')?.dataset.dirty,
    })), { title: 'Newer title', body: 'Newer body', dirty: 'true' }, 'Old success retains newer title/body');
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 2);
    await release(page, 1, true);
    await page.waitForSelector('.markdown-editor [role="alert"]');
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), 'Newer body');
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 3);
    // A title-only change must also prevent old completion from closing editing.
    await page.fill('.personal-title input', 'Final title');
    await release(page, 2);
    await page.waitForFunction(() => !document.querySelector('.editor-actions button[type="submit"]').disabled);
    assert.equal(await page.evaluate(() => document.querySelector('.personal-title input')?.value), 'Final title');
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 4);
    await release(page, 3);
    await page.waitForSelector('.personal-actions');
    assert.equal(await page.evaluate(() => document.querySelector('#supplement-title').textContent), 'Final title');
    await page.click('button:text-is("关闭")');
    assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel')), false);
    await page.reload();
    await page.waitForSelector('.page-index');
    await page.click('[aria-label="我的补充：Final title"]');
    assert.equal(await page.evaluate(() => document.querySelector('.markdown-content').textContent), 'Newer body');
    await page.click('.personal-actions button:first-child');
    await page.fill('.personal-title input', 'Canceled title');
    await page.evaluate(() => {
      window.asyncSaveConfirm = window.confirm;
      window.confirm = () => true;
    });
    try {
      await page.click('.editor-actions button:nth-child(2)');
    } finally {
      await page.evaluate(() => { window.confirm = window.asyncSaveConfirm; delete window.asyncSaveConfirm; });
    }
    await page.click('.personal-actions button:first-child');
    await page.focus('.cm-content');
    await page.keyboard.insertText('After cancel: ');
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.personal-actions');
    assert.equal(await page.evaluate(() => document.querySelector('#supplement-title').textContent), 'Final title', 'Canceling a title edit does not prevent a later synchronous save from closing editing');
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    await page.click('.personal-actions button:first-child');
    await page.press('.cm-content', 'ControlOrMeta+a');
    await page.keyboard.insertText('Older pending body');
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 1);
    await page.evaluate(() => {
      window.asyncSaveConfirm = window.confirm;
      window.confirm = () => true;
    });
    try {
      await page.click('.editor-actions button:nth-child(2)');
      await page.click('button:text-is("关闭")');
    } finally {
      await page.evaluate(() => { window.confirm = window.asyncSaveConfirm; delete window.asyncSaveConfirm; });
    }
    await page.click('[aria-label="我的补充：Final title"]');
    await page.click('.personal-actions button:first-child');
    await page.press('.cm-content', 'ControlOrMeta+a');
    await page.keyboard.insertText('New editing session');
    await release(page, 0);
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).supplements[0]?.markdown === 'Older pending body', personalKey);
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content')?.textContent), 'New editing session', 'An unmounted editor cannot close a newer editing session');
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 2);
    await release(page, 1);
    await page.waitForSelector('.personal-actions');
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    await page.click('.personal-actions button:nth-child(2)');
    await page.click('button:text-is("确认删除")');
    await requestCount(page, 1);
    assert.ok(await page.evaluate(() => !!document.querySelector('#supplement-panel')), 'Delete also waits for durable completion');
    await release(page, 0, true);
    await page.waitForSelector('.delete-confirmation [role="alert"]');
    await page.click('button:text-is("确认删除")');
    await requestCount(page, 2);
    await release(page, 1);
    await page.waitForFunction(() => !document.querySelector('#supplement-panel'));
    console.log('PASS async personal supplement: explicit save, newer title/body, failure/retry, title-only edit, durable refresh, cancel/reopen/sync save, stale editor completion, delayed delete/retry');
  } finally {
    await page.evaluate(() => {
      delete window.asyncSaveTest;
      const key = Object.keys(localStorage).find((key) => key.startsWith('textbook-personal-v1:'));
      if (key) localStorage.removeItem(key);
    });
    await page.reload();
    await page.waitForSelector('.page-index');
  }
}
