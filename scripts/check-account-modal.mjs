import assert from 'node:assert/strict';

// UI-only regression: never submit the sign-in form or send email.
export async function checkAccountModal(page) {
  const title = await page.evaluate(() => document.getElementById('supplement-title')?.textContent ?? null);
  const before = await page.evaluate(() => ({scroll:document.getElementById('textbook-view').scrollTop, graph:document.getElementById('open-supplement-graph').getAttribute('aria-expanded')}));
  await page.click('.account-summary');
  await page.waitForSelector('.account-options[open]');
  const state = await page.evaluate(() => {
    const dialog = document.querySelector('.account-options');
    const rect = dialog.getBoundingClientRect();
    return {modal:dialog.matches(':modal'), centerX:rect.x+rect.width/2,centerY:rect.y+rect.height/2,width:innerWidth,height:innerHeight,
      backdrop:getComputedStyle(dialog,'::backdrop').backgroundColor};
  });
  assert.ok(state.modal);
  assert.ok(Math.abs(state.centerX-state.width/2)<1 && Math.abs(state.centerY-state.height/2)<1);
  assert.notEqual(state.backdrop,'rgba(0, 0, 0, 0)');
  await page.mouse.move(40,400); await page.mouse.wheel(0,500);
  const toggle = await page.evaluate(() => {const r=document.getElementById('open-supplement-graph').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(toggle.x,toggle.y);
  assert.deepEqual(await page.evaluate(() => ({scroll:document.getElementById('textbook-view').scrollTop,graph:document.getElementById('open-supplement-graph').getAttribute('aria-expanded')})),before);
  for(let i=0;i<6;i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('.account-options')), true);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.account-options').open);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('account-summary')),true);
  assert.equal(await page.evaluate(() => document.getElementById('supplement-title')?.textContent ?? null), title);
  await page.click('.account-summary');
  await page.click('.account-heading .icon-button');
  await page.waitForFunction(() => !document.querySelector('.account-options').open);
  return {centered:true,backgroundBlocked:true,focusContained:true,escapeRestoresFocus:true};
}
