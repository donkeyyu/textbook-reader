import assert from 'node:assert/strict';
import { openNote } from './check-related-return.mjs';
import { readCloudPersonal, replaceMigrationNote } from './check-content-migration.mjs';

// Only an owned marked origin and its dedicated QA account. Auth/password and
// successful reads use the real SDK; email requests are always intercepted.
export async function checkSharedAccountFailures(page, { testOrigin, credentials }) {
  assert.ok(testOrigin && credentials?.id && credentials.email && credentials.password);
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal((await (await fetch(`${testOrigin}/__content_migration_check`)).json()).kind, 'reader-content-migration');
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  const before = await readCloudPersonal(page);
  assert.equal(before.userId, credentials.id);
  const local = await page.evaluate(() => ({ shelf: localStorage.getItem('textbook-shelf-v1'), startup: localStorage.getItem('textbook-startup-v1') }));
  await page.evaluate(() => {
    if (window.sharedAccountFailures) throw new Error('A failure check is already active');
    const original = window.fetch;
    const probe = window.sharedAccountFailures = { original, mode: {}, held: {}, counts: { otp: 0, logout: 0, personal: 0 } };
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.href).pathname;
      const kind = path === '/auth/v1/otp' ? 'otp' : path === '/auth/v1/logout' ? 'logout'
        : path === '/rest/v1/rpc/reader_migrate_legacy' ? 'personal' : null;
      if (!kind) return original.call(this, input, init);
      probe.counts[kind]++;
      const mode = probe.mode[kind];
      if (kind === 'otp' || mode) {
        return new Promise((resolve) => {
          probe.held[kind] = () => {
            delete probe.held[kind]; delete probe.mode[kind];
            const success = mode === 'success';
            resolve(new Response(JSON.stringify(success ? {} : { msg: 'QA deliberate request failure', code: 'QA_FAILURE' }),
              { status: success ? 200 : kind === 'personal' ? 503 : 400, headers: { 'Content-Type': 'application/json' } }));
          };
        });
      }
      return original.call(this, input, init);
    };
  });
  async function hold(kind, mode = 'failure') {
    await page.evaluate(({ kind, mode }) => { window.sharedAccountFailures.mode[kind] = mode; }, { kind, mode });
  }
  async function release(kind) {
    await page.waitForFunction((kind) => !!window.sharedAccountFailures.held[kind], kind);
    await page.evaluate((kind) => window.sharedAccountFailures.held[kind](), kind);
  }
  try {
    await hold('logout');
    await page.click('.account-summary');
    await page.click('.account-options button:text-is("退出登录")');
    await page.waitForFunction(() => !!window.sharedAccountFailures.held.logout);
    assert.equal(await page.evaluate(() => document.querySelector('.account-options').getAttribute('aria-busy')), 'true');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.account-options button')].some(button => button.disabled && button.textContent.includes('正在退出'))), true);
    await release('logout');
    await page.waitForSelector('.account-error[role="alert"]');
    // The bundled auth-js clears the local session even if remote logout fails.
    assert.equal(await page.evaluate(() => !!document.querySelector('.account-email')), false);
    assert.equal(await page.evaluate(() => !!document.querySelector('.personal-note .cm-content')), false);
    await page.click('.account-mode-toggle:text-is("测试账号登录")');
    await page.fill('.account-options input[name="email"]', credentials.email);
    await page.fill('.account-options input[name="password"]', credentials.password);
    await page.click('.account-options button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('.account-options').open && document.getElementById('add-personal-supplement')?.disabled === false);
    await page.click('.account-summary');
    await page.click('.account-options button:text-is("退出登录")');
    await page.waitForFunction(() => !document.querySelector('.account-email') && !document.querySelector('.account-options').open);

    await page.click('.account-summary');
    await page.fill('.account-options input[name="email"]', credentials.email);
    for (const mode of ['failure', 'success']) {
      await hold('otp', mode);
      await page.click('.account-options button[type="submit"]');
      await page.waitForFunction(() => !!window.sharedAccountFailures.held.otp);
      assert.equal(await page.evaluate(() => document.querySelector('.account-options button[type="submit"]').disabled), true);
      await release('otp');
      await page.waitForSelector(mode === 'success' ? '.account-message[role="status"]' : '.account-error[role="alert"]');
      assert.equal(await page.evaluate((email) => document.querySelector('.account-options input[name="email"]').value === email, credentials.email), true);
    }
    assert.equal(await page.evaluate(() => window.sharedAccountFailures.counts.otp), 2);
    await page.keyboard.press('Escape');

    await hold('personal');
    await page.click('.account-summary');
    await page.click('.account-mode-toggle:text-is("测试账号登录")');
    await page.fill('.account-options input[name="email"]', credentials.email);
    await page.fill('.account-options input[name="password"]', credentials.password);
    await page.click('.account-options button[type="submit"]');
    await page.waitForFunction(() => !!window.sharedAccountFailures.held.personal);
    assert.equal(await page.evaluate(() => document.querySelector('.account-options').open), false);
    assert.equal(await page.evaluate(() => document.getElementById('add-personal-supplement').disabled), true);
    assert.equal(await page.evaluate(() => !!document.querySelector('.loading-toast[role="status"]')), true);
    await openNote(page, 'ch1-measurement-exercise');
    assert.equal(await page.evaluate(() => !!document.getElementById('supplement-title')), true);
    assert.equal(await page.evaluate(() => !!document.querySelector('.personal-note .cm-content')), false);
    await release('personal');
    await page.waitForSelector('.storage-error[role="alert"]');
    assert.equal(await page.evaluate(() => document.getElementById('add-personal-supplement').disabled), true);
    await page.click('.storage-error button:text-is("重新读取")');
    await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
    const after = await readCloudPersonal(page);
    assert.deepEqual(after.data, before.data);
    assert.deepEqual(after.copies, before.copies);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(await page.evaluate(() => ({ shelf: localStorage.getItem('textbook-shelf-v1'), startup: localStorage.getItem('textbook-startup-v1') })), local);
    return { signOutWaitingAndFailureRetry: true, failedRemoteLogoutClearedLocalPrivateContent: true,
      signOutRecoveryThroughPasswordLogin: true, emailWaitingFailureAndRetryFeedback: true,
      emailRequestsIntercepted: 2, realEmailsSent: 0, personalLoadingDisablesEditing: true,
      defaultExplanationReadableWhilePersonalFails: true, personalReadFailureRetry: true,
      localShelfAndDestinationPreserved: true, ownCloudContentUnchanged: true };
  } finally {
    await page.evaluate(() => {
      const probe = window.sharedAccountFailures;
      for (const release of Object.values(probe.held)) release();
      window.fetch = probe.original;
      delete window.sharedAccountFailures;
    });
  }
}

export async function checkActiveAccountDraftGuard(page, { testOrigin, credentials }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  const before = await readCloudPersonal(page);
  assert.equal(before.userId, credentials.id);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  await page.evaluate(() => {
    const original = window.fetch;
    window.activeAccountDraftFetch = original;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/rest/v1/rpc/reader_save_personal') {
        return Promise.resolve(new Response(JSON.stringify({ code: 'QA_DRAFT', message: 'QA rejected save' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }));
      }
      return original.call(this, input, init);
    };
  });
  const draft = 'QA active account unsaved draft';
  try {
    await openNote(page, 'ch1-measurement-exercise');
    await replaceMigrationNote(page, draft);
    await page.waitForFunction(() => !!document.querySelector('.personal-note [role="alert"]') && !document.querySelector('[data-saving="true"]'));
    const startup = await page.evaluate(() => localStorage.getItem('textbook-startup-v1'));
    await page.click('.account-summary'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), draft);
    await page.click('.account-summary');
    await page.click('.account-options button:text-is("退出登录")');
    await page.dismissDialog();
    await page.waitForSelector('.account-error[role="alert"]');
    assert.equal((await readCloudPersonal(page)).userId, credentials.id);
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), draft);
    await page.keyboard.press('Escape');
    await page.click('.return-to-shelf'); await page.dismissDialog();
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), draft);
    assert.equal(await page.evaluate(() => localStorage.getItem('textbook-startup-v1')), startup);
    assert.deepEqual((await readCloudPersonal(page)).data, before.data);
    await page.click('.return-to-shelf'); await page.acceptDialog();
    await page.waitForSelector('.shelf-toolbar');
    await page.click('.storage-error button:text-is("重新读取")');
    await page.waitForFunction(() => !document.querySelector('.storage-error') && !document.querySelector('.content-status') && !document.querySelector('.loading-toast'));
    return { actualFailedNoteDraft: true, ordinaryAccountOpenClosePreservedDraft: true,
      canceledSignOutKeptSessionAndDraft: true, canceledReturnKeptDraftAndDestination: true,
      explicitDiscardThenReadRecovered: true, ownCloudContentUnchanged: true };
  } finally {
    await page.evaluate(() => { window.fetch = window.activeAccountDraftFetch; delete window.activeAccountDraftFetch; });
  }
}
