import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startContentMigrationServer, readCloudPersonal, replaceMigrationNote, waitForCloudNote } from './check-content-migration.mjs';
import { openNote, jumpToFilePage } from './check-related-return.mjs';
import { openShelfReader } from './check-bookshelf.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const personalKey = `textbook-personal-v1:${book.documentSha256}`;
const sourceKey = `textbook-personal-source-v2:${book.documentSha256}`;
const readingKey = `textbook-reading-v1:${book.documentSha256}`;
const defaultOrigin = 'http://127.0.0.1:5194';
const markerFor = (item) => `[aria-label=${JSON.stringify(`我的补充：${item.title}`)}]`;

export function startContentAuthServer({ port = 5194, legacyDir } = {}) {
  return startContentMigrationServer({ port, legacyDir });
}

async function checkOrigin(origin) {
  const url = new URL(origin);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port && url.pathname === '/' && !url.search && !url.hash,
    'Use an exact local dedicated origin');
  const response = await fetch(`${url.origin}/__content_migration_check`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).kind, 'reader-content-migration', 'Start a marked isolated test server first');
  return url.origin;
}

async function ownPage(task, created, protectedPages) {
  const page = await task.newPage();
  assert.equal(protectedPages.has(page.label), false, 'Only newly owned pages may be operated');
  created.push(page.label);
  return page;
}

async function emptyOriginPage(task, origin, created, protectedPages) {
  for (const tab of await task.tabs()) {
    if (tab.url?.startsWith('http')) assert.notEqual(new URL(tab.url).origin, origin, 'The isolated auth origin already has a page');
  }
  const page = await ownPage(task, created, protectedPages);
  try {
    await page.goto(`${origin}/__content_migration_check`);
    assert.equal(new URL(await page.url()).origin, origin);
    assert.equal(await page.evaluate(() => localStorage.length), 0, 'Use an empty isolated origin; existing storage is preserved');
  } catch (cause) { await page.close(); throw cause; }
  return page;
}

async function discardEditor(page) {
  await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'), undefined, { timeout: 30_000 });
  if (!await page.evaluate(() => !!document.querySelector('[data-dirty="true"]'))) return false;
  const personal = await page.evaluate(() => !!document.querySelector('#supplement-panel .personal-title input'));
  await page.click(personal ? '.editor-actions button:text-is("取消")' : 'button[aria-label="关闭解读"]');
  await page.acceptDialog();
  await page.waitForFunction(() => !document.querySelector('[data-dirty="true"]'));
  return true;
}

async function disposeIsolatedPage(page, origin) {
  if (await page.url() === 'about:blank') { await page.close(); return; }
  assert.equal(new URL(await page.url()).origin, origin);
  await discardEditor(page);
  await page.evaluate(async () => {
    const { supabase } = await import('/src/reader/supabase.ts');
    await supabase.auth.stopAutoRefresh();
  });
  // Dispose the app before removing only keys created on this empty test origin.
  // Do not sign A out: its borrowed QA session is also used on the main origin.
  await page.goto(`${origin}/__content_migration_check`);
  await page.evaluate(({ personalKey, sourceKey, readingKey }) => {
    for (const key of Object.keys(localStorage)) {
      if ([personalKey, sourceKey, readingKey, 'textbook-shelf-v1', 'textbook-startup-v1'].includes(key) || /^sb-[A-Za-z0-9_-]+-auth-token(?:$|-)/.test(key)) localStorage.removeItem(key);
    }
  }, { personalKey, sourceKey, readingKey });
  await page.close();
}

async function setSession(page, session, expectedId) {
  const userId = await page.evaluate(async (session) => {
    const { supabase } = await import('/src/reader/supabase.ts');
    const { data, error } = await supabase.auth.setSession(session);
    if (error || !data.user) throw new Error('Could not restore the disposable QA session');
    return data.user.id;
  }, session);
  assert.equal(userId, expectedId);
}

async function signInB(page, credentials) {
  return page.evaluate(async (credentials) => {
    const { supabase } = await import('/src/reader/supabase.ts');
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error || !data.user) throw new Error('The disposable QA B password login failed');
    return data.user.id;
  }, credentials);
}

async function waitAccount(page, userId) {
  await page.waitForFunction(async (expected) => {
    const { supabase } = await import('/src/reader/supabase.ts');
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id === expected && document.querySelector('.account-email')?.textContent === data.session.user.email;
  }, userId, { timeout: 30_000 });
}

async function holdAResponse(page, ownerId, noteId, expectedNote) {
  await page.evaluate(({ ownerId, noteId, expectedNote }) => {
    if (window.contentAuthFetch) throw new Error('An auth fetch check is already installed');
    const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    const original = window.fetch;
    const state = { descriptor, original, captured: false, released: false, ready: false, error: '', events: [] };
    state.release = () => { state.released = true; state.resolve?.(); };
    window.contentAuthFetch = state;
    Object.defineProperty(window, 'fetch', { configurable: true, writable: true, async value(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname !== '/rest/v1/rpc/reader_save_personal') return original.call(this, input, init);
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : await input.clone().text());
      const headers = new Headers(init?.headers ?? input.headers);
      const encoded = (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').split('.')[1];
      const base64 = encoded?.replace(/-/g, '+').replace(/_/g, '/');
      let subject;
      try { subject = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))).sub; }
      catch { throw new Error('The QA save request has no readable authenticated subject'); }
      const event = { ownerId: body.p_owner_id, subject, status: null };
      state.events.push(event);
      const hold = !state.captured;
      if (hold) {
        state.captured = true;
        if (subject !== ownerId || body.p_owner_id !== ownerId || body.p_content?.notes?.[noteId] !== expectedNote) {
          state.error = 'The delayed request was not formed for QA A';
          throw new Error(state.error);
        }
      }
      const response = await original.call(this, input, init);
      event.status = response.status;
      if (!hold) return response;
      const result = await response.clone().json();
      if (!response.ok || result.owner_id !== ownerId || result.content?.notes?.[noteId] !== expectedNote) {
        state.error = 'The real QA A save did not succeed before the delay';
        throw new Error(state.error);
      }
      state.ready = true;
      if (!state.released) await new Promise((resolve) => { state.resolve = resolve; });
      return response;
    } });
  }, { ownerId, noteId, expectedNote });
}

async function releaseAResponse(page, restore = false) {
  return page.evaluate((restore) => {
    const state = window.contentAuthFetch;
    if (!state) return [];
    state.release();
    const events = state.events.map((event) => ({ ...event }));
    if (restore) {
      if (state.descriptor) Object.defineProperty(window, 'fetch', state.descriptor);
      else { delete window.fetch; window.fetch = state.original; }
      delete window.contentAuthFetch;
    }
    return events;
  }, restore);
}

// The isolated server must already be running. A's session is borrowed through
// a newly owned neutral page; no existing page is read, clicked or navigated.
export async function checkContentAuth(task, result, credentialsB, { testOrigin = defaultOrigin, returnToShelf = false } = {}) {
  assert.ok(credentialsB?.email && credentialsB?.password, 'Supply disposable QA B credentials');
  const origin = await checkOrigin(testOrigin);
  const sourceOrigin = await checkOrigin(result.origin);
  assert.notEqual(origin, sourceOrigin, 'Auth changes need an isolated origin to protect the existing pages');
  const protectedPages = new Set((await task.pages()).map((page) => page.label));
  const created = [];
  let source;
  let page;
  let borrowed;
  let baselineA;
  let baselineB;
  let ownerB;
  let prepared = false;
  const token = randomUUID();
  const ownNode = { ...result.fixture.item, id: `qa-auth-a-${token}`, title: `QA A 私有 ${token}`, markdown: `A-only ${token}` };
  const ownNoteId = `qa-auth-note-${token}`;
  const ownNote = `A-only note ${token}`;
  const delayed = `QA A delayed ${token}`;
  const recovered = `QA A recovered ${token}`;
  let evidence;
  try {
    source = await ownPage(task, created, protectedPages);
    await source.goto(`${sourceOrigin}/__content_migration_check`);
    borrowed = await source.evaluate(async ({ personalKey, sourceKey }) => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error('The main QA A session is unavailable');
      await supabase.auth.stopAutoRefresh();
      return { userId: data.session.user.id, email: data.session.user.email,
        session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
        legacy: localStorage.getItem(personalKey), source: localStorage.getItem(sourceKey) };
    }, { personalKey, sourceKey });
    assert.equal(borrowed.userId, result.userId);
    assert.equal(JSON.parse(borrowed.source).ownerId, result.userId);
    page = await emptyOriginPage(task, origin, created, protectedPages);
    await page.evaluate(({ personalKey, sourceKey, legacy, source }) => {
      if (legacy !== null) localStorage.setItem(personalKey, legacy);
      localStorage.setItem(sourceKey, source);
    }, { personalKey, sourceKey, legacy: borrowed.legacy, source: borrowed.source });
    await setSession(page, borrowed.session, result.userId);
    baselineA = await readCloudPersonal(page);
    await page.evaluate(async ({ ownerId, ownNode, ownNoteId, ownNote }) => {
      const { readPersonal, savePersonal } = await import('/src/reader/cloud-personal.ts');
      const before = await readPersonal(ownerId);
      if (before.data.supplements.some((item) => item.id === ownNode.id) || ownNoteId in before.data.notes) throw new Error('QA fixture identity collision');
      await savePersonal({ ...before.data, supplements: [...before.data.supplements, ownNode], notes: { ...before.data.notes, [ownNoteId]: ownNote } }, before);
    }, { ownerId: result.userId, ownNode, ownNoteId, ownNote });
    prepared = true;
    ownerB = await signInB(page, credentialsB);
    assert.notEqual(ownerB, result.userId);
    baselineB = await readCloudPersonal(page);
    await page.evaluate(async () => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw new Error('Could not revoke the temporary QA B baseline session');
    });
    await setSession(page, borrowed.session, result.userId);
    await page.goto(origin);
    await openShelfReader(page);
    await jumpToFilePage(page, ownNode.page);
    await page.waitForSelector(markerFor(ownNode));
    await openNote(page, result.fixture.noteId);
    await holdAResponse(page, result.userId, result.fixture.noteId, delayed);
    await replaceMigrationNote(page, delayed);
    await page.waitForFunction(() => window.contentAuthFetch.ready || !!window.contentAuthFetch.error, undefined, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.contentAuthFetch.error), '');
    assert.equal(await page.evaluate(() => document.querySelector('.personal-note .markdown-editor').dataset.saving), 'true');
    assert.equal(await signInB(page, credentialsB), ownerB);
    await waitAccount(page, ownerB);
    await releaseAResponse(page);
    await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'), undefined, { timeout: 30_000 });
    const held = await page.evaluate(() => ({ draft: document.querySelector('.personal-note .cm-content')?.textContent,
      dirty: document.querySelector('.personal-note .markdown-editor')?.dataset.dirty,
      error: document.querySelector('.personal-note [role="alert"]')?.textContent ?? document.querySelector('.storage-error[role="alert"]')?.textContent }));
    assert.equal(held.draft, delayed, 'The old A draft must survive the stale completion');
    assert.equal(held.dirty, 'true');
    assert.ok(held.error?.trim(), 'An old A completion must not be confirmed as a B save');
    assert.equal(held.error?.includes(borrowed.email), true, 'The held draft identifies its original account');
    assert.equal(await page.evaluate((selector) => !!document.querySelector(selector), markerFor(ownNode)), false);
    const underB = await readCloudPersonal(page);
    assert.equal(underB.userId, ownerB);
    assert.deepEqual(underB.data, baselineB.data);
    assert.equal(underB.revision, baselineB.revision);
    assert.deepEqual(underB.copies, baselineB.copies);
    const forbidden = await page.evaluate(async ({ bookId, ownerId }) => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { data, error } = await supabase.rpc('reader_personal_snapshot', { p_book_id: bookId, p_owner_id: ownerId });
      return { denied: data === null && !!error, code: error?.code };
    }, { bookId: book.documentSha256, ownerId: result.userId });
    assert.deepEqual(forbidden, { denied: true, code: '42501' });
    await page.click('.note-retry');
    await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'));
    assert.equal(await page.evaluate(() => document.querySelector('.personal-note .cm-content')?.textContent), delayed);
    assert.deepEqual((await readCloudPersonal(page)).data, baselineB.data);
    if (returnToShelf) {
      const startup = await page.evaluate(() => localStorage.getItem('textbook-startup-v1'));
      await page.click('.return-to-shelf');
      await page.dismissDialog();
      assert.equal(await page.evaluate(() => document.querySelector('.personal-note .cm-content')?.textContent), delayed);
      assert.equal(await page.evaluate(() => localStorage.getItem('textbook-startup-v1')), startup);
      await page.click('.return-to-shelf');
      await page.acceptDialog();
      await page.waitForSelector('.shelf-toolbar');
      await page.waitForFunction(() => !document.querySelector('.loading-toast') &&
        !document.querySelector('.storage-error')?.textContent.includes('草稿已保留'));
      await openShelfReader(page);
    } else {
      const discarded = await discardEditor(page);
      assert.equal(discarded, true);
      await page.click('.storage-error button:text-is("重新读取")');
    }
    await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
    const bMarkers = await page.evaluate(() => [...document.querySelectorAll('.personal-marker')].map((item) => item.getAttribute('aria-label')).sort());
    assert.deepEqual(bMarkers, baselineB.data.supplements.map((item) => `我的补充：${item.title}`).sort());
    assert.equal(await page.evaluate((text) => document.body.textContent.includes(text), token), false, 'B view must not receive A fixture text');
    const loadedB = await readCloudPersonal(page);
    assert.deepEqual(loadedB.data, baselineB.data);
    assert.equal(loadedB.revision, baselineB.revision);
    assert.deepEqual(loadedB.copies, baselineB.copies);
    await page.evaluate(async () => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw new Error('Could not revoke the temporary QA B switch session');
    });
    await setSession(page, borrowed.session, result.userId);
    await waitAccount(page, result.userId);
    await jumpToFilePage(page, ownNode.page);
    await page.waitForSelector(markerFor(ownNode));
    assert.equal((await readCloudPersonal(page)).data.notes[result.fixture.noteId], delayed);
    await openNote(page, result.fixture.noteId);
    await replaceMigrationNote(page, recovered);
    await waitForCloudNote(page, result.fixture.noteId, recovered);
    const events = await releaseAResponse(page);
    assert.ok(events.length >= 2);
    assert.ok(events.filter((event) => event.status >= 200 && event.status < 300).every((event) => event.subject === result.userId && event.ownerId === result.userId));
    assert.deepEqual(await source.evaluate(({ personalKey, sourceKey }) => ({ legacy: localStorage.getItem(personalKey), source: localStorage.getItem(sourceKey) }),
      { personalKey, sourceKey }), { legacy: borrowed.legacy, source: borrowed.source });
    assert.deepEqual(await page.evaluate(({ personalKey, sourceKey }) => ({ legacy: localStorage.getItem(personalKey), source: localStorage.getItem(sourceKey) }),
      { personalKey, sourceKey }), { legacy: borrowed.legacy, source: borrowed.source });
    evidence = { origin, createdPages: [...created], closedPages: [...created], userIds: { a: result.userId, b: ownerB },
      baselineRevisions: { a: baselineA.revision, b: baselineB.revision }, heldAfterRealAResponse: true,
      authenticatedSubjectMatchedOwner: true, staleACompletionKeptDraft: true, bDataRevisionAndHistoryUnchanged: true,
      bViewExcludedANodesAndNotes: true, crossAccountReadDenied: true, actualDiscardPrompt: true,
      originalOwnerIdentified: true, confirmedReturnResolvedDraftBlock: returnToShelf,
      canceledReturnKeptEditorAndDestination: returnToShelf,
      returnARecoveredAndSaved: true, existingLegacyAndSourcePreserved: true };
    return evidence;
  } finally {
    try { if (page) {
      try {
        await releaseAResponse(page, true);
        await discardEditor(page);
        if (prepared && borrowed) {
          const active = await page.evaluate(async () => {
            const { supabase } = await import('/src/reader/supabase.ts');
            const { data } = await supabase.auth.getSession();
            return data.session?.user.id ?? null;
          });
          if (active === ownerB) await page.evaluate(async () => {
            const { supabase } = await import('/src/reader/supabase.ts');
            await supabase.auth.signOut({ scope: 'local' });
          });
          if (active !== result.userId) await setSession(page, borrowed.session, result.userId);
          await page.evaluate(async ({ ownerId, ownNodeId, ownNoteId, noteId, original, existed, delayed, recovered }) => {
            const { readPersonal, savePersonal } = await import('/src/reader/cloud-personal.ts');
            const current = await readPersonal(ownerId);
            const notes = { ...current.data.notes };
            delete notes[ownNoteId];
            if (notes[noteId] === delayed || notes[noteId] === recovered) {
              if (existed) notes[noteId] = original;
              else delete notes[noteId];
            }
            const data = { ...current.data, supplements: current.data.supplements.filter((item) => item.id !== ownNodeId), notes };
            if (JSON.stringify(data) !== JSON.stringify(current.data)) await savePersonal(data, current);
          }, { ownerId: result.userId, ownNodeId: ownNode.id, ownNoteId, noteId: result.fixture.noteId,
            original: baselineA.data.notes[result.fixture.noteId] ?? null, existed: result.fixture.noteId in baselineA.data.notes, delayed, recovered });
          const clean = await readCloudPersonal(page);
          assert.deepEqual(clean.data, baselineA.data, 'Targeted cleanup must restore A fields without replacing other content');
          if (evidence) evidence.aOwnedFixturesRemoved = true;
        }
      } finally { await disposeIsolatedPage(page, origin); }
    } } finally { if (source) await source.close(); }
  }
}

// This exercises callback error handling and real SDK request formation, while
// intercepting /auth/v1/otp before it can send any email.
export async function checkExpiredEmailCallback(task, { testOrigin = defaultOrigin, email, placement = 'hash' } = {}) {
  assert.ok(email && (placement === 'hash' || placement === 'query'));
  const origin = await checkOrigin(testOrigin);
  const created = [];
  const page = await emptyOriginPage(task, origin, created, new Set((await task.pages()).map((page) => page.label)));
  const params = new URLSearchParams({ error: 'access_denied', error_code: 'otp_expired', error_description: 'Email link is invalid or has expired' });
  try {
    await page.goto(`${origin}/${placement === 'hash' ? '#' : '?'}${params}`);
    await page.waitForSelector('.storage-error[role="alert"]');
    const error = await page.evaluate(() => document.querySelector('.storage-error[role="alert"]').textContent);
    assert.match(error, /失效|过期|无法使用|expired|used/i, 'An expired email callback must have an understandable error');
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
      const original = window.fetch;
      const state = { descriptor, original, attempts: 0, email: null };
      window.contentAuthOtp = state;
      Object.defineProperty(window, 'fetch', { configurable: true, writable: true, async value(input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname !== '/auth/v1/otp') return original.call(this, input, init);
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : await input.clone().text());
        state.attempts += 1;
        state.email = body.email;
        return new Response(JSON.stringify({ msg: 'QA email delivery intentionally disabled', error_code: 'qa_no_email' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      } });
    });
    await page.click('.account-summary');
    await page.fill('.account-options input[type="email"]', email);
    for (let attempts = 1; attempts <= 2; attempts++) {
      await page.click('.account-options button[type="submit"]');
      await page.waitForFunction((expected) => window.contentAuthOtp.attempts === expected &&
        !!document.querySelector('.account-error[role="alert"]') && !document.querySelector('.account-options button[type="submit"]').disabled, attempts);
    }
    assert.equal(await page.evaluate(() => window.contentAuthOtp.email), email);
    assert.equal(await page.evaluate(() => document.querySelector('.account-options input[type="email"]').value), email);
    return { origin, placement, createdPages: created, closedPages: created, expiredCallbackExplained: true,
      loginRequestCanBeRetried: true, interceptedOtpRequests: 2, noEmailSent: true };
  } finally {
    try {
      await page.evaluate(() => {
        const state = window.contentAuthOtp;
        if (!state) return;
        if (state.descriptor) Object.defineProperty(window, 'fetch', state.descriptor);
        else { delete window.fetch; window.fetch = state.original; }
        delete window.contentAuthOtp;
      });
    } finally { await disposeIsolatedPage(page, origin); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startContentAuthServer({ port: process.argv[2] ? Number(process.argv[2]) : 5194 });
  console.log(JSON.stringify({ origin: server.resolvedUrls.local[0] }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
