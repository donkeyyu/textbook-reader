// Reach the retained library through the real personal editor. The empty
// region draft is cancelled without saving or creating a personal node.
export async function openPersonalLibrary(page) {
  if (await page.evaluate(() => !!document.querySelector('.personal-library')?.getClientRects().length)) return;
  const hasBack = await page.evaluate(() => {
    const back = document.querySelector('.personal-panel-back');
    return !!back?.getClientRects().length && !back.closest('[hidden],[inert]');
  });
  if (hasBack) await page.click('.personal-panel-back');
  else {
    await page.click('#add-personal-supplement');
    await page.waitForSelector('.region-selector', { state: 'visible' });
    await page.press('.region-selector', 'Enter');
    await page.click('.markdown-editor button:text-is("取消")');
  }
  await page.waitForSelector('.personal-library', { state: 'visible' });
}
