import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readCloudPersonal, replaceMigrationNote, waitForCloudNote } from './check-content-migration.mjs';
import { openNote, jumpToFilePage } from './check-related-return.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const personalKey = `textbook-personal-v1:${book.documentSha256}`;
const sourceKey = `textbook-personal-source-v2:${book.documentSha256}`;
const digest = (text) => createHash('sha256').update(text ?? 'null').digest('hex');
const markerFor = (item) => `[aria-label=${JSON.stringify(`我的补充：${item.title}`)}]`;

async function context(task, result) {
  const url = new URL(result.origin);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port);
  assert.notEqual(result.currentPage, 'p1');
  const response = await fetch(`${url.origin}/__content_migration_check`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).kind, 'reader-content-migration');
  const control = task.page(result.currentPage);
  assert.equal(new URL(await control.url()).origin, url.origin);
  assert.equal(await control.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false, 'Keep the existing QA page draft-free before starting another check');
  const baseline = await readCloudPersonal(control);
  assert.equal(baseline.userId, result.userId, 'Only the disposable QA owner A may be modified');
  const item = baseline.data.supplements.find((value) => value.id === result.fixture.item.id);
  assert.ok(item, 'The migrated personal fixture must still exist');
  return { control, baseline, item, origin: url.origin };
}

async function ownPage(task) {
  const page = await task.newPage();
  assert.notEqual(page.label, 'p1');
  return page;
}

async function ready(page, ctx) {
  assert.equal(new URL(await page.url()).origin, ctx.origin);
  await page.waitForSelector('.page-index');
  await jumpToFilePage(page, ctx.item.page);
  await page.waitForSelector(markerFor(ctx.item));
  assert.equal((await readCloudPersonal(page)).userId, ctx.baseline.userId);
}

async function discardEditor(page) {
  await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'), undefined, { timeout: 30_000 });
  if (!await page.evaluate(() => !!document.querySelector('[data-dirty="true"]'))) return false;
  const personal = await page.evaluate(() => !!document.querySelector('#supplement-panel .personal-title input'));
  await page.click(personal ? '.editor-actions button:text-is("取消")' : 'button[aria-label="关闭解读"]');
  // Accept the application's real discard prompt, then let its cleanup remove
  // beforeunload protection. Do not suppress window.confirm or close a draft.
  await page.acceptDialog();
  await page.waitForFunction(() => !document.querySelector('[data-dirty="true"]'));
  return true;
}

async function closeOwned(page, origin) {
  assert.notEqual(page.label, 'p1');
  const url = await page.url();
  if (url === 'about:blank') { await page.close(); return false; }
  assert.equal(new URL(url).origin, origin);
  const discarded = await discardEditor(page);
  await page.close();
  return discarded;
}

async function installSaveFailure(page) {
  await page.evaluate(() => {
    if (window.contentMigrationFetchFault) throw new Error('A fetch fault is already installed');
    const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    const original = window.fetch;
    const state = { descriptor, original, attempts: 0 };
    window.contentMigrationFetchFault = state;
    Object.defineProperty(window, 'fetch', { configurable: true, writable: true, value(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/rest/v1/rpc/reader_save_personal') {
        state.attempts += 1;
        return Promise.reject(new TypeError('QA reader save fetch failure'));
      }
      return original.call(this, input, init);
    } });
  });
}

async function restoreFetch(page) {
  return page.evaluate(() => {
    const saved = window.contentMigrationFetchFault;
    if (!saved) return 0;
    if (saved.descriptor) Object.defineProperty(window, 'fetch', saved.descriptor);
    else { delete window.fetch; window.fetch = saved.original; }
    delete window.contentMigrationFetchFault;
    return saved.attempts;
  });
}

async function openPersonal(page, item) {
  await jumpToFilePage(page, item.page);
  await page.click(markerFor(item));
  await page.waitForSelector('.personal-actions');
}

async function editPersonal(page, title, markdown) {
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.fill('.personal-title input', title);
  await page.focus('#supplement-panel .markdown-source .cm-content');
  await page.press('#supplement-panel .markdown-source .cm-content', 'ControlOrMeta+a');
  await page.keyboard.insertText(markdown);
}

async function privateCleanup(page, ownerId, original, edited, deleteId) {
  await discardEditor(page);
  return page.evaluate(async ({ ownerId, original, edited, deleteId }) => {
    const { readPersonal, savePersonal } = await import('/src/reader/cloud-personal.ts');
    const current = await readPersonal(ownerId);
    let changed = false;
    const supplements = current.data.supplements.filter((item) => {
      if (item.id === deleteId) { changed = true; return false; }
      return true;
    }).map((item) => {
      if (!original || item.id !== original.id || (item.title === original.title && item.markdown === original.markdown)) return item;
      if (item.title !== edited.title || item.markdown !== edited.markdown) throw new Error('Unexpected fixture edit; targeted cleanup refused to overwrite it');
      changed = true;
      return { ...item, title: original.title, markdown: original.markdown };
    });
    if (changed) await savePersonal({ ...current.data, supplements }, current);
  }, { ownerId, original, edited, deleteId });
}

export async function checkMigratedPersonalMaintenance(task, result) {
  const ctx = await context(task, result);
  const page = await ownPage(task);
  const token = randomUUID();
  const edited = { title: `QA 编辑 ${token}`, markdown: `# QA 已编辑\n\n保存 **${token}** 后刷新。` };
  const deletion = { ...ctx.item, id: `qa-delete-${token}`, title: `QA 删除 ${token}` };
  let attempted = 0;
  try {
    await page.goto(ctx.origin);
    await ready(page, ctx);
    await openPersonal(page, ctx.item);
    await editPersonal(page, edited.title, edited.markdown);
    await installSaveFailure(page);
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.markdown-editor [role="alert"]');
    assert.deepEqual(await page.evaluate(() => ({ title: document.querySelector('.personal-title input').value,
      body: [...document.querySelectorAll('.cm-content .cm-line')].map((line) => line.textContent).join('\n'), dirty: document.querySelector('.markdown-editor').dataset.dirty })),
    { title: edited.title, body: edited.markdown, dirty: 'true' });
    const failed = await readCloudPersonal(page);
    assert.deepEqual(failed.data, ctx.baseline.data);
    assert.equal(failed.revision, ctx.baseline.revision);
    attempted += await restoreFetch(page);
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.personal-actions');
    const changed = (await readCloudPersonal(page)).data.supplements.find((item) => item.id === ctx.item.id);
    assert.deepEqual(changed, { ...ctx.item, ...edited });
    await page.reload();
    await page.waitForSelector('.page-index');
    await jumpToFilePage(page, ctx.item.page);
    await page.waitForSelector(markerFor(changed));
    assert.deepEqual((await readCloudPersonal(page)).data.supplements.find((item) => item.id === ctx.item.id), changed);
    await openPersonal(page, changed);
    await editPersonal(page, ctx.item.title, ctx.item.markdown);
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.personal-actions');
    // Create a separately owned fixture through the real storage operation so
    // the delete check never removes the original migrated node.
    await page.evaluate(async (item) => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { readPersonal, savePersonal } = await import('/src/reader/cloud-personal.ts');
      const { data } = await supabase.auth.getSession();
      const before = await readPersonal(data.session.user.id);
      await savePersonal({ ...before.data, supplements: [...before.data.supplements, item] }, before);
    }, deletion);
    await page.reload();
    await ready(page, ctx);
    await openPersonal(page, deletion);
    await page.click('.personal-actions button:text-is("删除补充")');
    await installSaveFailure(page);
    await page.click('.delete-confirmation button:text-is("确认删除")');
    await page.waitForSelector('.delete-confirmation [role="alert"]');
    assert.ok((await readCloudPersonal(page)).data.supplements.some((item) => item.id === deletion.id));
    assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel')), true);
    attempted += await restoreFetch(page);
    await page.click('.delete-confirmation button:text-is("确认删除")');
    await page.waitForFunction(() => !document.querySelector('#supplement-panel'));
    const after = await readCloudPersonal(page);
    assert.equal(after.data.supplements.some((item) => item.id === deletion.id), false);
    assert.deepEqual(after.data.supplements.find((item) => item.id === ctx.item.id), ctx.item);
    assert.ok(attempted >= 2, 'Both failed mutations must reach the native fetch fault');
    return { createdPages: [page.label], closedPages: [page.label], migratedId: ctx.item.id,
      editSaveFailureRetainedDraft: true, realSaveRetry: true, refreshPreservedIdPageRegionMarkdown: true,
      deleteFailurePreservedNode: true, deleteRetrySucceeded: true, originalFixtureRestored: true, failedFetchAttempts: attempted };
  } finally {
    await restoreFetch(page);
    try {
      if (new URL(await page.url()).origin === ctx.origin) await privateCleanup(page, result.userId, ctx.item, edited, deletion.id);
    } finally { await closeOwned(page, ctx.origin); }
  }
}

export async function checkStaleCloudNote(task, result) {
  const ctx = await context(task, result);
  const writer = ctx.control;
  const stale = await ownPage(task);
  const original = ctx.baseline.data.notes[result.fixture.noteId];
  assert.equal(typeof original, 'string');
  const latest = `QA newest cloud ${randomUUID()}`;
  const draft = `QA stale latest draft ${randomUUID()}`;
  let discarded = false;
  try {
    await writer.reload();
    await ready(writer, ctx);
    await openNote(writer, result.fixture.noteId);
    await stale.goto(ctx.origin);
    await ready(stale, ctx);
    await openNote(stale, result.fixture.noteId);
    await replaceMigrationNote(writer, latest);
    const saved = await waitForCloudNote(writer, result.fixture.noteId, latest);
    await replaceMigrationNote(stale, draft);
    await stale.waitForSelector('.personal-note [role="alert"]');
    await stale.waitForFunction(() => !document.querySelector('[data-saving="true"]'));
    const rejected = await stale.evaluate(() => ({ draft: document.querySelector('.personal-note .cm-content').textContent,
      dirty: document.querySelector('.personal-note .markdown-editor').dataset.dirty,
      error: document.querySelector('.personal-note [role="alert"]').textContent }));
    assert.equal(rejected.draft, draft);
    assert.equal(rejected.dirty, 'true');
    assert.ok(rejected.error.trim(), 'The rejected stale write must explain the failure');
    const current = await readCloudPersonal(stale);
    assert.equal(current.data.notes[result.fixture.noteId], latest);
    assert.equal(current.revision, saved.revision);
    discarded = await discardEditor(stale);
    return { createdPages: [stale.label], closedPages: [stale.label], staleWriteRejected: true,
      latestDraftRetained: true, cloudValueAndRevisionUnchanged: true, actualDiscardPrompt: discarded };
  } finally {
    await closeOwned(stale, ctx.origin);
    await discardEditor(writer);
    await writer.reload();
    await ready(writer, ctx);
    await openNote(writer, result.fixture.noteId);
    await replaceMigrationNote(writer, original);
    await waitForCloudNote(writer, result.fixture.noteId, original);
  }
}

export async function checkConflictHttp(task, result) {
  const ctx = await context(task, result);
  const response = await ctx.control.evaluate(async ({ ownerId, bookId }) => {
    const { supabase } = await import('/src/reader/supabase.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const before = await readPersonal(ownerId);
    const content = structuredClone(before.data);
    content.notes['qa-rejected-conflict-probe'] = 'This stale write must be rejected';
    const start = performance.now();
    const { status, error } = await supabase.rpc('reader_save_personal', {
      p_book_id: bookId, p_owner_id: ownerId, p_expected_revision: before.revision - 1, p_content: content,
    }).abortSignal(AbortSignal.timeout(12_000));
    const after = await readPersonal(ownerId);
    return { status, code: error?.code, milliseconds: Math.round(performance.now() - start),
      unchanged: JSON.stringify(before) === JSON.stringify(after) };
  }, { ownerId: result.userId, bookId: book.documentSha256 });
  assert.equal(response.status, 409, 'A stale revision must return HTTP 409 within the bounded request');
  assert.equal(response.code, 'PT409');
  assert.equal(response.unchanged, true);
  return response;
}

export async function checkCloudSaveFailure(task, result) {
  const ctx = await context(task, result);
  const page = await ownPage(task);
  const original = ctx.baseline.data.notes[result.fixture.noteId];
  assert.equal(typeof original, 'string');
  const draft = `QA newest failed fetch draft ${randomUUID()}`;
  let attempted = 0;
  try {
    await page.goto(ctx.origin);
    await ready(page, ctx);
    await openNote(page, result.fixture.noteId);
    await installSaveFailure(page);
    await replaceMigrationNote(page, `QA earlier failed fetch ${randomUUID()}`);
    await page.waitForSelector('.personal-note [role="alert"]');
    await replaceMigrationNote(page, draft);
    await page.waitForFunction((text) => document.querySelector('.personal-note .cm-content')?.textContent === text &&
      !!document.querySelector('.personal-note [role="alert"]') && !document.querySelector('[data-saving="true"]'), draft, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => document.querySelector('.personal-note .markdown-editor').dataset.dirty), 'true');
    const failed = await readCloudPersonal(page);
    assert.deepEqual(failed.data, ctx.baseline.data);
    assert.equal(failed.revision, ctx.baseline.revision);
    attempted = await restoreFetch(page);
    assert.ok(attempted >= 2);
    await page.click('.note-retry');
    const saved = await waitForCloudNote(page, result.fixture.noteId, draft);
    assert.equal(saved.revision, failed.revision + 1);
    await replaceMigrationNote(page, original);
    await waitForCloudNote(page, result.fixture.noteId, original);
    return { createdPages: [page.label], closedPages: [page.label], failedFetchAttempts: attempted,
      latestDraftRetained: true, failedWritesLeftCloudUnchanged: true, realRetryPersisted: true, originalNoteRestored: true };
  } finally {
    await restoreFetch(page);
    try {
      if (new URL(await page.url()).origin === ctx.origin) {
        await discardEditor(page);
        // A failed assertion can still leave a successful QA draft in the cloud.
        await page.evaluate(async ({ ownerId, noteId, original, draft }) => {
          const { readPersonal, savePersonal } = await import('/src/reader/cloud-personal.ts');
          const current = await readPersonal(ownerId);
          if (current.data.notes[noteId] === draft) await savePersonal({ ...current.data, notes: { ...current.data.notes, [noteId]: original } }, current);
        }, { ownerId: result.userId, noteId: result.fixture.noteId, original, draft });
      }
    } finally { await closeOwned(page, ctx.origin); }
  }
}

function startupFaultSource(origin, kind, savedSource) {
  return `(() => {
    if (location.origin !== ${JSON.stringify(origin)}) return;
    const key = ${JSON.stringify(personalKey)}, sourceKey = ${JSON.stringify(sourceKey)};
    const get = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    const set = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    const state = {get, set, originalSource: ${JSON.stringify(savedSource)}, attempts: 0, removed: false};
    window.contentMigrationStorageFault = state;
    if (${JSON.stringify(kind)} === 'quota') {
      if (get.value.call(localStorage, sourceKey) !== state.originalSource) throw new Error('Migration source changed before fault setup');
      localStorage.removeItem(sourceKey); state.removed = true;
      Object.defineProperty(Storage.prototype, 'setItem', {...set, value(key, value) {
        if (this === localStorage && key === sourceKey) { state.attempts++; throw new DOMException('QA source identity quota failure', 'QuotaExceededError'); }
        return set.value.call(this, key, value);
      }});
    } else Object.defineProperty(Storage.prototype, 'getItem', {...get, value(name) {
      if (this === localStorage && name === key) { state.attempts++; throw new DOMException('QA legacy read failure', 'SecurityError'); }
      return get.value.call(this, name);
    }});
  })();`;
}

async function restoreStartupFault(page, identifier, origin) {
  try {
    if (identifier) await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  } finally {
    await page.evaluate(({ origin, sourceKey }) => {
      if (location.origin !== origin) return;
      const state = window.contentMigrationStorageFault;
      if (!state) return;
      Object.defineProperty(Storage.prototype, 'getItem', state.get);
      Object.defineProperty(Storage.prototype, 'setItem', state.set);
      if (state.removed) state.set.value.call(localStorage, sourceKey, state.originalSource);
      delete window.contentMigrationStorageFault;
    }, { origin, sourceKey });
  }
}

export async function checkStartupStorageFailure(task, result, { kind = 'read' } = {}) {
  assert.ok(kind === 'read' || kind === 'quota');
  const ctx = await context(task, result);
  const owned = await ctx.control.evaluate(({ personalKey, sourceKey }) => ({ raw: localStorage.getItem(personalKey), source: localStorage.getItem(sourceKey) }), { personalKey, sourceKey });
  assert.equal(JSON.parse(owned.source).ownerId, result.userId, 'Only the owned QA source identity may be removed temporarily');
  const page = await ownPage(task);
  let identifier;
  let attempts = 0;
  try {
    const script = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: startupFaultSource(ctx.origin, kind, owned.source) });
    identifier = script.identifier;
    try {
      await page.goto(ctx.origin);
      await page.waitForSelector('.storage-error[role="alert"]');
      const preserved = await page.evaluate(({ personalKey, sourceKey }) => {
        const state = window.contentMigrationStorageFault;
        if (!state) throw new Error('The startup fault did not run');
        return { raw: state.get.value.call(localStorage, personalKey), source: state.get.value.call(localStorage, sourceKey), attempts: state.attempts,
          error: document.querySelector('.storage-error[role="alert"]').textContent };
      }, { personalKey, sourceKey });
      assert.ok(preserved.attempts > 0);
      assert.ok(preserved.error.trim(), 'The startup failure must be visible');
      assert.equal(preserved.raw, owned.raw);
      assert.equal(preserved.source, kind === 'quota' ? null : owned.source);
      const failed = await readCloudPersonal(page);
      assert.deepEqual(failed.data, ctx.baseline.data);
      assert.equal(failed.revision, ctx.baseline.revision);
      assert.deepEqual(failed.copies, ctx.baseline.copies);
      attempts = preserved.attempts;
    } finally {
      const remove = identifier;
      identifier = undefined;
      await restoreStartupFault(page, remove, ctx.origin);
    }
    await page.click('.storage-error button:text-is("重新读取")');
    await ready(page, ctx);
    const retried = await readCloudPersonal(page);
    assert.deepEqual(retried.data, ctx.baseline.data);
    assert.equal(retried.revision, ctx.baseline.revision);
    assert.deepEqual(retried.copies, ctx.baseline.copies);
    assert.deepEqual(await page.evaluate(({ personalKey, sourceKey }) => ({ raw: localStorage.getItem(personalKey), source: localStorage.getItem(sourceKey) }), { personalKey, sourceKey }), owned);
    return { kind, createdPages: [page.label], closedPages: [page.label], faultAttempts: attempts,
      originalRawSha256: digest(owned.raw), cloudContentsAndRevisionPreserved: true, sourceIdentityRestoredExactly: true, realRetrySucceeded: true };
  } finally {
    try { if (identifier) await restoreStartupFault(page, identifier, ctx.origin); }
    finally { await closeOwned(page, ctx.origin); }
  }
}

export async function checkContentMigrationExtras(task, result) {
  return {
    conflictHttp: await checkConflictHttp(task, result),
    personal: await checkMigratedPersonalMaintenance(task, result),
    staleNote: await checkStaleCloudNote(task, result),
    fetchFailure: await checkCloudSaveFailure(task, result),
    readFailure: await checkStartupStorageFailure(task, result, { kind: 'read' }),
    quotaFailure: await checkStartupStorageFailure(task, result, { kind: 'quota' }),
  };
}
