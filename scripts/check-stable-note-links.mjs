import assert from 'node:assert/strict';
import { openPersonalLibrary } from './check-personal-library.mjs';
import { readCloudPersonal } from './check-content-migration.mjs';
import { jumpToFilePage } from './check-related-return.mjs';

export async function startStableLinksServer({ port = 54935 } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'stable-links-check-origin', configureServer(vite) {
      vite.middlewares.use('/__stable_links_check', (_request, response) => {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ kind: 'reader-stable-links-05' }));
      });
    },
  }] });
  await server.listen();
  return server;
}

export async function startStableLinksCheck(page, { testOrigin, credentials }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal((await (await fetch(`${testOrigin}/__stable_links_check`)).json()).kind, 'reader-stable-links-05');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('textbook-personal-'))), false, 'Never migrate a user legacy source');
  await page.click('.account-summary');
  await page.click('.account-mode-toggle:text-is("测试账号登录")');
  await page.fill('.account-options input[name="email"]', credentials.email);
  await page.fill('.account-options input[name="password"]', credentials.password);
  await page.click('.account-options button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
  const initial = await readCloudPersonal(page);
  assert.equal(initial.userId, credentials.id);
  assert.deepEqual(initial.data, { supplements: [], notes: {} });
  await installSaveProbe(page);
  return { isolatedOrigin: true, freshSyntheticAccount: true, initialEmpty: true };
}

export async function installSaveProbe(page) {
  await page.evaluate(() => {
    if (window.qa05Network) return;
    const original = window.fetch;
    const probe = window.qa05Network = { original, mode: '', held: [], mail: 0, saves: 0 };
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.href).pathname;
      if (path === '/auth/v1/otp') { probe.mail++; return Promise.reject(new Error('QA05 forbids email')); }
      if (!path.endsWith('/rpc/reader_save_personal')) return original.call(window, input, init);
      probe.saves++;
      const mode = probe.mode; probe.mode = '';
      if (mode === 'fail') return Promise.resolve(new Response(JSON.stringify({ code: 'QA05', message: 'Synthetic atomic save failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      if (mode === 'hold') return new Promise((resolve, reject) => probe.held.push({ release: () => original.call(window, input, init).then(resolve, reject) }));
      return original.call(window, input, init);
    };
  });
}

export async function editorDocument(page) {
  return page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const { linkDocument } = await import('/src/reader/links/state.ts');
    const view = EditorView.findFromDOM(document.querySelector('.markdown-source .cm-content'));
    return linkDocument(view.state);
  });
}

export async function replaceEditor(page, text) {
  if (await page.evaluate(() => document.querySelector('.note-mode-toggle')?.getAttribute('aria-pressed') === 'true')) await page.click('.note-mode-toggle');
  await page.focus('.markdown-source .cm-content');
  await page.keyboard.press('ControlOrMeta+A');
  if (text) await page.keyboard.insertText(text); else await page.keyboard.press('Backspace');
}

export async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector('.markdown-editor')?.dataset.dirty === 'false');
}

export async function openDefaultNote(page, id = 'ch2-signed-change') {
  const number = await page.evaluate((id) => Number(document.querySelector(`button[data-supplement-ids~="${id}"]`)?.closest('.paper')?.id.slice(5)), id);
  assert.ok(number > 0);
  await jumpToFilePage(page, number);
  await page.click(`button[data-supplement-ids~="${id}"]`);
  if (await page.evaluate((id) => !!document.getElementById(`choice-${id}`), id)) await page.click(`#choice-${id}`);
  await page.waitForSelector('.personal-note .markdown-editor');
  return id;
}

export async function openPersonalNode(page, id) {
  await openPersonalLibrary(page);
  await page.click(`[data-personal-id="${id}"]`);
  await page.waitForSelector('.personal-actions');
}

export async function savePersonalEditor(page) {
  await page.click('.markdown-editor button[type="submit"]');
  await page.waitForSelector('.personal-actions button:text-is("编辑补充")');
}

export async function createIdentityFixtures(page) {
  const before = await readCloudPersonal(page);
  assert.equal(before.data.supplements.length, 0);
  for (const [title, body] of [['QA05 同名', '目标 A 的摘要'], ['QA05 同名', '目标 B 的摘要'], ['QA05 来源', '个人来源正文']]) {
    await openPersonalLibrary(page);
    await page.click('.personal-library button:text-is("新建补充")');
    await page.fill('.personal-title input', title);
    await page.selectOption('select[aria-label="章节"]', 'chapter-2');
    await page.selectOption('select[aria-label="节"]', '2.1');
    await replaceEditor(page, body);
    await savePersonalEditor(page);
  }
  const { data } = await readCloudPersonal(page);
  assert.equal(data.supplements.length, 3);
  const a = data.supplements.find((item) => item.markdown === '目标 A 的摘要');
  const b = data.supplements.find((item) => item.markdown === '目标 B 的摘要');
  const source = data.supplements.find((item) => item.title === 'QA05 来源');
  assert.notEqual(a.id, b.id); assert.equal(a.sectionId, b.sectionId);
  return { a: a.id, b: b.id, source: source.id };
}

export async function selectCandidate(page, query, targetSummary, { keyboard = false } = {}) {
  await page.keyboard.type(`[[${query}`);
  await page.waitForSelector('.cm-tooltip-autocomplete');
  if (keyboard) {
    await page.waitForFunction((summary) => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].some((item) => item.textContent.includes(summary)), targetSummary);
    const position = await page.evaluate((summary) => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].findIndex((item) => item.textContent.includes(summary)), targetSummary);
    for (let index = 0; index < position; index++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  } else await page.click(`.cm-tooltip-autocomplete li:has-text("${targetSummary}")`);
  await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
}

export async function selectEditorRange(page, from, to = from) {
  await page.evaluate(async ({ from, to }) => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('.markdown-source .cm-content'));
    view.dispatch({ selection: { anchor: from, head: to } }); view.focus();
  }, { from, to });
}

export async function checkRealEditorHistory(page, targetIds, { autosave = true } = {}) {
  const original = await editorDocument(page);
  const identities = original.bindings.map(({ id, target }) => [id, target.id]);
  assert.deepEqual(identities.map((item) => item[1]), targetIds);
  const check = async (expected) => assert.deepEqual((await editorDocument(page)).bindings.map(({ id, target }) => [id, target.id]), expected);
  await selectEditorRange(page, 0); await page.keyboard.insertText('前插🙂 '); await check(identities);
  let first = (await editorDocument(page)).bindings[0];
  await selectEditorRange(page, first.from + 2, first.to - 2); await page.keyboard.insertText('改写'); await check([identities[1]]);
  await page.keyboard.press('ControlOrMeta+Z'); await check(identities);
  await page.keyboard.press('ControlOrMeta+Shift+Z'); await check([identities[1]]);
  await page.keyboard.press('ControlOrMeta+Z'); await check(identities);
  first = (await editorDocument(page)).bindings[0];
  await selectEditorRange(page, first.from, first.to); await page.keyboard.press('Backspace'); await check([identities[1]]);
  await page.keyboard.press('ControlOrMeta+Z'); await check(identities);
  await page.keyboard.press('ControlOrMeta+Shift+Z'); await check([identities[1]]);
  await page.keyboard.press('ControlOrMeta+Z'); await check(identities);
  const current = await editorDocument(page);
  await selectEditorRange(page, current.markdown.length); await page.keyboard.paste(' [[QA05 同名]]'); await check(identities);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.unbound-links button').length), 1);
  await page.keyboard.press('ControlOrMeta+Z'); await check(identities);
  first = (await editorDocument(page)).bindings[0];
  await selectEditorRange(page, first.from, first.to); await page.keyboard.paste(`[[${first.label}]]`); await check([identities[1]]);
  await page.keyboard.press('ControlOrMeta+Z'); await check(identities);
  if (autosave) await waitSaved(page);
  return { instanceIdsPreserved: true, sameTitleDifferentTargets: true, frontInsertion: true, oneOccurrenceEdit: true,
    deleteUndoRedo: true, nativeUndoRedo: true, plainTextPasteUnbound: true, sameTextPasteUnbound: true };
}

export async function rebindFirst(page, summary) {
  const binding = (await editorDocument(page)).bindings[0];
  await selectEditorRange(page, binding.to - 2);
  await page.keyboard.press('Control+Space');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.click(`.cm-tooltip-autocomplete li:has-text("${summary}")`);
  await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
}

export async function checkAtomicNoteSave(page, fixtures, sourceId = 'ch2-signed-change') {
  const before = await editorDocument(page);
  await page.evaluate(() => { window.qa05Network.mode = 'hold'; });
  await rebindFirst(page, '目标 B 的摘要');
  await page.waitForFunction(() => window.qa05Network.held.length === 1);
  const pending = await editorDocument(page);
  assert.equal(pending.markdown, before.markdown);
  assert.equal(pending.bindings[0].target.id, fixtures.b);
  assert.equal(await page.evaluate(() => document.querySelector('.markdown-editor').dataset.dirty), 'true');
  await rebindFirst(page, '目标 A 的摘要');
  const latest = await editorDocument(page);
  await page.evaluate(() => { window.qa05Network.mode = 'fail'; window.qa05Network.held.shift().release(); });
  await page.waitForSelector('.editor-save-error [role="alert"]');
  assert.deepEqual(await editorDocument(page), latest);
  const committed = await readCloudPersonal(page);
  assert.deepEqual(committed.data.noteBindings[sourceId].map(({ target }) => target.id), [fixtures.b, fixtures.b]);
  assert.equal(committed.data.notes[sourceId], before.markdown);
  await page.click('.note-retry'); await waitSaved(page);
  const retried = await readCloudPersonal(page);
  assert.deepEqual(retried.data.noteBindings[sourceId], JSON.parse(JSON.stringify(latest.bindings)));
  assert.equal(retried.data.notes[sourceId], latest.markdown);
  return { bindingOnlyDirtyAndSaved: true, delayedOldSuccessKeepsLatestDraft: true, atomicFailureKeepsCommittedPair: true, retryCommitsLatestPair: true };
}

export async function checkCreateFlow(page, { note, sourceId, failOnce = false, resumeCancelled = false }) {
  const title = note ? 'QA05 新建默认' : 'QA05 新建个人';
  const before = await readCloudPersonal(page);
  const original = await editorDocument(page);
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    window.qa05SourceView = EditorView.findFromDOM(document.querySelector('.markdown-source .cm-content'));
  });
  if (!resumeCancelled) {
    await selectEditorRange(page, original.markdown.length); await page.keyboard.type(' ');
    await selectCandidate(page, title, '新建我的补充', { keyboard: true });
    await page.waitForSelector('.create-linked-node[open]');
    assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="新链接章节"]').value), 'chapter-2');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.create-linked-node'));
    assert.equal((await readCloudPersonal(page)).data.supplements.length, before.data.supplements.length);
  }
  await page.waitForFunction(() => document.activeElement?.classList.contains('cm-content'));
  await page.keyboard.press('Control+Space'); await page.waitForSelector('.cm-tooltip-autocomplete'); await page.keyboard.press('Enter');
  await page.waitForSelector('.create-linked-node[open]');
  await page.fill('textarea[name="linked-body"]', `${title}的非空内容`);
  if (failOnce) {
    await page.evaluate(() => window.qa05Network.mode = 'fail');
    await page.click('.create-linked-node button[type="submit"]'); await page.waitForSelector('.create-linked-node [role="alert"]');
    assert.equal((await readCloudPersonal(page)).data.supplements.length, before.data.supplements.length);
    assert.equal(await page.evaluate(() => document.querySelector('textarea[name="linked-body"]').value), `${title}的非空内容`);
  }
  await page.click('.create-linked-node button[type="submit"]'); await page.waitForFunction(() => !document.querySelector('.create-linked-node'));
  const draft = await editorDocument(page);
  assert.equal(draft.bindings.length, original.bindings.length + 1);
  const created = (await readCloudPersonal(page)).data.supplements.find((item) => item.title === title);
  assert.ok(created); assert.equal(draft.bindings.at(-1).target.id, created.id);
  assert.equal(await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    return window.qa05SourceView === EditorView.findFromDOM(document.querySelector('.markdown-source .cm-content'));
  }), true, 'Creating/canceling keeps the actual source EditorView');
  await page.keyboard.press('ControlOrMeta+Z');
  assert.equal((await editorDocument(page)).bindings.length, original.bindings.length);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  assert.deepEqual((await editorDocument(page)).bindings, draft.bindings);
  if (note) await waitSaved(page);
  else {
    assert.deepEqual((await readCloudPersonal(page)).data.supplements.find((item) => item.id === sourceId).bindings, original.bindings);
    await savePersonalEditor(page);
  }
  return { cancelLeavesNoNode: true, explicitCreateHasBody: true, failedCreateRetried: failOnce, sourceEditorAndHistoryPreserved: true,
    sourceCommitUsesOriginalSaveMode: true, createdId: created.id };
}

export async function checkTargetLifecycle(page, fixtures) {
  await openPersonalNode(page, fixtures.a);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.fill('.personal-title input', 'QA05 改名A'); await savePersonalEditor(page);
  await openDefaultNote(page);
  const original = await editorDocument(page);
  const link = original.bindings.find(({ target }) => target.id === fixtures.a);
  assert.ok(link);
  assert.equal(await page.evaluate((id) => document.querySelector(`.node-link[data-link-id="${id}"]`).title, link.id), 'QA05 改名A');
  await page.click(`.node-link[data-link-id="${link.id}"]`);
  assert.equal(await page.evaluate(() => document.getElementById('supplement-title').textContent), 'QA05 改名A');
  await page.click('.personal-actions button:text-is("删除补充")');
  await page.click('.delete-confirmation button:text-is("确认删除")');
  await page.waitForSelector('.personal-library');
  await page.click('.personal-library button:text-is("新建补充")');
  await page.fill('.personal-title input', 'QA05 同名');
  await page.selectOption('select[aria-label="章节"]', 'chapter-2'); await page.selectOption('select[aria-label="节"]', '2.1');
  await replaceEditor(page, '新建同名 C 的摘要'); await savePersonalEditor(page);
  const created = (await readCloudPersonal(page)).data.supplements.find((item) => item.markdown === '新建同名 C 的摘要');
  assert.notEqual(created.id, fixtures.a);
  await openDefaultNote(page);
  assert.equal(await page.evaluate((id) => !!document.querySelector(`.node-link-invalid[data-link-id="${id}"]`), link.id), true);
  assert.deepEqual((await editorDocument(page)).bindings, original.bindings);
  await page.reload(); await page.waitForFunction(() => document.getElementById('add-personal-supplement')?.disabled === false);
  await installSaveProbe(page); await openDefaultNote(page);
  assert.equal(await page.evaluate((id) => !!document.querySelector(`.node-link-invalid[data-link-id="${id}"]`), link.id), true);
  assert.equal((await editorDocument(page)).bindings.find(({ id }) => id === link.id).target.id, fixtures.a);
  return { renamedTargetKeepsIdentity: true, deletedTargetMarkedInvalid: true, sameNameNewNodeDoesNotAdopt: true,
    refreshKeepsInvalidIdentity: true, recreatedId: created.id };
}

export async function beforeUnloadListeners(page) {
  const result = await page.cdp('Runtime.evaluate', {
    expression: '(getEventListeners(window).beforeunload || []).length',
    includeCommandLineAPI: true, returnByValue: true,
  });
  return result.result.value;
}

export async function createDraftForUnloadCheck(page, text = 'QA05 创建表单未保存正文') {
  await openDefaultNote(page);
  await replaceEditor(page, '[[QA05 创建草稿修复');
  await waitSaved(page);
  await page.keyboard.press('Control+Space'); await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.click('.cm-tooltip-autocomplete li:has-text("新建我的补充")'); await page.waitForSelector('.create-linked-node[open]');
  await page.fill('textarea[name="linked-body"]', text);
  assert.equal(await page.evaluate(() => document.querySelector('.markdown-editor').dataset.dirty), 'false', 'The source note itself is already saved');
}

export async function beforeUnloadCancelled(page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}
