import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/');
const fixtureId = 'virtual:bookshelf-auth-drafts';

// Synthetic accounts and in-memory snapshots only. No real auth request, email,
// browser storage or cloud personal content is used by this bounded seam check.
const fixture = `
const users = Object.fromEntries(['A', 'B', 'C'].map((id) => [id, { id, email: 'qa-' + id.toLowerCase() + '@example.invalid' }]));
const snapshots = Object.fromEntries(Object.keys(users).map((id) => [id, { userId: id, revision: 0, copies: [], data: { supplements: [], notes: { note: id + ' saved' } } }]));
let user = users.A;
const listeners = new Set();
export const control = window.draftOwnership = {
  requests: [], held: null, holdNext: false, failNext: false, switchDuringEdit: false,
  switchAccount(id) { user = users[id] ?? null; for (const listener of listeners) listener('SIGNED_IN', user ? { user } : null); },
  snapshot(id) { return structuredClone(snapshots[id]); },
};
export const supabase = { auth: {
  onAuthStateChange(listener) { listeners.add(listener); return { data: { subscription: { unsubscribe() { listeners.delete(listener); } } } }; },
  async initialize() { return { error: null }; },
  async getSession() { return { data: { session: user ? { user } : null }, error: null }; },
} };
export async function migratePersonal(id) { return structuredClone(snapshots[id]); }
export function onPersonalSaved() { return () => {}; }
export async function savePersonal(data, previous) {
  control.requests.push({ owner: previous.userId, subject: user?.id });
  if (previous.userId !== user?.id) throw new Error('Synthetic owner mismatch');
  if (control.failNext) { control.failNext = false; throw new Error('Synthetic network failure; draft retained'); }
  const value = { ...previous, revision: previous.revision + 1, data };
  snapshots[previous.userId] = structuredClone(value);
  if (control.holdNext) {
    control.holdNext = false;
    await new Promise((resolve) => { control.held = { release: resolve }; });
  }
  return value;
}
export async function readPublishedContent() { return { documentSha256: 'qa', pageCount: 1, chapters: [], sections: [], supplements: [] }; }
`;

const entry = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBookContent } from '/src/content/useBookContent.ts';
import { MarkdownEditor } from '/src/reader/links/MarkdownEditor.tsx';
import { control } from '${fixtureId}';
function Check() {
  const content = useBookContent();
  const [shown, setShown] = useState(true);
  const [retainedResult, setRetainedResult] = useState('');
  control.content = content;
  return <main style={{ maxWidth: 640, margin: '32px auto', fontFamily: 'sans-serif' }}>
    <h1>Auth draft seam check</h1>
    <p id="account">{content.user?.id ?? 'signed out'}</p>
    <p id="loaded">{content.personal?.userId ?? 'none'}</p>
    <p id="loading">{String(content.loading)}</p>
    <p id="owner">{content.draftOwner?.email ?? ''}</p>
    {content.error && <p id="content-error" role="alert">{content.error}</p>}
    {['A', 'B', 'C', 'out'].map((id) => <button id={'account-' + id} key={id} onClick={() => control.switchAccount(id)}>{id}</button>)}
    <button id="capture" onClick={() => { control.retained = content.updatePersonal; }}>Keep A callback</button>
    <button id="run-retained" onClick={async () => {
      try { await control.retained((data) => ({ ...data, notes: { ...data.notes, late: 'old callback' } })); setRetainedResult('resolved'); }
      catch { setRetainedResult('rejected'); }
    }}>Run kept callback</button>
    <p id="retained-result">{retainedResult}</p>
    <button id="hold" onClick={() => { control.holdNext = true; }}>Delay next response</button>
    <button id="switch-on-edit" onClick={() => { control.switchDuringEdit = true; }}>Switch on native edit</button>
    <button id="discard" onClick={() => { setShown(false); }}>Discard editor</button>
    <button id="refresh" onClick={() => { void content.refresh(); }}>Reload content</button>
    {shown && content.personal && <MarkdownEditor key={content.personal.userId} note value={content.personal.data.notes.note}
      onEdit={() => { if (control.switchDuringEdit) { control.switchDuringEdit = false; control.switchAccount('B'); } }}
      onSave={(value) => content.updatePersonal((data) => ({ ...data, notes: { ...data.notes, note: value } }))} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Check />);
`;

export async function startAuthDraftOwnershipServer({ port = 5294 } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ root, cacheDir: `node_modules/.vite-auth-drafts-${port}`,
    server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
      name: 'isolated-auth-draft-fixture', enforce: 'pre',
      resolveId(id) { if (id === fixtureId) return `\0${fixtureId}`; },
      load(id) { if (id === `\0${fixtureId}`) return fixture; },
      transform(source, id) {
        const path = id.split('?')[0];
        if (path === `${root}/src/main.tsx`) return entry;
        if (path === `${root}/src/content/useBookContent.ts`) {
          for (const original of ['../account/supabase.ts', './cloud-personal.ts', '../textbook/content-store.ts']) {
            source = source.replace(`from '${original}'`, `from '${fixtureId}'`);
          }
          return source;
        }
      },
      configureServer(vite) {
        vite.middlewares.use('/__auth_draft_ownership_check', (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ kind: 'synthetic-auth-draft-ownership' }));
        });
      },
    }] });
  await server.listen();
  return server;
}

async function replaceNote(page, text) {
  if (await page.evaluate(() => document.querySelector('.note-mode-toggle').getAttribute('aria-pressed') === 'true')) {
    await page.click('.note-mode-toggle');
  }
  await page.focus('.cm-content');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

async function ready(page, owner) {
  await page.waitForFunction((owner) => document.querySelector('#loaded')?.textContent === owner &&
    document.querySelector('#loading')?.textContent === 'false', owner);
}

export async function checkAuthDraftOwnership(page, { testOrigin }) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  const marker = await fetch(`${testOrigin}/__auth_draft_ownership_check`);
  assert.equal((await marker.json()).kind, 'synthetic-auth-draft-ownership');
  await page.goto(`${testOrigin}/__auth_draft_ownership_check`);
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'Use an empty dedicated origin; nothing is cleared');
  await page.goto(testOrigin);
  await ready(page, 'A');
  await replaceNote(page, 'A normal save');
  await page.waitForFunction(() => document.querySelector('.markdown-editor').dataset.dirty === 'false');
  await page.evaluate(() => { window.draftOwnership.failNext = true; });
  await replaceNote(page, 'A failed save');
  await page.waitForSelector('.editor-save-error');
  assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), 'A failed save');
  await page.click('.note-retry');
  await page.waitForFunction(() => document.querySelector('.markdown-editor').dataset.dirty === 'false');
  assert.equal(await page.evaluate(() => window.draftOwnership.snapshot('A').data.notes.note), 'A failed save');
  const requestsBeforeSwitch = await page.evaluate(() => window.draftOwnership.requests.length);
  await page.click('#capture');
  await page.click('#account-B');
  await ready(page, 'B');
  await page.click('#run-retained');
  await page.waitForFunction(() => document.querySelector('#retained-result').textContent !== '');
  assert.equal(await page.evaluate(() => document.querySelector('#retained-result').textContent), 'rejected');
  assert.equal(await page.evaluate(() => window.draftOwnership.requests.length), requestsBeforeSwitch, 'An old callback cannot retarget B');

  await page.reload();
  await ready(page, 'A');
  await page.click('#hold');
  await replaceNote(page, 'A pending draft');
  await page.waitForFunction(() => !!window.draftOwnership.held);
  await page.click('#account-B');
  await page.waitForFunction(() => document.querySelector('#account').textContent === 'B');
  await page.evaluate(() => window.draftOwnership.held.release());
  await page.waitForFunction(() => !!document.querySelector('.editor-save-error') && !document.querySelector('[data-saving="true"]'));
  for (const account of ['B', 'C', 'out', 'A']) {
    if (account !== 'B') await page.click(`#account-${account}`);
    await page.waitForFunction((value) => document.querySelector('#account').textContent === value, account === 'out' ? 'signed out' : account);
    assert.equal(await page.evaluate(() => document.querySelector('#owner').textContent), 'qa-a@example.invalid');
    assert.match(await page.evaluate(() => document.querySelector('#content-error').textContent), /qa-a@example\.invalid/);
    await page.click('.note-retry');
    await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'));
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), 'A pending draft');
    assert.equal(await page.evaluate(() => document.querySelector('.markdown-editor').dataset.dirty), 'true');
    assert.equal(await page.evaluate(() => window.draftOwnership.requests.length), 1, 'Held draft retries must not issue another save');
  }
  assert.deepEqual(await page.evaluate(() => ['B', 'C'].map((id) => window.draftOwnership.snapshot(id).data.notes)), [{ note: 'B saved' }, { note: 'C saved' }]);
  await page.click('#discard');
  await page.click('#account-B');
  await page.click('#refresh');
  await ready(page, 'B');
  assert.equal(await page.evaluate(() => document.querySelector('#owner').textContent), '');

  await page.reload();
  await ready(page, 'A');
  await page.click('#switch-on-edit');
  await replaceNote(page, 'Edit and switch in one native update');
  await page.waitForFunction(() => document.querySelector('#account').textContent === 'B' && !!document.querySelector('.editor-save-error'));
  assert.equal(await page.evaluate(() => document.querySelector('.cm-content')?.textContent), 'Edit and switch in one native update');
  assert.equal(await page.evaluate(() => document.querySelector('#owner').textContent), 'qa-a@example.invalid');
  assert.equal(await page.evaluate(() => window.draftOwnership.requests.length), 0);
  await page.click('#discard');
  await page.goto(`${testOrigin}/__auth_draft_ownership_check`);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  return { normalSaveAndFailureRetry: true, retainedCallbackRejected: true, staleResponseKeptDraftAndOwner: true,
    repeatedSwitchAndSignOutKeptOriginalOwner: true, retriesDidNotWriteAnyAccount: true,
    explicitDiscardAndReloadLoadedB: true, nativeEditBeforeReactCommitKeptDraft: true,
    syntheticAccountsOnly: true, cloudAndBrowserStorageUntouched: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startAuthDraftOwnershipServer({ port: Number(process.argv[2] ?? 5294) });
  console.log(JSON.stringify({ origin: server.resolvedUrls.local[0] }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
