import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openNote } from './check-related-return.mjs';

async function assertAsyncServer(testOrigin) {
  const response = await fetch(new URL('/__async_save_check', testOrigin));
  assert.equal(response.status, 200, 'Use startAsyncSaveServer(), not the user acceptance server');
  assert.equal((await response.json()).kind, 'reader-async-cloud-save');
}

// Call on the JSON marker page before loading the app or signing in.
export async function assertUnusedAsyncOrigin(page, { testOrigin } = {}) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  assert.equal(new URL(await page.url()).origin, new URL(testOrigin).origin);
  await assertAsyncServer(testOrigin);
  await page.evaluate(() => {
    if (localStorage.length !== 0) {
      throw new Error('This origin has existing personal content or login data. Use another origin; nothing was cleared.');
    }
  });
}

async function readCloud(page, expectedUserId) {
  const snapshot = await page.evaluate(async () => {
    const [{ supabase }, { readPersonal }] = await Promise.all([
      import('/src/reader/supabase.ts'), import('/src/reader/cloud-personal.ts'),
    ]);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error('Sign in to the dedicated QA account before running async-save checks');
    // The read RPC verifies the session owner on the server.
    return readPersonal(data.session.user.id);
  });
  if (expectedUserId) assert.equal(snapshot.userId, expectedUserId, 'The QA account must not change during a check');
  return snapshot;
}

async function prepareCloudCheck(page, testOrigin) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  assert.equal(new URL(await page.url()).origin, new URL(testOrigin).origin);
  await assertAsyncServer(testOrigin);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
  return readCloud(page);
}

async function rememberConfirm(page) {
  await page.evaluate(() => {
    if (window.asyncSaveCleanup || window.asyncSaveTest) throw new Error('An async-save check is already active');
    window.asyncSaveCleanup = { confirm: window.confirm };
  });
}

async function reloadReader(page, continueCheck = false) {
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false, 'Close dirty editors through the UI before reload');
  await page.evaluate(() => {
    if (window.asyncSaveCleanup) window.confirm = window.asyncSaveCleanup.confirm;
    delete window.asyncSaveCleanup;
    delete window.asyncSaveTest;
    delete window.asyncSaveConfirm;
  });
  await page.reload();
  await page.waitForSelector('.page-index');
  if (continueCheck) await rememberConfirm(page);
}

async function finishCloudCheck(page, before, noteIds = [], supplementIds = []) {
  let writesSettled = false;
  try {
    await page.evaluate(() => {
      const test = window.asyncSaveTest;
      if (test) {
        test.failAll = true;
        for (const request of test.requests) request.release(true);
      }
      // This confirmation applies only to this check's draft on its own origin.
      window.confirm = () => true;
    });
    await page.waitForFunction(() => !document.querySelector('[data-saving="true"]') &&
      (!window.asyncSaveTest || window.asyncSaveTest.requests.every((request) => request.settled)));
    writesSettled = true;
    if (await page.evaluate(() => !!document.querySelector('button[aria-label="关闭解读"]'))) {
      await page.click('button[aria-label="关闭解读"]');
    } else {
      if (await page.evaluate(() => !!document.querySelector('#supplement-panel .editor-actions'))) {
        await page.click('#supplement-panel .editor-actions button:nth-child(2)');
        await page.waitForFunction(() => !document.querySelector('#supplement-panel .editor-actions'));
      }
      if (await page.evaluate(() => !!document.querySelector('#supplement-panel .heading-actions button:last-child'))) {
        await page.click('#supplement-panel .heading-actions button:last-child');
      }
    }
    await page.waitForFunction(() => !document.querySelector('[data-dirty="true"]'));
    await page.evaluate(async ({ userId, notes, supplementIds }) => {
      // Disable deferral only after pending test writes and their editors settle.
      delete window.asyncSaveTest;
      const [{ supabase }, { readPersonal, savePersonal }] = await Promise.all([
        import('/src/reader/supabase.ts'), import('/src/reader/cloud-personal.ts'),
      ]);
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.user.id !== userId) throw new Error('QA account changed; cleanup will not write to another account');
        const previous = await readPersonal(userId);
        const next = structuredClone(previous.data);
        for (const note of notes) {
          if (note.exists) next.notes[note.id] = note.value;
          else delete next.notes[note.id];
        }
        next.supplements = next.supplements.filter((item) => !supplementIds.includes(item.id));
        if (JSON.stringify(next) === JSON.stringify(previous.data)) return;
        try { await savePersonal(next, previous); return; }
        catch (cause) {
          // Re-read on a genuine revision conflict; never restore a stale document.
          if (!['PT409', '40001'].includes(cause?.cause?.code) || attempt === 2) throw cause;
        }
      }
    }, {
      userId: before.userId,
      notes: noteIds.map((id) => ({ id, exists: Object.hasOwn(before.data.notes, id), value: before.data.notes[id] ?? null })),
      supplementIds,
    });
  } finally {
    await page.evaluate((writesSettled) => {
      if (window.asyncSaveCleanup) window.confirm = window.asyncSaveCleanup.confirm;
      delete window.asyncSaveCleanup;
      // Keep rejecting queued writes if an in-flight request did not settle.
      if (writesSettled) delete window.asyncSaveTest;
      delete window.asyncSaveConfirm;
    }, writesSettled);
  }
  await reloadReader(page);
}

async function replaceNote(page, text) {
  if (await page.evaluate(() => document.querySelector('.note-mode-toggle').getAttribute('aria-pressed') === 'true')) await page.click('.note-mode-toggle');
  await page.focus('.personal-note .cm-content');
  await page.press('.personal-note .cm-content', 'ControlOrMeta+a');
  if (text) await page.keyboard.insertText(text);
  else await page.press('.personal-note .cm-content', 'Backspace');
}

async function savedNote(page, id, expected) {
  await page.waitForFunction(() => !document.querySelector('.personal-note [data-dirty="true"]'));
  const snapshot = await readCloud(page);
  assert.equal(snapshot.data.notes[id] ?? null, expected, 'The clean editor must match durable cloud content');
}

async function withEmptyNotes(page, ids, { testOrigin } = {}, run) {
  const before = await prepareCloudCheck(page, testOrigin);
  for (const id of ids) assert.ok(!before.data.notes[id]?.trim(), `Test source already has a note: ${id}`);
  await rememberConfirm(page);
  try { await run(); }
  finally { await finishCloudCheck(page, before, ids); }
}

// Dedicated Vite server: defer the real storage function without adding a test
// hook to application code. Each release either writes normally or rejects.
export async function startAsyncSaveServer(port = 5181) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    cacheDir: `node_modules/.vite-async-save-${port}`,
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{
      name: 'async-save-browser-check', enforce: 'pre',
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/__async_save_check') return next();
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ kind: 'reader-async-cloud-save' }));
        });
      },
      transform(source, id) {
        if (!id.endsWith('/src/reader/cloud-personal.ts')) return;
        assert.ok(source.includes('export async function savePersonal('));
        return source.replace('export async function savePersonal(', 'async function savePersonalReal(') + `
export function savePersonal(...args: Parameters<typeof savePersonalReal>): ReturnType<typeof savePersonalReal> {
  const test = (window as any).asyncSaveTest;
  if (!test) return savePersonalReal(...args);
  if (test.failAll) return Promise.reject(new Error('Test cleanup'));
  return new Promise<Awaited<ReturnType<typeof savePersonalReal>>>((resolve, reject) => {
    const request = { data: args[0], released: false, settled: false, release(fail = false) {
      if (request.released) return;
      request.released = true;
      if (fail) {
        request.settled = true;
        reject(new Error('Delayed save failed'));
        return;
      }
      return savePersonalReal(...args).then((value) => {
        request.settled = true;
        resolve(value);
      }, (cause) => {
        request.settled = true;
        reject(cause);
      });
    }};
    test.requests.push(request);
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
      await page.evaluate(() => { window.confirm = window.asyncSaveTest?.confirm ?? window.confirm; });
    }
  });
}

export async function checkAsyncPersonalSave(page, { testOrigin } = {}) {
  const before = await prepareCloudCheck(page, testOrigin);
  assert.ok(!before.data.supplements.some((item) => ['QA async title', 'Newer title', 'Final title'].includes(item.title)), 'QA titles must not already exist');
  const createdIds = [];
  let phase = 'create and hold first save';
  await rememberConfirm(page);
  try {
    await page.click('#add-personal-supplement');
    await page.press('.region-selector', 'Enter');
    await page.fill('.personal-title input', 'QA async title');
    await page.focus('.markdown-source .cm-content');
    await page.keyboard.insertText('First personal body');
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 1);
    const createdId = await page.evaluate(() => window.asyncSaveTest.requests[0].data.supplements.find((item) => item.title === 'QA async title')?.id);
    assert.ok(createdId && !before.data.supplements.some((item) => item.id === createdId), 'Track only the node created by this check');
    createdIds.push(createdId);
    assert.equal(await page.evaluate(() => document.querySelector('.editor-actions button[type="submit"]').disabled), true);
    await page.fill('.personal-title input', 'Newer title');
    await page.press('.markdown-source .cm-content', 'ControlOrMeta+a');
    await page.keyboard.insertText('Newer body');
    await release(page, 0);
    phase = 'first success keeps newer edit';
    await page.waitForFunction(() => !document.querySelector('.editor-actions button[type="submit"]').disabled);
    assert.deepEqual(await page.evaluate(() => ({
      title: document.querySelector('.personal-title input')?.value,
      body: document.querySelector('.cm-content')?.textContent,
      dirty: document.querySelector('.markdown-editor')?.dataset.dirty,
    })), { title: 'Newer title', body: 'Newer body', dirty: 'true' }, 'Old success retains newer title/body');
    await page.click('.editor-actions button[type="submit"]');
    phase = 'second request failure';
    await requestCount(page, 2);
    await release(page, 1, true);
    await page.waitForSelector('.markdown-editor [role="alert"]');
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), 'Newer body');
    await page.click('.editor-actions button[type="submit"]');
    phase = 'retry keeps title-only edit';
    await requestCount(page, 3);
    // A title-only change must also prevent old completion from closing editing.
    await page.fill('.personal-title input', 'Final title');
    await release(page, 2);
    await page.waitForFunction(() => !document.querySelector('.editor-actions button[type="submit"]').disabled);
    assert.equal(await page.evaluate(() => document.querySelector('.personal-title input')?.value), 'Final title');
    await page.click('.editor-actions button[type="submit"]');
    phase = 'save final title';
    await requestCount(page, 4);
    await release(page, 3);
    await page.waitForSelector('.personal-actions');
    assert.equal(await page.evaluate(() => document.querySelector('#supplement-title').textContent), 'Final title');
    await page.click('#supplement-panel .heading-actions button:text-is("关闭")');
    assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel')), false);
    await reloadReader(page, true);
    phase = 'reload saved supplement';
    await page.click('[aria-label="我的补充：Final title"]');
    assert.equal(await page.evaluate(() => document.querySelector('#supplement-panel .markdown-content').textContent), 'Newer body');
    await page.click('.personal-actions button:first-child');
    phase = 'cancel title edit and save again';
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
    assert.equal(await page.evaluate(() => document.querySelector('#supplement-title').textContent), 'Final title', 'Canceling a title edit does not prevent a later un-deferred save from closing editing');
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    phase = 'close and reopen with old request pending';
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
      await page.click('#supplement-panel .heading-actions button:text-is("关闭")');
    } finally {
      await page.evaluate(() => { window.confirm = window.asyncSaveConfirm; delete window.asyncSaveConfirm; });
    }
    await page.click('[aria-label="我的补充：Final title"]');
    await page.click('.personal-actions button:first-child');
    await page.press('.cm-content', 'ControlOrMeta+a');
    await page.keyboard.insertText('New editing session');
    await release(page, 0);
    phase = 'old editor completion keeps new editing session';
    const stored = await readCloud(page, before.userId);
    assert.equal(stored.data.supplements.find((item) => item.id === createdId)?.markdown, 'Older pending body', 'Released saves must reach the real cloud record');
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content')?.textContent), 'New editing session', 'An unmounted editor cannot close a newer editing session');
    await page.click('.editor-actions button[type="submit"]');
    await requestCount(page, 2);
    await release(page, 1);
    await page.waitForSelector('.personal-actions');
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    phase = 'delete failure and retry';
    await page.click('.personal-actions button:nth-child(2)');
    await page.click('button:text-is("确认删除")');
    await requestCount(page, 1);
    assert.ok(await page.evaluate(() => !!document.querySelector('#supplement-panel')), 'Delete also waits for durable completion');
    await release(page, 0, true);
    await page.waitForSelector('.delete-confirmation [role="alert"]');
    await page.click('button:text-is("确认删除")');
    await requestCount(page, 2);
    await release(page, 1);
    await page.waitForFunction((id) => !!document.querySelector('.personal-library') &&
      !document.querySelector(`[data-personal-id="${id}"]`), createdId);
    assert.equal((await readCloud(page, before.userId)).data.supplements.some((item) => item.id === createdId), false, 'Successful retry deletes the durable record before returning to the list');
    console.log('PASS async personal supplement: explicit save, newer title/body, failure/retry, title-only edit, durable cloud refresh, cancel/reopen/save, stale editor completion, delayed delete/retry');
  } catch (cause) {
    const state = await page.evaluate(() => ({ requests: window.asyncSaveTest?.requests.map((request) => ({ released: request.released, settled: request.settled })),
      editing: !!document.querySelector('.personal-title input'), dirty: !!document.querySelector('[data-dirty="true"]'), saving: !!document.querySelector('[data-saving="true"]') }));
    throw new Error(`Async personal check at ${phase}: ${JSON.stringify(state)}`, { cause });
  } finally {
    await finishCloudCheck(page, before, [], createdIds);
  }
}

// Focused durable delete/retry branch, without replaying the save/edit journey.
export async function checkAsyncPersonalDelete(page, { testOrigin } = {}) {
  const before = await prepareCloudCheck(page, testOrigin);
  const title = 'QA async delete retry';
  assert.equal(before.data.supplements.some((item) => item.title === title), false);
  const createdIds = [];
  await rememberConfirm(page);
  try {
    await page.click('#add-personal-supplement');
    await page.press('.region-selector', 'Enter');
    await page.fill('.personal-title input', title);
    await page.focus('.cm-content'); await page.keyboard.insertText('QA durable delete body');
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.personal-actions');
    const item = (await readCloud(page, before.userId)).data.supplements.find((item) => item.title === title);
    assert.ok(item); createdIds.push(item.id);
    await page.evaluate(() => { window.asyncSaveTest = { requests: [] }; });
    await page.click('.personal-actions button:nth-child(2)');
    await page.click('button:text-is("确认删除")');
    await requestCount(page, 1); await release(page, 0, true);
    await page.waitForSelector('.delete-confirmation [role="alert"]');
    assert.equal((await readCloud(page, before.userId)).data.supplements.some((value) => value.id === item.id), true);
    await page.click('button:text-is("确认删除")');
    await requestCount(page, 2); await release(page, 1);
    await page.waitForFunction((id) => !!document.querySelector('.personal-library') && !document.querySelector(`[data-personal-id="${id}"]`), item.id);
    assert.equal((await readCloud(page, before.userId)).data.supplements.some((value) => value.id === item.id), false);
    return { failedDeleteRetainedDurableRecord: true, retryRemovedDurableRecord: true, returnedToUsableLibrary: true, deletedEntryAbsent: true };
  } finally { await finishCloudCheck(page, before, [], createdIds); }
}
