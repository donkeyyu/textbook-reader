import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNote, jumpToFilePage } from './check-related-return.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const frozenLegacyDir = resolve(root, '.git/supplement-graph-orchestration/legacy-02-build');
const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const chapter = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/chapter-1.json', import.meta.url), 'utf8'));
const positioning = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/locations.json', import.meta.url), 'utf8'));
const personalKey = `textbook-personal-v1:${book.documentSha256}`;
const sourceKey = `textbook-personal-source-v2:${book.documentSha256}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

async function legacyFile(directory, relative) {
  const path = await realpath(resolve(directory, relative));
  assert.ok(path.startsWith(`${directory}${sep}`), 'Legacy path escapes the frozen build');
  assert.ok((await stat(path)).isFile(), 'Legacy path must name a file');
  return path;
}

export async function legacyBuildEvidence(legacyDir = frozenLegacyDir) {
  const directory = await realpath(legacyDir);
  const index = await readFile(await legacyFile(directory, 'index.html'));
  const paths = [...index.toString('utf8').matchAll(/(?:src|href)="(\/legacy\/[^"<>]+)"/g)].map((match) => match[1]);
  assert.ok(paths.some((path) => path.endsWith('.js')), 'The frozen build must contain its actual /legacy/ script');
  const assets = await Promise.all(paths.map(async (path) => {
    const bytes = await readFile(await legacyFile(directory, path.slice('/legacy/'.length)));
    return { path, sha256: hash(bytes), bytes: bytes.length };
  }));
  return { indexSha256: hash(index), assets };
}

export async function startContentMigrationServer({ port = 5192, legacyDir = frozenLegacyDir } = {}) {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Use an explicit dedicated test port');
  const directory = await realpath(legacyDir);
  const legacyBuild = await legacyBuildEvidence(directory);
  const { createServer } = await import('vite');
  const server = await createServer({ root, cacheDir: `node_modules/.vite-content-migration-${port}`,
    server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'frozen-legacy-content-migration',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0];
        if (path === '/__content_migration_check') {
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ kind: 'reader-content-migration', legacyBuild }));
          return;
        }
        if (path !== '/legacy' && !path.startsWith('/legacy/')) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
        }
        if (path === '/legacy') { response.writeHead(308, { Location: '/legacy/' }).end(); return; }
        let relative;
        try { relative = decodeURIComponent(path.slice('/legacy/'.length)) || 'index.html'; }
        catch { response.writeHead(400).end(); return; }
        if (relative.includes('\0') || relative.includes('\\')) { response.writeHead(400).end(); return; }
        const target = resolve(directory, relative);
        if (!target.startsWith(`${directory}${sep}`)) { response.writeHead(403).end(); return; }
        void legacyFile(directory, relative).then(readFile).then((bytes) => {
          response.setHeader('Content-Type', contentTypes[extname(relative)] ?? 'application/octet-stream');
          response.setHeader('Content-Length', bytes.length);
          response.setHeader('Cache-Control', 'no-store');
          response.end(request.method === 'HEAD' ? undefined : bytes);
        }).catch((cause) => {
          if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' || cause.code === 'ERR_ASSERTION') response.writeHead(404).end();
          else next(cause);
        });
      });
    },
  }] });
  await server.listen();
  return server;
}

export async function readCloudPersonal(page) {
  return page.evaluate(async () => {
    const { supabase } = await import('/src/reader/supabase.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('The disposable QA reader is not signed in');
    return readPersonal(data.session.user.id);
  });
}

export async function replaceMigrationNote(page, text) {
  await page.waitForSelector('.personal-note .note-mode-toggle');
  if (await page.evaluate(() => document.querySelector('.personal-note .note-mode-toggle').getAttribute('aria-pressed') === 'true')) {
    await page.click('.personal-note .note-mode-toggle');
  }
  await page.focus('.personal-note .cm-content');
  await page.press('.personal-note .cm-content', 'ControlOrMeta+a');
  if (text) await page.keyboard.insertText(text);
  else await page.press('.personal-note .cm-content', 'Backspace');
}

export async function waitForCloudNote(page, id, expected) {
  await page.waitForFunction(async ({ id, expected }) => {
    if (document.querySelector('.personal-note [data-saving="true"]')) return false;
    if (document.querySelector('.personal-note [role="alert"]')) return true;
    if (document.querySelector('.personal-note [data-dirty="true"]')) return false;
    const { supabase } = await import('/src/reader/supabase.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    if (!data.session) return false;
    return ((await readPersonal(data.session.user.id)).data.notes[id] ?? null) === expected;
  }, { id, expected }, { timeout: 30_000 });
  assert.equal(await page.evaluate(() => document.querySelector('.personal-note [role="alert"]')?.textContent ?? null), null, 'The cloud note save must succeed');
  const value = await readCloudPersonal(page);
  assert.equal(value.data.notes[id] ?? null, expected);
  return value;
}

async function waitForLegacyNote(page, id, expected) {
  await page.waitForFunction(({ key, id, expected }) => JSON.parse(localStorage.getItem(key))?.notes?.[id] === expected &&
    !document.querySelector('.personal-note [data-dirty="true"]'), { key: personalKey, id, expected }, { timeout: 30_000 });
}

export async function checkLegacyCopyView(page, copy, { oldText, currentText } = {}) {
  await page.waitForSelector('.legacy-copies > summary');
  if (!await page.evaluate(() => document.querySelector('.legacy-copies').open)) await page.click('.legacy-copies > summary');
  await page.selectOption('.legacy-copies select', `${copy.source_id}:${copy.snapshot_hash}`);
  await page.waitForFunction((raw) => document.querySelector('.legacy-copies textarea')?.value === raw, copy.raw ?? '');
  assert.equal(await page.evaluate(() => document.querySelector('.legacy-copies textarea').readOnly), true);
  if (oldText !== undefined) assert.ok(await page.evaluate((text) => document.querySelector('.legacy-comparison > section[aria-label="旧页面版本"]')?.textContent.includes(text), oldText));
  if (currentText !== undefined) assert.ok(await page.evaluate((text) => document.querySelector('.legacy-comparison > section[aria-label="本页版本"]')?.textContent.includes(text), currentText));
  // Exercise the actual copy button without replacing the user's OS clipboard.
  await page.evaluate(() => {
    window.contentMigrationClipboard = { descriptor: Object.getOwnPropertyDescriptor(navigator, 'clipboard'), copied: null };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text) => { window.contentMigrationClipboard.copied = text; },
    } });
  });
  try {
    await page.click('.legacy-copies button:text-is("复制完整旧版数据")');
    assert.equal(await page.evaluate(() => window.contentMigrationClipboard.copied), copy.raw ?? '');
    await page.waitForFunction(() => document.querySelector('.legacy-copies [role="status"]')?.textContent === '旧版数据已复制。');
  } finally {
    await page.evaluate(() => {
      const saved = window.contentMigrationClipboard;
      if (saved.descriptor) Object.defineProperty(navigator, 'clipboard', saved.descriptor);
      else delete navigator.clipboard;
      delete window.contentMigrationClipboard;
    });
  }
  return { rawVisible: true, readonly: true, copyButtonPayload: true, comparedVersions: oldText !== undefined && currentText !== undefined };
}

function lateCopy(value, noteId, expected) {
  return value.copies.find((copy) => {
    try { return JSON.parse(copy.raw ?? 'null')?.notes?.[noteId] === expected; }
    catch { return false; }
  });
}

// This leaves test fixtures and the two owned reading pages available for the
// caller's next checks. Credentials must belong to a fresh disposable QA user.
export async function checkContentMigration(task, { testOrigin, credentials } = {}) {
  assert.ok(testOrigin && credentials?.email && credentials?.password, 'Pass a dedicated testOrigin and disposable QA credentials');
  const url = new URL(testOrigin);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port && url.pathname === '/' && !url.search && !url.hash,
    'Use an exact local dedicated origin');
  const origin = url.origin;
  const response = await fetch(`${origin}/__content_migration_check`);
  assert.equal(response.status, 200);
  const served = await response.json();
  assert.equal(served.kind, 'reader-content-migration', 'Use startContentMigrationServer(), not the user acceptance server');
  for (const tab of await task.tabs()) {
    if (!tab.url?.startsWith('http')) continue;
    assert.notEqual(new URL(tab.url).origin, origin, 'The dedicated test origin must have no pre-existing browser page');
  }
  const created = [];
  async function ownedPage(path) {
    const page = await task.newPage();
    assert.notEqual(page.label, 'p1', 'Never use the existing dashboard/user page');
    created.push(page.label);
    await page.goto(`${origin}${path}`);
    assert.equal(new URL(await page.url()).origin, origin);
    await page.waitForSelector('.page-index');
    return page;
  }
  const runId = randomUUID();
  const note = chapter.supplements.find((item) => item.id === 'ch1-measurement-exercise') ?? chapter.supplements[0];
  const location = positioning.locations.find((item) => item.id === note.locationId);
  assert.ok(location);
  const item = { id: `qa-legacy-${runId}`, title: `QA 迁移 ${runId.slice(0, 8)}`,
    markdown: `# 旧版个人内容\n\n保留 **${runId}** 与原文位置。`, page: location.page,
    region: { x: .1, y: .2, width: .4, height: .1 } };
  const initialNote = `QA initial **${runId}**`;
  const cloudNote = `QA newer cloud **${runId}**`;
  const lateOne = `QA legacy late one ${runId}`;
  const lateTwo = `QA legacy after newer page closed ${runId}`;
  const raw = JSON.stringify({ supplements: [item], notes: { [note.id]: initialNote } });
  try {
    const oldPage = await ownedPage('/legacy/');
    assert.deepEqual(await oldPage.evaluate(() => [...document.scripts].filter((script) => script.src).map((script) => new URL(script.src).pathname)),
      served.legacyBuild.assets.filter((asset) => asset.path.endsWith('.js')).map((asset) => asset.path), 'The old page must execute the actual frozen bundle');
    await oldPage.evaluate(({ key, sourceKey, raw }) => {
      if (localStorage.getItem(key) !== null || localStorage.getItem(sourceKey) !== null || Object.keys(localStorage).some((name) => /^sb-.*-auth-token$/.test(name))) {
        throw new Error('Use an unused test origin; existing personal content, migration identity or login was preserved');
      }
      localStorage.setItem(key, raw);
    }, { key: personalKey, sourceKey, raw });
    await oldPage.reload();
    await oldPage.waitForSelector('.page-index');
    await openNote(oldPage, note.id);
    if (await oldPage.evaluate(() => document.querySelector('.personal-note .note-mode-toggle').getAttribute('aria-pressed') === 'true')) await oldPage.click('.personal-note .note-mode-toggle');
    assert.equal(await oldPage.evaluate(() => document.querySelector('.personal-note .cm-content').textContent), initialNote);

    const newerPage = await ownedPage('/');
    const auth = await newerPage.evaluate(async (credentials) => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { data, error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw new Error(error.message);
      return { userId: data.user.id, email: data.user.email };
    }, credentials);
    assert.equal(auth.email.toLowerCase(), credentials.email.toLowerCase());
    const marker = `[aria-label=${JSON.stringify(`我的补充：${item.title}`)}]`;
    await jumpToFilePage(newerPage, item.page);
    await newerPage.waitForSelector(marker);
    const initial = await readCloudPersonal(newerPage);
    const migrated = initial.data.supplements.find((value) => value.id === item.id);
    assert.ok(migrated);
    assert.deepEqual(Object.fromEntries(Object.keys(item).map((key) => [key, migrated[key]])), item, 'Migration preserves the legacy identity, body and coordinates');
    assert.equal(initial.data.notes[note.id], initialNote);
    assert.ok(initial.copies.some((copy) => copy.kind === 'initial' && copy.raw === raw));
    await newerPage.click(marker);
    await newerPage.waitForSelector('.personal-actions');
    assert.ok(await newerPage.evaluate((token) => document.querySelector('#supplement-panel .markdown-content')?.textContent.includes(token), runId));
    assert.deepEqual(await newerPage.evaluate((page) => {
      const style = document.querySelector(`#page-${page} .location-highlight[data-supplement-type="personal"]`).style;
      return { left: style.left, top: style.top, width: style.width, height: style.height };
    }, item.page), { left: '10%', top: '20%', width: '40%', height: '10%' });
    await openNote(newerPage, note.id);
    await replaceMigrationNote(newerPage, cloudNote);
    const cloud = await waitForCloudNote(newerPage, note.id, cloudNote);

    await replaceMigrationNote(oldPage, lateOne);
    await waitForLegacyNote(oldPage, note.id, lateOne);
    await newerPage.waitForFunction(() => document.querySelector('.legacy-copies > summary')?.textContent.includes('冲突'), undefined, { timeout: 30_000 });
    const conflict = await readCloudPersonal(newerPage);
    const firstCopy = lateCopy(conflict, note.id, lateOne);
    assert.ok(firstCopy?.has_conflict, 'The late old-version save must be preserved and identified as a conflict');
    assert.equal(conflict.data.notes[note.id], cloudNote, 'The old page must not overwrite cloud content');
    assert.equal(conflict.revision, cloud.revision, 'Capturing a late old write must not replace the cloud editing revision');
    const copyView = await checkLegacyCopyView(newerPage, firstCopy, { oldText: lateOne, currentText: `QA newer cloud ${runId}` });
    await newerPage.close();

    await replaceMigrationNote(oldPage, lateTwo);
    await waitForLegacyNote(oldPage, note.id, lateTwo);
    const restartedPage = await ownedPage('/');
    await jumpToFilePage(restartedPage, item.page);
    await restartedPage.waitForSelector(marker);
    const restarted = await readCloudPersonal(restartedPage);
    const secondCopy = lateCopy(restarted, note.id, lateTwo);
    assert.ok(secondCopy?.has_conflict, 'Startup must detect old saves made while no newer page is open');
    assert.equal(restarted.data.notes[note.id], cloudNote);
    await checkLegacyCopyView(restartedPage, secondCopy, { oldText: lateTwo, currentText: `QA newer cloud ${runId}` });
    const copyKeys = restarted.copies.map((copy) => `${copy.source_id}:${copy.snapshot_hash}`).sort();
    await restartedPage.reload();
    await restartedPage.waitForSelector('.page-index');
    await jumpToFilePage(restartedPage, item.page);
    await restartedPage.waitForSelector(marker);
    const refreshed = await readCloudPersonal(restartedPage);
    assert.deepEqual(refreshed.copies.map((copy) => `${copy.source_id}:${copy.snapshot_hash}`).sort(), copyKeys, 'Refresh must not duplicate migration or conflict copies');
    assert.equal(refreshed.revision, restarted.revision);
    assert.equal(refreshed.data.notes[note.id], cloudNote);
    assert.equal(refreshed.data.supplements.filter((value) => value.id === item.id).length, 1);
    await openNote(restartedPage, note.id);
    if (await restartedPage.evaluate(() => document.querySelector('.personal-note .note-mode-toggle').getAttribute('aria-pressed') === 'true')) await restartedPage.click('.personal-note .note-mode-toggle');
    assert.equal(await restartedPage.evaluate(() => document.querySelector('.personal-note .cm-content').textContent), cloudNote);
    return { origin, userId: auth.userId, legacyPage: oldPage.label, currentPage: restartedPage.label, closedPage: newerPage.label,
      createdPages: created, fixture: { item, noteId: note.id, initialNote, cloudNote, lateOne, lateTwo },
      evidence: { legacyBuild: served.legacyBuild, firstMigration: true, legacyIdentityAndCoordinates: true, realOldUiSaves: 2,
        openPageConflict: true, newerClosedStartupConflict: true, copiesAfterRefresh: copyKeys.length,
        refreshDedup: true, cloudRevision: refreshed.revision, copyView } };
  } catch (cause) {
    const error = new Error(`Content migration check failed. Owned pages: ${created.join(', ')}. ${cause.message}`, { cause });
    error.createdPages = created;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startContentMigrationServer({ port: process.argv[2] ? Number(process.argv[2]) : 5192,
    legacyDir: process.argv[3] ? resolve(process.argv[3]) : frozenLegacyDir });
  console.log(JSON.stringify({ origin: server.resolvedUrls.local[0], legacy: await legacyBuildEvidence(process.argv[3] ? resolve(process.argv[3]) : frozenLegacyDir) }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
