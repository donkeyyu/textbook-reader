import assert from 'node:assert/strict';
import { jumpToFilePage } from './check-related-return.mjs';
import { readCloudPersonal } from './check-content-migration.mjs';

const title = 'QA04 同名补充';
async function library(page) {
  await page.click('#open-personal-library');
  await page.waitForSelector('.personal-search input');
}
async function create(page) {
  await page.click('.personal-library button:text-is("新建补充")');
  await page.waitForSelector('.personal-title input');
}
async function body(page, text) {
  await page.click('.markdown-source .cm-content');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  assert.equal(await page.evaluate(() => document.querySelector('.markdown-source .cm-content').textContent), text);
}
async function save(page) {
  await page.click('.markdown-editor button[type="submit"]');
  await page.waitForSelector('.personal-actions button:text-is("编辑补充")');
}
async function open(page, id) {
  await page.click(`[data-personal-id="${id}"]`);
  await page.waitForSelector('.personal-actions button:text-is("编辑补充")');
}
async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('open-personal-library')?.disabled);
}

// Dedicated marked origin and a NEW synthetic account only. No email is sent.
export async function startPersonalNodesCheck(page, { testOrigin, credentials }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  const marker = await fetch(`${testOrigin}/__personal_nodes_check`);
  assert.equal((await marker.json()).kind, 'reader-personal-nodes-04');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('textbook-personal-v1:'))), false);
  await page.evaluate(() => {
    const original = window.fetch;
    window.qa04Network = { original, mail: 0 };
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/auth/v1/otp') {
        window.qa04Network.mail++;
        return Promise.reject(new Error('QA04 forbids mail'));
      }
      return original.call(this, input, init);
    };
  });
  await page.click('.account-summary');
  await page.click('.account-mode-toggle:text-is("测试账号登录")');
  await page.fill('.account-options input[name="email"]', credentials.email);
  await page.fill('.account-options input[name="password"]', credentials.password);
  await page.click('.account-options button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('open-personal-library')?.disabled);
  const initial = await readCloudPersonal(page);
  assert.equal(initial.userId, credentials.id);
  assert.deepEqual(initial.data, { supplements: [], notes: {} });
  assert.equal(await page.evaluate(() => window.qa04Network.mail), 0);
  return { syntheticAccount: true, isolatedOrigin: true, initialEmpty: true, noMailSent: true };
}

export async function checkPersonalNodeCreation(page) {
  await jumpToFilePage(page, 32);
  await library(page);
  await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), 'chapter-2');
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="节"]').value), '');
  assert.equal(await page.evaluate(() => !!document.getElementById('locate-personal')), false);
  await page.click('.markdown-editor button:text-is("取消")');
  assert.equal((await readCloudPersonal(page)).data.supplements.length, 0);
  await create(page);
  await page.fill('.personal-title input', title);
  await body(page, '第二章的跨段落想法');
  await save(page);
  const first = (await readCloudPersonal(page)).data.supplements[0];
  assert.ok(first.id);
  assert.equal(first.chapterId, 'chapter-2');
  assert.equal(first.sectionId, null);
  assert.equal(first.page, null); assert.equal(first.region, null);
  await library(page);
  await create(page);
  await page.fill('.personal-title input', title);
  await page.selectOption('select[aria-label="章节"]', 'chapter-3');
  await page.selectOption('select[aria-label="节"]', '3.1');
  await body(page, '第三章的跨段落想法');
  await save(page);
  const nodes = (await readCloudPersonal(page)).data.supplements;
  assert.equal(nodes.length, 2); assert.notEqual(nodes[0].id, nodes[1].id);
  await library(page);
  await page.fill('.personal-search input', title);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.personal-list button')].map((button) => button.textContent));
  assert.equal(labels.length, 2);
  assert.ok(labels.some((text) => text.includes('第二章') && text.includes('第二章的跨段落想法')));
  assert.ok(labels.some((text) => text.includes('第三章') && text.includes('3.1') && text.includes('第三章的跨段落想法')));
  await reload(page);
  await library(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.personal-list button').length), 2);
  // Same-title, same-chapter entries also remain distinguishable by summary.
  const second = nodes.find((node) => node.id !== first.id);
  await open(page, second.id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.selectOption('select[aria-label="章节"]', 'chapter-2');
  await save(page);
  await library(page);
  const summaries = await page.evaluate(() => [...document.querySelectorAll('.personal-list-summary')].map((node) => node.textContent));
  assert.equal(new Set(summaries).size, 2);
  return { defaultChapter: true, noGuessedSection: true, cancelLeavesNoNode: true, adjustableChapterAndSection: true,
    sameNameDistinctIdsAndContexts: true, sameChapterSummaryDisambiguation: true, refreshRevisit: true, noFakeLocate: true };
}

export async function checkPersonalNodeMaintenance(page) {
  const first = (await readCloudPersonal(page)).data.supplements[0];
  await open(page, first.id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.fill('.personal-title input', 'QA04 改名补充');
  await page.selectOption('select[aria-label="章节"]', '');
  await body(page, '改名并移到未归属章节');
  await save(page);
  await reload(page);
  const saved = (await readCloudPersonal(page)).data.supplements.find((node) => node.id === first.id);
  assert.equal(saved.title, 'QA04 改名补充'); assert.equal(saved.chapterId, null); assert.equal(saved.sectionId, null);
  assert.equal(saved.markdown, '改名并移到未归属章节');
  await library(page);
  await page.fill('.personal-search input', '未归属章节');
  assert.equal(await page.evaluate((id) => !!document.querySelector(`[data-personal-id="${id}"]`), saved.id), true);
  // Keyboard search, open, return and close use the real controls.
  await page.focus('.personal-search input');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-personal-id')), true);
  const keyboardId = await page.evaluate(() => document.activeElement.dataset.personalId);
  const keyboardTarget = (await readCloudPersonal(page)).data.supplements.find((node) => node.id === keyboardId);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.personal-actions');
  assert.equal(await page.evaluate(() => document.getElementById('supplement-title').textContent), keyboardTarget.title);
  await page.focus('.personal-panel-back'); await page.keyboard.press('Enter');
  await page.waitForSelector('.personal-search input');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.id === 'open-personal-library');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open-personal-library');
  await jumpToFilePage(page, 1);
  await library(page); await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), '');
  await page.click('.markdown-editor button:text-is("取消")');
  return { renameKeepsId: true, editRefresh: true, unassignedSaved: true, coverDefaultsUnassigned: true, keyboardFindOpenReturnClose: true };
}

export async function checkPersonalNodeFailure(page) {
  const first = (await readCloudPersonal(page)).data.supplements[0];
  await open(page, first.id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.fill('.personal-title input', 'QA04 失败后重试');
  await body(page, '网络失败仍保留这份草稿');
  await page.evaluate(() => {
    const original = window.fetch;
    window.qa04Fail = { original, failed: false };
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname.endsWith('/rpc/reader_save_personal') && !window.qa04Fail.failed) {
        window.qa04Fail.failed = true;
        return Promise.resolve(new Response(JSON.stringify({code:'QA04',message:'Synthetic save failure'}), {status:503,headers:{'Content-Type':'application/json'}}));
      }
      return original.call(this, input, init);
    };
  });
  try {
    await page.click('.markdown-editor button[type="submit"]');
    await page.waitForSelector('.editor-save-error [role="alert"]');
    assert.equal(await page.evaluate(() => document.querySelector('.personal-title input').value), 'QA04 失败后重试');
    assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent), '网络失败仍保留这份草稿');
    assert.deepEqual((await readCloudPersonal(page)).data.supplements.find((node) => node.id === first.id), first);
    // Reject leaving the failed draft; it must remain editable.
    const receipt = await page.click('#open-personal-library');
    assert.ok(receipt.dialog); await page.dismissDialog();
    assert.equal(await page.evaluate(() => !!document.querySelector('.personal-title input')), true);
    await save(page);
    assert.equal((await readCloudPersonal(page)).data.supplements.find((node) => node.id === first.id).markdown, '网络失败仍保留这份草稿');
  } finally {
    await page.evaluate(() => { window.fetch = window.qa04Fail.original; delete window.qa04Fail; });
  }
  await reload(page);
  await library(page); await open(page, first.id);
  assert.equal(await page.evaluate(() => document.getElementById('supplement-title').textContent), 'QA04 失败后重试');
  return { failedSaveKeepsTitleAndBody: true, failedSaveKeepsCloudSnapshot: true, navigationDraftGuard: true, retryAndRefresh: true };
}

export async function checkBoxedPersonalNode(page) {
  await jumpToFilePage(page, 32);
  await page.click('.toolbar-actions > button:text-is("添加补充")');
  await page.waitForSelector('.region-selector');
  await page.press('.region-selector', 'ArrowRight');
  await page.press('.region-selector', 'Shift+ArrowDown');
  await page.press('.region-selector', 'Enter');
  await page.fill('.personal-title input', 'QA04 框选补充');
  await body(page, '框选旧路径继续可用'); await save(page);
  const boxed = (await readCloudPersonal(page)).data.supplements.find((node) => node.title === 'QA04 框选补充');
  assert.equal(boxed.page, 32); assert.ok(boxed.region.width > 0); assert.equal(boxed.chapterId, 'chapter-2');
  assert.equal(await page.evaluate(() => !!document.getElementById('locate-personal')), true);
  await reload(page);
  await library(page); await open(page, boxed.id);
  await page.click('#locate-personal');
  await page.waitForFunction(() => !!document.querySelector('#page-32 .location-highlight[data-supplement-type="personal"]'));
  return { keyboardRegionSelection: true, boxedSaveRefreshRevisit: true, realLocate: true };
}

export async function checkPersonalNodeNarrowAndDelete(page, { screenshotPath }) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await library(page);
  await page.fill('.personal-search input', 'QA04');
  const nodes = (await readCloudPersonal(page)).data.supplements;
  await open(page, nodes[0].id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await body(page, '窄屏继续编辑个人补充'); await save(page);
  await library(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await page.evaluate(() => {
    const panel=document.getElementById('supplement-panel').getBoundingClientRect();
    const paper=document.querySelector('.paper-scroller').getBoundingClientRect();
    return {panelTop:panel.top,paperBottom:paper.bottom,panelRight:panel.right,width:innerWidth};
  });
  assert.ok(bounds.panelTop >= bounds.paperBottom - 2); assert.ok(bounds.panelRight <= bounds.width + 1);
  await page.waitForFunction(() => document.getElementById('supplement-panel').getAnimations().every((animation) => animation.playState !== 'running'));
  if (screenshotPath) await page.screenshot({path:screenshotPath});
  // Delete each fixture through the public UI, then check persisted emptiness.
  for (const node of nodes) {
    await open(page, node.id);
    await page.click('.personal-actions button:text-is("删除补充")');
    await page.click('.delete-confirmation button:text-is("保留")');
    assert.ok((await readCloudPersonal(page)).data.supplements.some((item) => item.id === node.id));
    await page.click('.personal-actions button:text-is("删除补充")');
    await page.click('.delete-confirmation button:text-is("确认删除")');
    await page.waitForSelector('.personal-search input');
  }
  await reload(page); await library(page);
  assert.deepEqual((await readCloudPersonal(page)).data, {supplements:[], notes:{}});
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  return { narrow390NoOverflow: true, bottomPanel: true, narrowReadEdit: true, keepDeletion: true, deleteRefresh: true, fixturesRemoved: true };
}

export async function checkSelectedChapterWithoutLocation(page) {
  await jumpToFilePage(page, 32);
  const target = await page.evaluate(async () => {
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { getLocation } = await import('/src/textbook/supplements.ts');
    const content = await readPublishedContent();
    const node = content.supplements.find((item) => getLocation(item.locationId).page === 32);
    const marker = document.querySelector(`[data-supplement-ids~="${node.id}"]`);
    return {id:node.id,title:node.title,grouped:marker.dataset.supplementIds.split(' ').length > 1};
  });
  await page.click(`[data-supplement-ids~="${target.id}"]`);
  if (target.grouped) await page.click(`#choice-${target.id}`);
  await page.press('.paper-scroller', 'Home');
  await page.waitForFunction(() => document.querySelector('.page-index')?.textContent === '1/202');
  assert.ok(await page.evaluate((text) => document.getElementById('supplement-panel').textContent.includes(text), target.title));
  await library(page); await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), 'chapter-2');
  assert.equal(await page.evaluate(() => !!document.getElementById('locate-personal')), false);
  await page.click('.markdown-editor button:text-is("取消")');
  assert.equal((await readCloudPersonal(page)).data.supplements.length, 0);
  return {explicitSelectedNodeChapterWinsOverCover: true, cancelStillEmpty: true};
}

async function scrollWithLibraryOpen(page, number) {
  const delta = await page.evaluate((target) => {
    const scroller = document.querySelector('.paper-scroller');
    const list = document.querySelector('.paper-list');
    const paper = document.getElementById(`page-${target}`);
    const bounds = scroller.getBoundingClientRect();
    return {dy:list.offsetTop + paper.offsetTop - scroller.scrollTop, x:bounds.left + bounds.width / 2, y:bounds.top + 100};
  }, number);
  await page.mouse.move(delta.x, delta.y);
  await page.mouse.wheel(0, delta.dy, {label:'scroll textbook to chapter'});
  await page.waitForFunction((target) => document.querySelector('.page-index')?.textContent === `${target}/202`, number);
  assert.equal(await page.evaluate(() => !!document.querySelector('.personal-library')), true);
}

export async function checkLiveChapterAndFullText(page) {
  await jumpToFilePage(page, 32);
  await library(page);
  await scrollWithLibraryOpen(page, 1);
  await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), '');
  await page.click('.markdown-editor button:text-is("取消")');
  await scrollWithLibraryOpen(page, 76);
  await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), 'chapter-3');
  await page.click('.markdown-editor button:text-is("取消")');
  assert.equal((await readCloudPersonal(page)).data.supplements.length, 0);

  await scrollWithLibraryOpen(page, 32);
  await create(page);
  const marker = 'QA04正文末尾检索词';
  const text = '这是正文前段。'.repeat(40) + marker;
  assert.ok(text.indexOf(marker) > 160);
  await page.fill('.personal-title input', 'QA04 全文检索');
  await body(page, text); await save(page);
  const node = (await readCloudPersonal(page)).data.supplements[0];
  assert.equal(node.chapterId, 'chapter-2');
  await library(page);
  await page.fill('.personal-search input', marker);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.personal-list button').length), 1);
  assert.equal(await page.evaluate(() => document.querySelector('.personal-list button').dataset.personalId), node.id);
  assert.equal(await page.evaluate((word) => document.querySelector('.personal-list-summary').textContent.includes(word), marker), false);
  await open(page, node.id);
  assert.equal(await page.evaluate((word) => document.querySelector('.markdown-content').textContent.includes(word), marker), true);

  await library(page);
  await scrollWithLibraryOpen(page, 1);
  await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), 'chapter-2');
  await page.click('.markdown-editor button:text-is("取消")');
  await open(page, node.id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.selectOption('select[aria-label="章节"]', ''); await save(page);
  await library(page);
  await scrollWithLibraryOpen(page, 32);
  await create(page);
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="章节"]').value), '');
  await page.click('.markdown-editor button:text-is("取消")');
  return {livePageFallbackToCover:true, livePageFallbackToOtherChapter:true, explicitChapterPreserved:true,
    explicitUnassignedPreserved:true, cancelNoEmptyNodes:true, fullBodySearchAfter160:true, displaySummaryStillTruncated:true};
}

async function holdPersonalDelete(page, fail = false) {
  await page.evaluate((shouldFail) => {
    const original = window.fetch;
    window.qa04PendingDelete = {original, entered:false, completed:false, fail:shouldFail};
    window.fetch = function(input, init) {
      const url=typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if(new URL(url,location.href).pathname.endsWith('/rpc/reader_save_personal') && !window.qa04PendingDelete.entered) {
        window.qa04PendingDelete.entered=true;
        return new Promise((resolve,reject) => {
          window.qa04PendingDelete.release=async () => {
            try {
              const response=shouldFail
                ? new Response(JSON.stringify({code:'QA04',message:'Synthetic delayed delete failure'}), {status:503,headers:{'Content-Type':'application/json'}})
                : await original.call(window,input,init);
              window.qa04PendingDelete.completed=true;
              resolve(response);
            } catch(error) {reject(error);}
          };
        });
      }
      return original.call(this,input,init);
    };
  }, fail);
  await page.click('.personal-actions button:text-is("删除补充")');
  await page.click('.delete-confirmation button:text-is("确认删除")');
  await page.waitForFunction(() => window.qa04PendingDelete.entered && !!window.qa04PendingDelete.release);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.personal-actions button')].filter((button) => ['编辑补充','删除补充'].includes(button.textContent)).every((button) => button.disabled)), true);
  assert.equal(await page.evaluate(() => !!document.querySelector('.personal-title input')), false);
}
async function releasePersonalDelete(page) {
  await page.evaluate(() => { void window.qa04PendingDelete.release(); });
  await page.waitForFunction(() => window.qa04PendingDelete.completed);
}
async function restorePersonalDelete(page) {
  await page.evaluate(() => {window.fetch=window.qa04PendingDelete.original; delete window.qa04PendingDelete;});
}
async function cancelPersonalDraft(page) {
  const receipt=await page.click('.markdown-editor button:text-is("取消")');
  if(receipt.dialog) await page.acceptDialog();
  await page.waitForSelector('.personal-search input');
}

export async function checkDelayedPersonalDelete(page, {screenshotPath} = {}) {
  // Seed a second node through the same UI to exercise a different live selection.
  await create(page);
  await page.fill('.personal-title input', 'QA04 其他节点');
  await body(page, '其他节点原有正文'); await save(page);
  await library(page);
  let nodes=(await readCloudPersonal(page)).data.supplements;
  const same=nodes.find((node) => node.title === 'QA04 全文检索');
  const other=nodes.find((node) => node.title === 'QA04 其他节点');

  await open(page,same.id);
  await holdPersonalDelete(page);
  await page.click('.personal-panel-back');
  await open(page,same.id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await page.fill('.personal-title input','QA04 重开后的新草稿');
  await body(page,'同一节点重新打开后输入的草稿');
  await releasePersonalDelete(page);
  await page.waitForFunction(() => document.getElementById('supplement-title')?.textContent === '添加补充');
  assert.equal((await readCloudPersonal(page)).data.supplements.some((node) => node.id === same.id),false);
  assert.equal(await page.evaluate(() => document.querySelector('.personal-title input').value),'QA04 重开后的新草稿');
  assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent),'同一节点重新打开后输入的草稿');
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')),true);
  if(screenshotPath) {
    await page.waitForFunction(() => document.getElementById('supplement-panel').getAnimations().every((animation) => animation.playState !== 'running'));
    await page.screenshot({path:screenshotPath});
  }
  await restorePersonalDelete(page);
  await cancelPersonalDraft(page);

  // Another selected node must also keep its draft while the original delete commits.
  await create(page);
  await page.fill('.personal-title input','QA04 另一待删节点');
  await body(page,'只删除这条记录'); await save(page);
  const removed=(await readCloudPersonal(page)).data.supplements.find((node) => node.title === 'QA04 另一待删节点');
  await holdPersonalDelete(page);
  await page.click('.personal-panel-back');
  await open(page,other.id);
  await page.click('.personal-actions button:text-is("编辑补充")');
  await body(page,'其他节点的新草稿');
  await releasePersonalDelete(page);
  nodes=(await readCloudPersonal(page)).data.supplements;
  assert.equal(nodes.some((node) => node.id === removed.id),false);
  assert.equal(nodes.find((node) => node.id === other.id).markdown,other.markdown);
  assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent),'其他节点的新草稿');
  await restorePersonalDelete(page);
  await page.click('.markdown-editor button:text-is("取消")');
  await page.acceptDialog();
  await page.waitForSelector('.personal-actions');

  // Failure restores the controls and exact saved record; retry then deletes it.
  const before=(await readCloudPersonal(page)).data;
  await holdPersonalDelete(page,true);
  await releasePersonalDelete(page);
  await page.waitForSelector('.delete-confirmation [role="alert"]');
  await page.waitForFunction(() => ![...document.querySelectorAll('.personal-actions button')].find((button) => button.textContent === '编辑补充').disabled);
  assert.deepEqual((await readCloudPersonal(page)).data,before);
  await restorePersonalDelete(page);
  await page.click('.delete-confirmation button:text-is("确认删除")');
  await page.waitForSelector('.personal-search input');
  await reload(page); await library(page);
  assert.deepEqual((await readCloudPersonal(page)).data,{supplements:[],notes:{}});
  return {editDisabledDuringDelete:true, sameIdReopenDraftPreserved:true, originalDeletePersisted:true,
    otherNodeDraftAndSavedBodyPreserved:true, failedDeleteKeepsExactSnapshot:true, failureReenablesEdit:true,
    deleteRetryAndRefresh:true, fixturesRemoved:true};
}
