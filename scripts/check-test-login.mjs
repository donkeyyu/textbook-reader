import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openNote } from './check-related-return.mjs';
import { readCloudPersonal, replaceMigrationNote, waitForCloudNote } from './check-content-migration.mjs';

async function guardEmail(page) {
  await page.evaluate(() => {
    const original = window.fetch;
    window.testLoginEmailGuard = { original, attempts: 0 };
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/auth/v1/otp') {
        window.testLoginEmailGuard.attempts++;
        return Promise.reject(new Error('Email sending is outside this password check'));
      }
      return original.call(this, input, init);
    };
  });
}

async function passwordForm(page) {
  if (!await page.evaluate(() => document.querySelector('.account-options').open)) await page.click('.account-summary');
  if (!await page.evaluate(() => !!document.querySelector('.account-options input[name="password"]'))) {
    await page.click('.account-mode-toggle:text-is("测试账号登录")');
  }
}

async function login(page, credentials) {
  await passwordForm(page);
  await page.fill('.account-options input[name="email"]', credentials.email);
  await page.fill('.account-options input[name="password"]', credentials.password);
  await page.click('.account-options button[type="submit"]');
  await page.waitForFunction((email) => document.querySelector('.account-email')?.textContent === email &&
    ![...document.querySelectorAll('.toolbar-actions > button')].find((button) => button.textContent === '添加补充')?.disabled, credentials.email);
  assert.equal((await readCloudPersonal(page)).userId, credentials.id);
  assert.equal(await page.evaluate(() => document.querySelector('.account-options').open), false);
}

// Use a newly provisioned dedicated QA account and an owned, marked test origin.
// Never pass a reader's ordinary account or an origin with legacy personal data.
export async function checkTestPasswordLogin(page, { testOrigin, credentials }) {
  assert.ok(credentials?.id && credentials.email && credentials.password);
  assert.equal(new URL(await page.url()).origin, testOrigin);
  const marker = await fetch(`${testOrigin}/__content_migration_check`);
  assert.equal((await marker.json()).kind, 'reader-content-migration');
  const initial = await page.evaluate(() => ({
    legacy: Object.keys(localStorage).some((key) => key.startsWith('textbook-personal-v1:')),
    signedIn: !!document.querySelector('.account-email'),
    dirty: !!document.querySelector('[data-dirty="true"]'),
  }));
  assert.deepEqual(initial, { legacy: false, signedIn: false, dirty: false });
  const noteId = 'ch1-measurement-exercise';
  const note = `QA password login ${randomUUID()}`;
  await guardEmail(page);
  try {
    await passwordForm(page);
    await page.fill('.account-options input[name="email"]', credentials.email);
    await page.fill('.account-options input[name="password"]', `${credentials.password}-incorrect`);
    await page.click('.account-options button[type="submit"]');
    await page.waitForSelector('.account-error[role="alert"]');
    assert.equal(await page.evaluate(() => document.querySelector('.account-options input[name="email"]').value), credentials.email);
    await login(page, credentials);
    const before = await readCloudPersonal(page);
    assert.equal(before.data.notes[noteId], undefined, 'The dedicated QA note must be unused');
    await openNote(page, noteId);
    await replaceMigrationNote(page, note);
    await waitForCloudNote(page, noteId, note);
    assert.equal(await page.evaluate(() => window.testLoginEmailGuard.attempts), 0);
    await page.reload();
    await page.waitForFunction(() => !!document.querySelector('.account-email'));
    await guardEmail(page);
    assert.equal((await readCloudPersonal(page)).data.notes[noteId], note);
    await page.click('.account-summary');
    await page.click('.account-options button:text-is("退出登录")');
    await page.waitForFunction(() => !document.querySelector('.account-email'));
    const denied = await page.evaluate(async () => {
      const { supabase } = await import('/src/reader/supabase.ts');
      return (await supabase.from('reader_personal').select('*')).error?.code;
    });
    assert.equal(denied, '42501');
    await passwordForm(page);
    assert.equal(await page.evaluate(() => document.querySelector('.account-options input[name="password"]').value), '');
    await login(page, credentials);
    assert.equal((await readCloudPersonal(page)).data.notes[noteId], note);
    await openNote(page, noteId);
    await replaceMigrationNote(page, '');
    const restored = await waitForCloudNote(page, noteId, null);
    assert.deepEqual(restored.data, before.data, 'Remove only the QA note created by this check');
    assert.equal(await page.evaluate(() => window.testLoginEmailGuard.attempts), 0);
    return { wrongPasswordRejected: true, emailRetainedForRetry: true, passwordLoginSucceeded: true,
      cloudSaveAndRefresh: true, signOutRemovedPrivateAccess: true, signInAgainPreservedData: true,
      passwordCleared: true, noEmailSent: true, ownNoteRemoved: true };
  } finally {
    await page.evaluate(() => {
      if (window.testLoginEmailGuard) window.fetch = window.testLoginEmailGuard.original;
      delete window.testLoginEmailGuard;
    });
  }
}

export async function checkProductionPasswordLoginHidden(page) {
  await page.waitForSelector('.account-summary');
  await page.click('.account-summary');
  assert.equal(await page.evaluate(() => !!document.querySelector('.account-mode-toggle, input[name="password"]')), false);
  assert.equal(await page.evaluate(() => document.querySelector('.account-options button[type="submit"]').textContent), '发送登录邮件');
  return { testPasswordEntryAbsent: true, emailLoginUnchanged: true };
}
