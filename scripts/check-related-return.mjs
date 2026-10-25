import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chapter = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/chapter-1.json', import.meta.url), 'utf8'));
const positioning = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/locations.json', import.meta.url), 'utf8'));
const locations = new Map(positioning.locations.map((location) => [location.id, location]));
export const reviewCases = chapter.supplements.flatMap((note) => note.related.map((link) => ({ note, link })));

async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('.reading-message'), undefined, { timeout: 30_000 });
}

export async function jumpToFilePage(page, number) {
  if (!await page.evaluate(() => !!document.querySelector('#page-input'))) await page.click('.page-index');
  await page.selectOption('select[aria-label="跳页方式"]', 'file');
  await page.fill('#page-input', String(number));
  await page.press('#page-input', 'Enter');
  await settled(page);
}

export async function openNote(page, id) {
  const note = chapter.supplements.find((item) => item.id === id);
  assert.ok(note, id);
  await jumpToFilePage(page, locations.get(note.locationId).page);
  await clickNoteMarker(page, id);
}

async function clickNoteMarker(page, id) {
  const marker = `[data-supplement-ids~="${id}"]`;
  await page.click(marker, { timeout: 30_000 });
  if (await page.evaluate((noteId) => !!document.getElementById(`choice-${noteId}`), id)) await page.click(`#choice-${id}`, { timeout: 30_000 });
  await settled(page);
}

export async function checkAccordion(page, id) {
  await openNote(page, id);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.supplement-accordion summary')].map((summary) => summary.id));
  assert.ok(ids.length > 1, 'Choose a note whose marker is grouped at this width');
  const selected = `choice-${id}`;
  const opened = () => page.evaluate(() => [...document.querySelectorAll('.supplement-accordion[open] summary')].map((summary) => summary.id));
  assert.deepEqual(await opened(), [selected]);
  const method = `#method-${id}`;
  const hasMethod = await page.evaluate((selector) => !!document.querySelector(selector), method);
  if (hasMethod) await page.click(method);
  await page.press(`#${selected}`, 'Enter');
  assert.deepEqual(await opened(), [], 'Enter collapses the current explanation');
  await page.press(`#${selected}`, 'Space');
  assert.deepEqual(await opened(), [selected], 'Space expands the explanation');
  if (hasMethod) assert.equal(await page.evaluate((selector) => document.querySelector(selector).getAttribute('aria-expanded'), method), 'false', 'Directly reopening a grouped guide starts its method collapsed');
  const other = ids.find((item) => item !== selected);
  await page.click(`#${other}`, { timeout: 30_000 });
  assert.deepEqual(await opened(), [other], 'Selecting another title keeps only that explanation open');
  assert.ok(await page.evaluate(() => {
    const panel = document.querySelector('#supplement-panel').getBoundingClientRect();
    const summary = document.querySelector('.supplement-accordion[open] summary').getBoundingClientRect();
    return summary.bottom > panel.top && summary.top < panel.bottom;
  }), 'The selected title stays visible after the preceding explanation collapses');
  console.log(`PASS accordion keyboard and switching: ${id}`);
}

export async function readingSnapshot(page, sourcePage) {
  return page.evaluate((number) => {
    const paper = document.querySelector(`#page-${number}`).getBoundingClientRect();
    const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
    return {
      fraction: (viewport.top - paper.top) / paper.height,
      panelScroll: document.querySelector('#supplement-panel')?.scrollTop ?? 0,
      title: document.querySelector('#supplement-title')?.textContent,
      expanded: document.querySelector('.supplement-accordion[open] summary')?.id ?? null,
      focus: document.activeElement?.id,
      highlight: document.querySelector('.location-highlight')?.id ?? null,
      back: !!document.querySelector('.return-button'),
      methods: [...document.querySelectorAll('.method-toggle[aria-expanded="true"]')].map((button) => button.id),
    };
  }, sourcePage);
}

export async function checkReviewCase(page, index) {
  const { note, link } = reviewCases[index];
  const sourcePage = locations.get(note.locationId).page;
  const selector = `#related-${note.id}-${link.locationId}`;
  await openNote(page, note.id);
  if (note.questionGuide && index % 2 === 0) await page.click(`#method-${note.id}`);
  await page.focus(selector);
  const before = await readingSnapshot(page, sourcePage);
  await page.click(selector);
  await settled(page);
  await page.waitForSelector(`#location-${link.locationId}`);
  assert.ok(await page.evaluate(() => !!document.querySelector('#supplement-panel .return-button')));
  assert.equal(await page.evaluate((id) => [...document.querySelectorAll('.supplement-related button')].some((button) => button.id.endsWith(`-${id}`)), link.locationId), false, 'Active target is not offered again');
  await page.click('#supplement-panel .return-button');
  await settled(page);
  const after = await readingSnapshot(page, sourcePage);
  assert.equal(after.title, before.title);
  assert.equal(after.expanded, before.expanded, 'Return restores the expanded explanation');
  assert.deepEqual(after.methods, before.methods, 'Return restores the source method state');
  assert.equal(after.back, false, 'One link creates exactly one return entry');
  assert.equal(after.highlight, before.highlight);
  assert.equal(after.focus, selector.slice(1), 'Return restores focus to its source link');
  assert.ok(Math.abs(after.fraction - before.fraction) < .005, `Reading position changed: ${before.fraction} → ${after.fraction}`);
  assert.ok(Math.abs(after.panelScroll - before.panelScroll) < 2, 'Drawer scroll must be restored');
  console.log(`PASS ${index + 1}/${reviewCases.length}: ${note.id} → ${link.locationId} → return`);
}

export async function checkReviewChain(page, targets) {
  await openNote(page, 'ch1-number-line-review');
  const sources = [];
  for (const target of targets) {
    const selector = `.supplement-related button[id$="-${target}"]`;
    await page.focus(selector);
    const locationId = await page.evaluate(() => document.querySelector('.location-highlight')?.id.replace('location-', ''));
    const sourcePage = locations.get(locationId)?.page ?? 28;
    sources.push({ sourcePage, snapshot: await readingSnapshot(page, sourcePage) });
    await page.click(selector);
    await settled(page);
    await page.waitForSelector(`#location-${target}`);
  }
  for (const { sourcePage, snapshot: source } of sources.reverse()) {
    await page.click('.return-button');
    await settled(page);
    const restored = await readingSnapshot(page, sourcePage);
    assert.equal(restored.title, source.title);
    assert.equal(restored.highlight, source.highlight);
    assert.equal(restored.focus, source.focus);
    assert.equal(restored.back, source.back);
    assert.deepEqual(restored.methods, source.methods);
    assert.ok(Math.abs(restored.fraction - source.fraction) < .005);
    assert.ok(Math.abs(restored.panelScroll - source.panelScroll) < 2);
  }
  console.log(`PASS chain: ${targets.join(' → ')}; every return restores its source`);
}

export async function checkReviewExit(page, action) {
  await openNote(page, 'ch1-number-line-review');
  await page.click('#related-ch1-number-line-review-ch1-order-on-axis');
  await settled(page);
  if (action === 'close') await page.click('button[aria-label="关闭解读"]');
  else if (action === 'escape') await page.press('#location-ch1-order-on-axis', 'Escape');
  else if (action === 'page-input') {
    await jumpToFilePage(page, 30);
  } else if (action === 'thumbnail') {
    if (await page.evaluate(() => document.querySelector('#page-sidebar').hidden)) await page.click('.navigation-toggle');
    await page.click('#thumbnail-30');
  } else await page.click(`button[aria-label="${action === 'next' ? '下一页' : '上一页'}"]`);
  await settled(page);
  const state = await page.evaluate(() => ({
    panel: !!document.querySelector('#supplement-panel'),
    highlight: !!document.querySelector('.location-highlight'),
    back: !!document.querySelector('.return-button'),
    focus: document.activeElement?.id,
  }));
  assert.equal(state.panel, false, `${action} must close the review`);
  assert.equal(state.highlight, false, `${action} must clear the review location`);
  assert.equal(state.back, false);
  if (action === 'close' || action === 'escape') assert.match(state.focus, /^page-/, 'Closing a distant source must focus the current page');
  await openNote(page, 'ch1-deviation');
  assert.equal(await page.evaluate(() => !!document.querySelector('.return-button')), false);
  console.log(`PASS exit: ${action} clears review state; a fresh note has no return`);
}

export async function checkReviewFailures(page) {
  await openNote(page, 'ch1-number-line-review');
  await page.click('#related-ch1-number-line-review-ch1-order-on-axis');
  await settled(page);
  const before = await readingSnapshot(page, 28);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.restoreReviewDecode = () => { HTMLImageElement.prototype.decode = decode; };
    HTMLImageElement.prototype.decode = function () {
      return this.src.endsWith('/page-20.webp') ? Promise.reject(new Error('test image failure')) : decode.call(this);
    };
  });
  try {
    await page.click('#related-ch1-number-line-review-ch1-absolute-definition');
    await page.waitForSelector('.reading-message[role="alert"]');
    const failed = await readingSnapshot(page, 28);
    assert.equal(failed.highlight, before.highlight);
    assert.equal(failed.title, before.title);
    assert.equal(failed.back, before.back);
    assert.ok(Math.abs(failed.fraction - before.fraction) < .005);
  } finally {
    await page.evaluate(() => { window.restoreReviewDecode(); delete window.restoreReviewDecode; });
  }
  await page.click('.reading-message button');
  await settled(page);
  await page.waitForSelector('#location-ch1-absolute-definition');
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, 28)).highlight, before.highlight);
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, 28)).back, false, 'Failure and retry must not duplicate history');

  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.restoreReviewDecode = () => { HTMLImageElement.prototype.decode = decode; };
    HTMLImageElement.prototype.decode = function () {
      return this.src.endsWith('/page-18.webp')
        ? new Promise((resolve) => { window.releaseReviewDecode = resolve; })
        : decode.call(this);
    };
  });
  try {
    await page.click('#related-ch1-number-line-review-ch1-opposite-geometry');
    await page.waitForSelector('.reading-message[role="status"]');
    await page.click('button[aria-label="关闭解读"]');
    await page.evaluate(() => window.releaseReviewDecode());
    await settled(page);
    const canceled = await readingSnapshot(page, 28);
    assert.equal(canceled.title, undefined);
    assert.equal(canceled.highlight, null);
    assert.equal(canceled.back, false, 'Late completion must not restore a closed review');
  } finally {
    await page.evaluate(() => {
      window.restoreReviewDecode();
      delete window.restoreReviewDecode;
      delete window.releaseReviewDecode;
    });
  }
  await openNote(page, 'ch1-measurement-exercise');
  await page.evaluate(() => {
    const button = document.querySelector('#related-ch1-measurement-exercise-ch1-deviation');
    button.click(); button.click();
  });
  await settled(page);
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, 13)).back, false, 'Rapid clicks create only one entry');
  console.log('PASS failures: failure/retry preserves history; cancellation ignores late results; rapid clicks do not duplicate');
}

// Run with an ego-browser Page already open on the local reader.
export async function checkRelatedReturn(page) {
  const note = chapter.supplements.find((item) => item.id === 'ch1-guess-range');
  const related = '#related-ch1-guess-range-ch1-order-on-axis';
  await openNote(page, note.id);
  await page.click(related);
  await page.waitForSelector('#location-ch1-order-on-axis');
  const repeatsTarget = await page.evaluate((selector) => !!document.querySelector(selector), related);
  if (repeatsTarget) {
    await page.click(related);
    await page.waitForFunction(() => !document.querySelector('.reading-message'));
  }
  await page.click('#supplement-panel .return-button');
  await page.waitForFunction(() => !document.querySelector('.reading-message'));
  const restored = await page.evaluate(() => ({
    page: document.querySelector('.page-index span').textContent.match(/(\d+)\//)[1],
    back: !!document.querySelector('.return-button'),
    title: document.querySelector('#supplement-title').textContent,
  }));
  assert.equal(restored.page, String(locations.get(note.locationId).page), 'One return must reach the source, not the repeated review target');
  assert.equal(restored.back, false, 'A repeated target must not add a duplicate history entry');
  assert.equal(restored.title, note.title);
  assert.equal(repeatsTarget, false, 'The active review target must not remain a navigation link');
  assert.ok(await page.evaluate((selector) => !!document.querySelector(selector), related), 'Returning restores the review link');
  console.log('PASS: review target cannot repeat; one return restores its source and link');
}


export async function checkOnDemandMethod(page, id) {
  const note = chapter.supplements.find((item) => item.id === id);
  assert.ok(note?.questionGuide, 'Choose an existing question guide');
  await openNote(page, id);
  const button = `#method-${id}`;
  const content = `#method-content-${id}`;
  const sourcePage = locations.get(note.locationId).page;
  const state = () => page.evaluate(({ button, content }) => ({
    expanded: document.querySelector(button)?.getAttribute('aria-expanded'),
    visible: document.querySelector(content)?.checkVisibility(),
    method: [...document.querySelectorAll(`${content} p`)].map((item) => item.textContent),
    knowledge: [...document.querySelectorAll('.question-guide section[aria-label="考查知识点"] p')].map((item) => item.textContent),
    cautions: [...document.querySelectorAll('.question-guide section[aria-label="注意事项"] p')].map((item) => item.textContent),
    related: !!document.querySelector('.supplement-related'),
  }), { button, content });
  const initial = await state();
  assert.equal(initial.expanded, 'false');
  assert.equal(initial.visible, false);
  assert.deepEqual(initial.method, note.questionGuide.method, 'Original method content is retained');
  assert.deepEqual(initial.knowledge, note.questionGuide.knowledgePoints);
  assert.deepEqual(initial.cautions, note.questionGuide.cautions);
  assert.ok(initial.related);
  const before = await readingSnapshot(page, sourcePage);
  await page.click(button);
  assert.equal((await state()).visible, true);
  await page.press(button, 'Enter');
  assert.equal((await state()).visible, false);
  await page.press(button, 'Space');
  assert.equal((await state()).visible, true);
  assert.equal((await state()).expanded, 'true');
  const after = await readingSnapshot(page, sourcePage);
  assert.ok(Math.abs(after.fraction - before.fraction) < .005, 'Method toggles keep the textbook region');
  await clickNoteMarker(page, id);
  assert.equal((await state()).visible, false, 'Opening the marker again starts collapsed');
  await page.click(button);
  await page.click('button[aria-label="关闭解读"]');
  await openNote(page, id);
  assert.equal((await state()).visible, false, 'Closing clears method state');
  await page.click(button);
  await page.reload();
  await page.waitForSelector('.page-index');
  assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel')), false, 'Refresh does not restore a panel');
  await openNote(page, id);
  assert.equal((await state()).visible, false, 'Re-entering after refresh starts collapsed');
  console.log(`PASS on-demand method: ${id}; default, click, keyboard, reopen, close, refresh`);
}

export async function checkMethodDraft(page, id) {
  await openNote(page, id);
  if (await page.evaluate(() => !document.querySelector('.personal-note .cm-content'))) await page.click('.personal-note .note-heading button');
  await page.focus('.personal-note .cm-content');
  await page.press('.personal-note .cm-content', 'ControlOrMeta+End');
  await page.keyboard.insertText(' 方法开合草稿检查');
  const draft = await page.evaluate(() => {
    window.methodDraftEditor = document.querySelector('.personal-note .cm-content');
    window.methodDraftConfirm = window.confirm;
    window.methodDraftPrompts = 0;
    window.confirm = () => { window.methodDraftPrompts += 1; return false; };
    return window.methodDraftEditor.textContent;
  });
  try {
    assert.ok(await page.evaluate(() => !!document.querySelector('.personal-note [data-dirty="true"]')));
    await page.click(`#method-${id}`);
    assert.equal(await page.evaluate((id) => document.getElementById(`method-${id}`).getAttribute('aria-expanded'), id), 'true');
    await page.press(`#method-${id}`, 'Enter');
    await page.press(`#method-${id}`, 'Space');
    assert.deepEqual(await page.evaluate(() => ({
      sameEditor: document.querySelector('.personal-note .cm-content') === window.methodDraftEditor,
      draft: document.querySelector('.personal-note .cm-content').textContent,
      dirty: !!document.querySelector('.personal-note [data-dirty="true"]'),
      prompts: window.methodDraftPrompts,
    })), { sameEditor: true, draft, dirty: true, prompts: 0 }, 'Click and keyboard toggles preserve the unsaved editor without asking to discard');
    await page.click('button[aria-label="关闭解读"]');
    assert.ok(await page.evaluate(() => !!document.querySelector('.personal-note [data-dirty="true"]')), 'Canceling a destructive close still protects the draft');
  } finally {
    await page.evaluate(() => {
      window.confirm = window.methodDraftConfirm;
      delete window.methodDraftConfirm;
      delete window.methodDraftEditor;
      delete window.methodDraftPrompts;
    });
    await page.press('.personal-note .cm-content', 'ControlOrMeta+z');
  }
  assert.ok(await page.evaluate(() => !document.querySelector('.personal-note [data-dirty="true"]')), 'Undo removes only the test draft');
  console.log(`PASS method draft: ${id}; mouse and keyboard preserve unsaved text; canceled close still protects it`);
}

export async function checkMethodReturnChain(page) {
  const id = 'ch1-exercise-1-1-8';
  await openNote(page, id);
  await page.click(`#method-${id}`);
  const sources = [];
  const first = chapter.supplements.find((item) => item.id === id);
  const second = chapter.supplements.find((item) => item.id === 'ch1-direction-exercise');
  for (const [note, target] of [[first, second.locationId], [second, second.related[0].locationId]]) {
    const selector = `#related-${note.id}-${target}`;
    const sourcePage = locations.get(note.locationId).page;
    await page.focus(selector);
    sources.push({ sourcePage, snapshot: await readingSnapshot(page, sourcePage) });
    await page.click(selector);
    await settled(page);
    const toggle = await page.evaluate(() => document.querySelector('.method-toggle')?.id);
    if (toggle) await page.click(`#${toggle}`);
  }
  for (const source of sources.reverse()) {
    await page.click('.return-button');
    await settled(page);
    const after = await readingSnapshot(page, source.sourcePage);
    assert.deepEqual(after.methods, source.snapshot.methods);
    assert.equal(after.expanded, source.snapshot.expanded);
    assert.equal(after.highlight, source.snapshot.highlight);
    assert.equal(after.focus, source.snapshot.focus);
    assert.ok(Math.abs(after.fraction - source.snapshot.fraction) < .005);
    assert.ok(Math.abs(after.panelScroll - source.snapshot.panelScroll) < 2, `Panel scroll ${source.snapshot.panelScroll} → ${after.panelScroll}; source page ${source.sourcePage}; ${JSON.stringify({before:source.snapshot,after})}`);
  }
  console.log('PASS method multi-level return: each source restores its method, explanation, region and focus');
}

// Run on a dedicated test origin with a saved personal supplement named QA title.
export async function checkTitleDraft(page) {
  await jumpToFilePage(page, 13);
  await page.click('[aria-label="我的补充：QA title"]');
  await page.click('.personal-actions button:first-child');
  await page.fill('.personal-title input', 'Changed title');
  const before = await page.evaluate(() => {
    window.draftConfirm = window.confirm;
    window.draftPrompts = 0;
    window.confirm = () => { window.draftPrompts++; return false; };
    return !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  });
  try {
    assert.equal(before, true, 'Title-only edits must protect refresh and closing the tab');
    await page.click('.editor-actions button:nth-child(2)');
    assert.deepEqual(await page.evaluate(() => ({
      title: document.querySelector('.personal-title input')?.value,
      prompts: window.draftPrompts,
    })), { title: 'Changed title', prompts: 1 }, 'Cancel must offer to keep a title-only draft');
  } finally {
    await page.evaluate(() => { window.confirm = window.draftConfirm; delete window.draftConfirm; delete window.draftPrompts; });
  }
  await page.fill('.personal-title input', 'QA title');
  await page.click('.editor-actions button:nth-child(2)');
  console.log('PASS title-only draft: beforeunload and canceled discard retain the title');
}

export async function checkDraftDuringNavigation(page) {
  await openNote(page, 'ch1-measurement-exercise');
  await page.evaluate(() => {
    window.draftDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () { return new Promise((resolve) => { window.draftRelease = resolve; }); };
  });
  try {
    await page.click('#related-ch1-measurement-exercise-ch1-deviation');
    await page.waitForSelector('.reading-message[role="status"]');
    await page.focus('.personal-note .cm-content');
    await page.keyboard.insertText('Navigation draft');
    const before = await page.evaluate(() => ({
      draft: document.querySelector('.cm-content').textContent,
      title: document.querySelector('#supplement-title').textContent,
      highlight: document.querySelector('.location-highlight')?.id,
    }));
    await page.evaluate(() => window.draftRelease());
    await settled(page);
    assert.deepEqual(await page.evaluate(() => ({
      draft: document.querySelector('.cm-content').textContent,
      title: document.querySelector('#supplement-title').textContent,
      highlight: document.querySelector('.location-highlight')?.id,
    })), before, 'Late navigation must not unload a newly edited draft');
    assert.ok(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')));
  } finally {
    await page.evaluate(() => { HTMLImageElement.prototype.decode = window.draftDecode; delete window.draftDecode; delete window.draftRelease; });
  }
  await page.press('.personal-note .cm-content', 'ControlOrMeta+z');
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  console.log('PASS edit during image loading: navigation cancels; late result leaves the new draft intact');
}

export async function checkReaderJourney(page) {
  const id = 'ch1-measurement-exercise';
  const readingKey = `textbook-reading-v1:${positioning.documentSha256}`;
  if (!await page.evaluate(() => !!document.querySelector('#page-input'))) await page.click('.page-index');
  await page.selectOption('select[aria-label="跳页方式"]', 'printed');
  await page.fill('#page-input', '6');
  await page.press('#page-input', 'Enter');
  await page.waitForFunction(() => document.querySelector('.page-index span')?.textContent === '文件页序 13/202' && !document.querySelector('.reading-message'));
  await clickNoteMarker(page, id);
  assert.equal(await page.evaluate((id) => document.getElementById(`method-${id}`).getAttribute('aria-expanded'), id), 'false');
  await page.press(`#method-${id}`, 'Space');
  const related = `#related-${id}-ch1-deviation`;
  await page.focus(related);
  const before = await readingSnapshot(page, 13);
  await page.click(related);
  await settled(page);
  await page.waitForSelector('#location-ch1-deviation');
  await page.click('.return-button');
  await settled(page);
  const returned = await readingSnapshot(page, 13);
  assert.deepEqual(returned.methods, before.methods);
  assert.equal(returned.title, before.title);
  assert.equal(returned.expanded, before.expanded);
  assert.equal(returned.focus, related.slice(1));
  assert.equal(returned.highlight, before.highlight);
  assert.ok(Math.abs(returned.fraction - before.fraction) < .005);
  assert.ok(Math.abs(returned.panelScroll - before.panelScroll) < 2);
  await page.waitForFunction(({ key, fraction }) => {
    const record = JSON.parse(localStorage.getItem(key));
    return record?.page === 13 && Math.abs(record.fraction - fraction) < .005;
  }, { key: readingKey, fraction: returned.fraction });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), readingKey);
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.page-index'));
  const refreshed = await readingSnapshot(page, 13);
  assert.ok(Math.abs(refreshed.fraction - saved.fraction) < .005);
  assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel, .return-button, .location-highlight')), false);
  await clickNoteMarker(page, id);
  assert.equal(await page.evaluate((id) => document.getElementById(`method-${id}`).getAttribute('aria-expanded'), id), 'false');
  console.log('PASS full journey: printed 6 → file 13 → explanation → keyboard method → related → return → refresh/resume');
  return { before, returned, saved, refreshed };
}

// Both Pages must have loaded the same personal-content revision on a dedicated origin.
export async function checkStalePersonalWrite(page, stalePage) {
  await openNote(page, 'ch1-measurement-exercise');
  await page.focus('.personal-note .cm-content');
  await page.keyboard.insertText('Saved in A');
  await page.click('.personal-note button[type="submit"]');
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('textbook-personal-v1:'));
    return localStorage.getItem(key);
  });
  assert.ok(saved.includes('Saved in A'));
  await openNote(stalePage, 'ch1-number-line-review');
  await stalePage.focus('.personal-note .cm-content');
  await stalePage.keyboard.insertText('Draft in B');
  await stalePage.click('.personal-note button[type="submit"]');
  await stalePage.waitForSelector('.personal-note [role="alert"]');
  assert.deepEqual(await stalePage.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('textbook-personal-v1:'));
    return {
      stored: localStorage.getItem(key),
      draft: document.querySelector('.personal-note .cm-content').textContent,
      dirty: document.querySelector('.personal-note .markdown-editor').dataset.dirty,
      conflict: document.querySelector('.personal-note [role="alert"]').textContent.includes('另一标签页更改'),
    };
  }), { stored: saved, draft: 'Draft in B', dirty: 'true', conflict: true });
  await stalePage.press('.personal-note .cm-content', 'ControlOrMeta+z');
  console.log('PASS stale tab: new saved note is preserved; conflicting save retains its draft and explains recovery');
}
