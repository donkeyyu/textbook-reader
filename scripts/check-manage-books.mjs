import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assertUnusedAsyncOrigin } from './check-async-save.mjs';
import { jumpToFilePage, openNote, readingSnapshot } from './check-related-return.mjs';
import { readCloudPersonal, replaceMigrationNote, waitForCloudNote } from './check-content-migration.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const shelfKey = 'textbook-shelf-v1';
const startupKey = 'textbook-startup-v1';
const readingKey = `textbook-reading-v1:${book.documentSha256}`;

async function add(page) {
  await page.click('.shelf-toolbar button:text-is("添加教材")');
  await page.waitForSelector('dialog[open][aria-labelledby="textbook-picker-title"]');
  await page.click('dialog[open] button:text-is("添加到书架")');
  await page.click('button[aria-label="关闭教材选择"]');
  await page.waitForSelector('.shelf-cover');
}

async function menu(page) {
  await page.click('.shelf-more');
  await page.waitForSelector('[role="menu"]');
}

async function remove(page) {
  await menu(page);
  await page.click('[role="menuitem"]:text-is("移出书架")');
}

async function back(page) {
  await page.click('button[aria-label="返回书架"]');
  await page.waitForSelector('.shelf-toolbar');
}

async function failShelfWrites(page) {
  await page.evaluate((shelfKey) => {
    if (window.manageBooksOriginalSetItem) throw new Error('Another write probe is still active');
    window.manageBooksOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === shelfKey) throw new DOMException('QA shelf quota', 'QuotaExceededError');
      return window.manageBooksOriginalSetItem.call(this, key, value);
    };
  }, shelfKey);
}

async function restoreWrites(page) {
  await page.evaluate(() => {
    if (!window.manageBooksOriginalSetItem) return;
    Storage.prototype.setItem = window.manageBooksOriginalSetItem;
    delete window.manageBooksOriginalSetItem;
  });
}

// Use startAsyncSaveServer() on a NEW, EMPTY owned localhost origin. This
// anonymous check never signs in, sends email or writes cloud personal content.
export async function checkManageBooks(page, { testOrigin, evidenceDir } = {}) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  const origin = new URL(testOrigin);
  assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.port);
  await assertUnusedAsyncOrigin(page, { testOrigin });
  const shot = async (name) => { if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${name}.png` }); };
  const record = () => page.evaluate((key) => localStorage.getItem(key), readingKey);
  try {
    await page.waitForSelector('.shelf-empty');
    await add(page);
    await page.focus('.shelf-more');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="menu"]');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '查看教材信息');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '移出书架');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '查看教材信息');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '移出书架');
    await shot('menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shelf-more')), true);
    assert.equal(await page.evaluate(() => !!document.querySelector('[role="menu"]')), false);
    await menu(page);
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '移出书架');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => !!document.querySelector('[role="menu"]')), false);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shelf-read')), true);
    await menu(page);
    await page.click('h1:text-is("书架")');
    assert.equal(await page.evaluate(() => !!document.querySelector('[role="menu"]')), false);

    await menu(page);
    await page.click('[role="menuitem"]:text-is("查看教材信息")');
    await page.waitForSelector('dialog[open][aria-labelledby="textbook-info-title"]');
    const info = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[aria-labelledby="textbook-info-title"]');
      const bounds = dialog.getBoundingClientRect();
      return { modal: dialog.matches(':modal'), title: dialog.querySelector('h3').textContent,
        facts: [...dialog.querySelectorAll('dd')].map((node) => node.textContent),
        withinViewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight };
    });
    assert.equal(info.modal, true);
    assert.equal(info.title, book.title);
    assert.deepEqual(info.facts, ['人教版 · 2024 年审定', `${book.pageCount} 页`]);
    assert.equal(info.withinViewport, true);
    assert.equal(await page.evaluate(() => document.querySelector('.shelf-info').getBoundingClientRect().width <= 480), true);
    const shelfScroll = await page.evaluate(() => document.querySelector('.shelf-main').scrollTop);
    await page.mouse.move(10, 100);
    await page.mouse.wheel(0, 500);
    assert.equal(await page.evaluate(() => document.querySelector('.shelf-main').scrollTop), shelfScroll);
    await shot('info');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.shelf-info').open);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shelf-more')), true);
    await menu(page);
    await page.click('[role="menuitem"]:text-is("查看教材信息")');
    await page.waitForSelector('.shelf-info[open]');
    await page.click('button[aria-label="关闭教材信息"]');
    await page.waitForFunction(() => document.activeElement.classList.contains('shelf-more'));

    await page.click('.shelf-cover');
    await page.waitForSelector('.page-index');
    await jumpToFilePage(page, 28);
    await page.evaluate(() => {
      const paper = document.getElementById('page-28').getBoundingClientRect();
      const viewport = document.getElementById('textbook-view');
      viewport.scrollTop += paper.top - viewport.getBoundingClientRect().top + paper.height * .31;
    });
    const before = await readingSnapshot(page, 28);
    await back(page);
    const savedReading = await record();
    assert.ok(savedReading);
    await remove(page);
    await page.waitForSelector('.shelf-empty');
    await page.waitForSelector('button:text-is("撤销移出")');
    assert.equal(await record(), savedReading);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.shelf-toolbar button')), true);
    await shot('removed');
    await page.focus('button:text-is("撤销移出")');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shelf-cover');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-cover').length), 1);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shelf-cover')), true);
    assert.equal(await record(), savedReading);

    await remove(page);
    await page.waitForSelector('.shelf-empty');
    await page.reload();
    await page.waitForSelector('.shelf-empty');
    assert.equal(await record(), savedReading);
    await add(page);
    await page.click('button:text-is("继续阅读")');
    await page.waitForSelector('.page-index');
    const resumed = await readingSnapshot(page, 28);
    assert.ok(Math.abs(resumed.fraction - before.fraction) < .01, 'Re-adding the same version must resume the page-relative position');
    await back(page);
    const beforeFailures = await record();

    const membership = await page.evaluate((key) => localStorage.getItem(key), shelfKey);
    await failShelfWrites(page);
    await remove(page);
    await page.waitForSelector('.shelf-error[role="alert"]');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-cover').length), 1);
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-removal')), false, 'Failed removal must not report success');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), shelfKey), membership);
    await shot('remove-failed');
    await restoreWrites(page);
    await page.click('[role="menuitem"]:text-is("移出书架")');
    await page.waitForSelector('.shelf-empty');
    const removedMembership = await page.evaluate((key) => localStorage.getItem(key), shelfKey);
    await failShelfWrites(page);
    await page.click('button:text-is("撤销移出")');
    await page.waitForSelector('.shelf-error[role="alert"]');
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-empty')), true);
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-removal')), true, 'Keep undo available after failure');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), shelfKey), removedMembership);
    await shot('undo-failed');
    await restoreWrites(page);
    await page.click('button:text-is("撤销移出")');
    await page.waitForSelector('.shelf-cover');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-cover').length), 1);
    assert.equal(await record(), beforeFailures);
    return { keyboardMenu: true, realVersionInformation: true, infoModalAndFocus: true,
      removeLastBook: true, undoSameVersionOnce: true, removedAfterRefresh: true, reAddResumesPosition: true,
      failedRemovalPreservesMembership: true, failedUndoRemainsRetryable: true };
  } finally {
    await restoreWrites(page);
    if (await page.evaluate(() => !!document.querySelector('.return-to-shelf'))) await back(page);
    await page.evaluate(({ shelfKey, readingKey, startupKey }) => {
      localStorage.removeItem(shelfKey); localStorage.removeItem(readingKey); localStorage.removeItem(startupKey);
    }, { shelfKey, readingKey, startupKey });
    await page.reload();
  }
}

// A disposable dedicated QA account only. Log in through the existing reader
// account entry. Restore only this check's unique note and personal supplement.
export async function checkManagedPersonalContent(page, { testOrigin, credentials, evidenceDir } = {}) {
  assert.ok(credentials?.id && credentials.email && credentials.password, 'Pass dedicated QA credentials');
  await assertUnusedAsyncOrigin(page, { testOrigin });
  const noteId = 'ch1-measurement-exercise';
  const marker = randomUUID();
  const note = `QA bookshelf retained note ${marker}`;
  const title = `QA bookshelf retained supplement ${marker}`;
  const body = `Saved personal body ${marker}`;
  let before;
  let createdId;
  try {
    await add(page);
    await page.click('.shelf-cover');
    await page.waitForSelector('.account-summary');
    await page.evaluate(() => {
      const original = window.fetch;
      window.managedContentNetwork = { original, mail: 0 };
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname === '/auth/v1/otp') {
          window.managedContentNetwork.mail++;
          return Promise.reject(new Error('Email is outside the QA password check'));
        }
        return original.call(this, input, init);
      };
    });
    await page.click('.account-summary');
    await page.click('.account-mode-toggle:text-is("测试账号登录")');
    await page.fill('.account-options input[name="email"]', credentials.email);
    await page.fill('.account-options input[name="password"]', credentials.password);
    await page.click('.account-options button[type="submit"]');
    await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
    before = await readCloudPersonal(page);
    assert.equal(before.userId, credentials.id);
    assert.equal(before.data.notes[noteId], undefined, 'Use a QA account with this test note unused');
    await openNote(page, noteId);
    await replaceMigrationNote(page, note);
    await waitForCloudNote(page, noteId, note);
    await page.click('#add-personal-supplement');
    await page.press('.region-selector', 'Enter');
    await page.fill('.personal-title input', title);
    await page.focus('.markdown-source .cm-content');
    await page.keyboard.insertText(body);
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.personal-actions button:text-is("编辑补充")');
    const saved = await readCloudPersonal(page);
    const personal = saved.data.supplements.find((item) => item.title === title);
    assert.ok(personal && personal.markdown === body);
    createdId = personal.id;
    assert.equal(saved.data.notes[noteId], note);
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/saved-content.png` });
    await back(page);
    const savedReading = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), readingKey));
    const unchanged = async () => {
      const actual = await readCloudPersonal(page);
      assert.equal(actual.userId, saved.userId);
      assert.equal(actual.revision, saved.revision, 'Managing the shelf must not save personal content');
      assert.deepEqual(actual.data, saved.data);
      assert.deepEqual(actual.copies, saved.copies);
    };
    await remove(page);
    await page.waitForSelector('.shelf-empty');
    await unchanged();
    await page.click('button:text-is("撤销移出")');
    await page.waitForSelector('.shelf-cover');
    await unchanged();
    await page.click('.shelf-cover');
    await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
    await unchanged();
    const undonePosition = await readingSnapshot(page, savedReading.page);
    assert.ok(Math.abs(undonePosition.fraction - savedReading.fraction) < .01);
    await openNote(page, noteId);
    assert.equal(await page.evaluate((text) => document.querySelector('.personal-note').textContent.includes(text), note), true);
    await back(page);
    const secondReading = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), readingKey));
    await remove(page);
    await page.waitForSelector('.shelf-empty');
    await page.reload();
    await page.waitForSelector('.shelf-empty');
    await unchanged();
    await add(page);
    await page.click('button:text-is("继续阅读")');
    await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
    await unchanged();
    const resumed = await readingSnapshot(page, secondReading.page);
    assert.ok(Math.abs(resumed.fraction - secondReading.fraction) < .01);
    await page.click('#graph-search-toggle');
    await page.fill('.graph-search input', title);
    await page.waitForSelector('#graph-search-results button');
    await page.click('#graph-search-results button');
    await page.waitForSelector('.personal-actions button:text-is("编辑补充")');
    assert.equal(await page.evaluate((text) => document.getElementById('supplement-panel').textContent.includes(text), body), true);
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/readded-content.png` });
    assert.equal(await page.evaluate(() => window.managedContentNetwork?.mail ?? 0), 0);
  } finally {
    if (before) {
      await page.waitForFunction(() => !document.querySelector('[data-saving="true"]'));
      const restored = await page.evaluate(async ({ ownerId, noteId, note, createdId, title, originalNote }) => {
        const { supabase } = await import('/src/reader/supabase.ts');
        const { readPersonal, savePersonal } = await import('/src/reader/cloud-personal.ts');
        const session = await supabase.auth.getSession();
        if (session.data.session?.user.id !== ownerId) throw new Error('QA owner changed; refuse cleanup');
        const current = await readPersonal(ownerId);
        const next = structuredClone(current.data);
        if (next.notes[noteId] === note) {
          if (originalNote === null) delete next.notes[noteId];
          else next.notes[noteId] = originalNote;
        }
        next.supplements = next.supplements.filter((item) => item.id !== createdId && item.title !== title);
        return JSON.stringify(next) === JSON.stringify(current.data) ? current : await savePersonal(next, current);
      }, { ownerId: before.userId, noteId, note, createdId: createdId ?? null, title, originalNote: before.data.notes[noteId] ?? null });
      assert.deepEqual(restored.data, before.data, 'Restore the complete original QA content');
      assert.deepEqual(restored.copies, before.copies, 'Management and cleanup must preserve existing copies');
    }
    await page.evaluate(async () => {
      const { supabase } = await import('/src/reader/supabase.ts');
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      if (window.managedContentNetwork) window.fetch = window.managedContentNetwork.original;
      delete window.managedContentNetwork;
    });
    if (await page.evaluate(() => !!document.querySelector('.return-to-shelf'))) await back(page);
    await page.evaluate(({ shelfKey, startupKey, readingKey, sourceKey }) => {
      for (const key of [shelfKey, startupKey, readingKey, sourceKey]) localStorage.removeItem(key);
    }, { shelfKey, startupKey, readingKey, sourceKey: `textbook-personal-source-v2:${book.documentSha256}` });
    await page.reload();
    assert.equal(await page.evaluate(() => localStorage.length), 0, 'Release the owned QA origin empty');
  }
  return { savedNoteAndPersonalSupplement: true, removeAndUndoKeptSnapshotAndRevision: true,
    reAddAndRefreshKeptSnapshotAndRevision: true, savedNoteAndSupplementReadable: true,
    ownCloudContentRestored: true, localSessionReleased: true, noEmailSent: true };
}

// Only this marked test server changes the served catalog; production files
// stay untouched. Both entries reuse one resource solely to test membership.
export async function startManagedVersionsServer({ root = fileURLToPath(new URL('..', import.meta.url)), port = 5365 } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ root, cacheDir: `${root}/.vite-managed-versions-${port}`,
    server: { host: '127.0.0.1', port, strictPort: true,
      fs: root.includes('/.git/') ? { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}'] } : undefined },
    plugins: [{ name: 'managed-versions-fixture', enforce: 'pre',
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (!['/__async_save_check', '/__managed_versions_check'].includes(request.url)) return next();
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ kind: request.url === '/__async_save_check' ? 'reader-async-cloud-save' : 'managed-versions-fixture' }));
        });
      },
      transform(source, id) {
        if (!id.endsWith('/src/textbook/library.ts')) return;
        return source + `\ntextbooks[0].title = 'QA 同名长标题教材：用于检查不同文件版本及手机换行的测试教材';
textbooks.push({ ...textbooks[0], id: 'qa-bookshelf-03-other-version', edition: 'QA 夹具 · 另一文件版本' });\n`;
      },
    }],
  });
  await server.listen();
  return server;
}

export async function checkManagedVersions(page, { testOrigin, evidenceDir } = {}) {
  await assertUnusedAsyncOrigin(page, { testOrigin });
  assert.equal((await (await fetch(`${testOrigin}/__managed_versions_check`)).json()).kind, 'managed-versions-fixture');
  const otherId = 'qa-bookshelf-03-other-version';
  const first = '.shelf-grid[aria-label="我的教材"] .shelf-book:nth-child(1)';
  const second = '.shelf-grid[aria-label="我的教材"] .shelf-book:nth-child(2)';
  const keys = [shelfKey, startupKey, readingKey, `textbook-reading-v1:${otherId}`, `textbook-personal-v1:${book.documentSha256}`, `textbook-personal-v1:${otherId}`];
  try {
    await page.click('.shelf-toolbar button:text-is("添加教材")');
    await page.waitForSelector('.shelf-picker[open]');
    for (const index of [1, 2]) await page.click(`.shelf-picker[open] .shelf-book:nth-child(${index}) button:text-is("添加到书架")`);
    await page.click('button[aria-label="关闭教材选择"]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.shelf-main .shelf-book h2')].map((node) => node.textContent)), [
      'QA 同名长标题教材：用于检查不同文件版本及手机换行的测试教材',
      'QA 同名长标题教材：用于检查不同文件版本及手机换行的测试教材',
    ]);
    for (const [row, edition] of [[first, '人教版 · 2024 年审定'], [second, 'QA 夹具 · 另一文件版本']]) {
      await page.click(`${row} .shelf-more`);
      await page.click('[role="menuitem"]:text-is("查看教材信息")');
      await page.waitForSelector('.shelf-info[open]');
      assert.equal(await page.evaluate(() => document.querySelector('.shelf-info dd').textContent), edition);
      assert.equal(await page.evaluate(() => {
        const bounds = document.querySelector('.shelf-info').getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
      }), true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.shelf-info').open);
    }
    await page.evaluate(({ actual, other }) => {
      localStorage.setItem(`textbook-reading-v1:${actual}`, 'QA first version reading');
      localStorage.setItem(`textbook-reading-v1:${other}`, 'QA other version reading');
      localStorage.setItem(`textbook-personal-v1:${actual}`, 'QA first version personal content');
      localStorage.setItem(`textbook-personal-v1:${other}`, 'QA other version personal content');
    }, { actual: book.documentSha256, other: otherId });
    const protectedKeys = keys.slice(2);
    const snapshot = () => page.evaluate((names) => names.map((key) => localStorage.getItem(key)), protectedKeys);
    const protectedBefore = await snapshot();
    await page.click(`${second} .shelf-more`);
    await page.click('[role="menuitem"]:text-is("移出书架")');
    assert.equal(await page.evaluate((id) => !!document.getElementById(`shelf-cover-${id}`), book.documentSha256), true);
    assert.equal(await page.evaluate((id) => !!document.getElementById(`shelf-cover-${id}`), otherId), false);
    assert.deepEqual(await snapshot(), protectedBefore);
    await page.click('button:text-is("撤销移出")');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-cover').length), 2);
    await page.click(`${first} .shelf-more`);
    await page.click('[role="menuitem"]:text-is("移出书架")');
    await page.reload();
    await page.waitForSelector('.shelf-cover');
    assert.equal(await page.evaluate((id) => !!document.getElementById(`shelf-cover-${id}`), book.documentSha256), false);
    assert.equal(await page.evaluate((id) => !!document.getElementById(`shelf-cover-${id}`), otherId), true);
    assert.deepEqual(await snapshot(), protectedBefore);
    await page.click('.shelf-toolbar button:text-is("添加教材")');
    await page.click('.shelf-picker[open] .shelf-book:nth-child(1) button:text-is("添加到书架")');
    await page.click('button[aria-label="关闭教材选择"]');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-cover').length), 2);
    assert.deepEqual(await snapshot(), protectedBefore);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/same-title-versions.png` });
    return { testOnlyCatalog: true, sameTitleDistinctInformationAndMembership: true, otherVersionRemainsAfterRefresh: true,
      bothVersionsReadingAndPersonalRecordsPreserved: true, undoAndReAddNoDuplicate: true, longTitleWithinViewport: true };
  } finally {
    await page.evaluate((keys) => { for (const key of keys) localStorage.removeItem(key); }, keys);
    await page.reload();
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  }
}
