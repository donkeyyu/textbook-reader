import assert from 'node:assert/strict';

export async function chooseDirectoryType(page, value) {
  if (await page.evaluate(() => document.getElementById('graph-directory-type-toggle').getAttribute('aria-expanded') !== 'true')) {
    await page.click('#graph-directory-type-toggle');
  }
  await page.click(`#graph-directory-type-menu [data-directory-type="${value}"]`);
  await page.waitForFunction(() => document.getElementById('graph-directory-type-toggle').getAttribute('aria-expanded') === 'false');
}


// Start with graph visible, book hidden, and directories collapsed.
export async function checkNavigationDirectories(page) {
  await page.click('#graph-directory-toggle');
  const all = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.graph-directory-tree button[data-node-key]')];
    return { count: buttons.length, unique: new Set(buttons.map((b) => b.dataset.nodeKey)).size,
      expected: Number(document.getElementById('supplement-graph').dataset.nodeCount) };
  });
  assert.equal(all.count, all.expected); assert.equal(all.unique, all.count);
  await chooseDirectoryType(page, 'concept');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.graph-directory-tree button')]
    .every((b) => b.dataset.supplementType === 'concept')), true);
  await page.click('.graph-directory-chapter > summary >> nth=0');
  await page.click('.graph-directory-section > summary >> nth=0');
  const title = await page.evaluate(() => document.querySelector('.graph-directory-tree button > .graph-directory-node-title').childNodes[0].textContent);
  await page.click('.graph-directory-tree button >> nth=0');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, title);
  assert.equal(await page.evaluate(() => document.getElementById('graph-directory-toggle').getAttribute('aria-expanded')), 'true');
  await page.press('#graph-directory-type-toggle', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'graph-directory-toggle');
  await page.click('#graph-book-toggle');
  await page.waitForFunction(() => document.querySelector('.location-highlight'));
  const before = await page.evaluate(() => document.getElementById('supplement-graph').getBoundingClientRect().toJSON());
  await page.click('#book-navigation-toggle');
  const bounds = await page.evaluate(() => {
    const book = document.getElementById('textbook-view').getBoundingClientRect();
    const nav = document.getElementById('page-sidebar').getBoundingClientRect();
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    return { book: book.toJSON(), nav: nav.toJSON(), graph: graph.toJSON(), panel: document.getElementById("supplement-panel").getBoundingClientRect().toJSON(), layout: document.querySelector(".reading-layout").getBoundingClientRect().toJSON(),
      globalToggle: !!document.querySelector('.toolbar .navigation-toggle') };
  });
  assert.equal(bounds.globalToggle, false);
  assert.ok(bounds.nav.right <= bounds.book.left + 1);
  assert.ok(bounds.nav.width <= 181);
  assert.ok(bounds.panel.left >= bounds.nav.right - 1);
  assert.ok(Math.abs(bounds.nav.bottom - bounds.layout.bottom) <= 1);
  assert.equal(bounds.graph.width, before.width);
  await page.click('.book-navigation-modes button >> nth=0');
  if (!await page.evaluate(() => document.querySelector('.book-contents details').open)) await page.click('.book-contents summary >> nth=0');
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.click('.book-contents details button >> nth=1');
  await page.waitForFunction(() => document.activeElement?.id.startsWith('page-'));
  assert.equal(await page.evaluate(() => document.getElementById('page-sidebar').hidden), false);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await page.click('.book-navigation-modes button >> nth=1');
  assert.equal(await page.evaluate(() => document.querySelector('.page-thumbnails').hidden), false);
  await page.click('#thumbnail-12');
  await page.waitForFunction(() => document.getElementById('thumbnail-12').getAttribute('aria-current') === 'page');
  assert.equal(await page.evaluate(() => document.getElementById('page-sidebar').hidden), false);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await page.press('.book-navigation-modes button >> nth=1', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'book-navigation-toggle');
  return { all, bounds, filterAndChoose: true, keyboardClose: true, bookContentsAndPages: true };
}

// Owned reader Page: graph open, book hidden, directory closed, no explanation.
// Ends with the directory open and its current node focused. No account writes.
// An existing qaStartup probe also checks that directory reveal leaves the camera alone.
export async function checkGraphDirectoryUsability(page) {
  const filter = '#graph-directory-type-toggle';
  const reveal = '#graph-directory button[aria-label*="在目录中显示当前节点"]';
  const collapseAll = async () => {
    if (await page.evaluate(() => document.querySelectorAll('.graph-directory-tree details[open]').length > 0)) {
      await page.click('#graph-directory button[aria-label="收起全部章节"]');
    }
  };
  const snapshot = () => page.evaluate(() => {
    const tree = document.querySelector('.graph-directory-tree');
    return {
      sameTree: tree === window.qaDirectoryTree,
      type: document.querySelector('#graph-directory-type-toggle').dataset.value,
      open: [...tree.querySelectorAll('details[open]')].map((item) =>
        item.querySelector(':scope > summary .graph-directory-label').textContent),
      scroll: tree.scrollTop,
    };
  });
  const camera = () => page.evaluate(() => {
    const world = window.qaStartup?.app?.stage.children[0];
    return world ? { x: world.x, y: world.y, zoom: world.scale.x } : null;
  });
  const waitLayout = () => page.waitForFunction(() =>
    document.querySelector('.reading-layout').getAnimations({ subtree: true })
      .every((animation) => animation.playState !== 'running'));
  const assertRevealed = async (key) => {
    await page.waitForFunction((key) => {
      const tree = document.querySelector('.graph-directory-tree');
      const button = tree.querySelector('button[aria-current="true"]');
      if (!button || button.dataset.nodeKey !== key || document.activeElement !== button) return false;
      const item = button.getBoundingClientRect(), bounds = tree.getBoundingClientRect();
      return item.height > 0 && item.top >= bounds.top - 1 && item.bottom <= bounds.bottom + 1;
    }, key);
    assert.deepEqual(await page.evaluate(() => {
      const tree = document.querySelector('.graph-directory-tree');
      return { open: tree.querySelectorAll('details[open]').length,
        current: tree.querySelectorAll('details[open][data-current="true"]').length };
    }), { open: 2, current: 2 }, 'Reveal opens only the selected chapter and section');
  };

  assert.equal(await page.evaluate(() => document.getElementById('graph-directory-toggle').getAttribute('aria-expanded')), 'false');
  await page.click('#graph-directory-toggle');
  await page.evaluate(() => {
    if ('qaDirectoryTree' in window) throw new Error('Directory probe already installed');
    window.qaDirectoryTree = document.querySelector('.graph-directory-tree');
  });
  try {
    await chooseDirectoryType(page, 'concept');
    await collapseAll();
    await page.click('.graph-directory-chapter > summary >> nth=0');
    await page.click('.graph-directory-section > summary >> nth=0');
    await page.evaluate(() => { document.querySelector('.graph-directory-tree').scrollTop = 120; });
    const saved = await snapshot();
    assert.ok(saved.scroll > 0, 'Exercise a genuinely scrolled directory');
    await page.click('#graph-directory-toggle');
    assert.equal(await page.evaluate(() => document.getElementById('graph-directory').hidden), true);
    await page.click('#graph-directory-toggle');
    assert.deepEqual(await snapshot(), saved, 'Close/reopen retains type, expansion, scroll and tree identity');

    await page.click('.graph-settings > summary');
    await page.waitForFunction(() => document.getElementById('graph-directory').hidden);
    await page.click('#graph-directory-toggle');
    assert.equal(await page.evaluate(() => document.querySelector('.graph-settings').open), false);
    assert.deepEqual(await snapshot(), saved, 'Settings/directory switching retains the browsing state');
    const sectionKey = await page.evaluate(() => document.querySelector('.graph-directory-section button').dataset.nodeKey);
    await chooseDirectoryType(page, 'all');
    await page.click(filter);
    const absent = await page.evaluate((key) => {
      const section = [...document.querySelectorAll('.graph-directory-tree button')]
        .find((button) => button.dataset.nodeKey === key).closest('.graph-directory-section');
      const types = new Set([...section.querySelectorAll('button')].map((button) => button.dataset.supplementType));
      return { type: [...document.querySelectorAll('#graph-directory-type-menu [data-directory-type]')]
        .map((option) => option.dataset.directoryType).find((type) => type !== 'all' && !types.has(type)),
        section: section.querySelector(':scope > summary .graph-directory-label').textContent,
        chapter: section.closest('.graph-directory-chapter').querySelector(':scope > summary .graph-directory-label').textContent };
    }, sectionKey);
    await page.keyboard.press('Escape');
    await chooseDirectoryType(page, absent.type ?? 'method');
    if (absent.type) assert.equal(await page.evaluate(({ chapter, section }) =>
      [...document.querySelectorAll('.graph-directory-chapter')].some((item) =>
        item.querySelector(':scope > summary .graph-directory-label').textContent === chapter &&
        [...item.querySelectorAll('.graph-directory-section > summary .graph-directory-label')]
          .some((label) => label.textContent === section)), absent), false, 'The chosen filter must actually unmount the expanded section');
    await chooseDirectoryType(page, 'concept');
    const restored = await snapshot();
    assert.equal(restored.sameTree, true);
    assert.deepEqual(restored.open, saved.open, 'Filtering away and back retains expanded paths');

    const chosen = await page.evaluate(() => {
      const button = document.querySelector('.graph-directory-tree button');
      return { key: button.dataset.nodeKey,
        title: button.querySelector('.graph-directory-node-title').childNodes[0].textContent };
    });
    await page.click('.graph-directory-tree button >> nth=0');
    await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, chosen.title);
    await waitLayout();
    if (await camera()) await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const settled = () => { if (++frames < 4) requestAnimationFrame(settled); else resolve(); };
      requestAnimationFrame(settled);
    }));
    await collapseAll();
    assert.equal(await page.evaluate(() => document.querySelectorAll('.graph-directory-tree details[open]').length), 0);
    const beforeReveal = await camera();
    await page.click(reveal);
    await assertRevealed(chosen.key);
    assert.deepEqual(await camera(), beforeReveal, 'Explicit directory reveal must not pan or zoom the graph');
    const revealedScroll = (await snapshot()).scroll;
    await page.click(reveal);
    await assertRevealed(chosen.key);
    assert.equal((await snapshot()).scroll, revealedScroll, 'An already visible current item does not scroll again');

    await chooseDirectoryType(page, 'method');
    assert.equal(await page.evaluate(() => document.querySelector('#graph-directory-type-toggle').dataset.value), 'method');
    await page.waitForSelector('.graph-directory-filter-notice');
    assert.match(await page.evaluate(() => document.querySelector('#graph-directory button[aria-label*="在目录中显示当前节点"]').getAttribute('aria-label')), /切回全部类型/);
    assert.equal(await page.evaluate(() => !!document.querySelector('.graph-directory-tree button[aria-current="true"]')), false);
    await collapseAll();
    const beforeRestore = await camera();
    await page.click(reveal);
    assert.equal(await page.evaluate(() => document.querySelector('#graph-directory-type-toggle').dataset.value), 'all');
    await assertRevealed(chosen.key);
    assert.deepEqual(await camera(), beforeRestore, 'Restoring the current item clears the filter without moving the graph');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-directory-toggle');
    assert.equal(await page.evaluate(() => document.getElementById('graph-directory').hidden), true);
    await page.click('#graph-directory-toggle');
    await page.click(reveal);
    await assertRevealed(chosen.key);
    return { retainedState: true, retainedTree: true, filterExpansion: true,
      unmountedSectionRecovery: !!absent.type,
      explicitReveal: true, hiddenSelectionRecovery: true, escape: true,
      cameraChecked: beforeReveal !== null };
  } finally {
    await page.evaluate(() => { delete window.qaDirectoryTree; });
  }
}

// Directory already open, menu closed; run again with a short graph pane.
// Restores the initial type and leaves the directory open with the menu closed.
export async function checkDirectoryTypeMenu(page) {
  const trigger = '#graph-directory-type-toggle';
  const value = () => page.evaluate(() => document.getElementById('graph-directory-type-toggle').dataset.value);
  const expanded = () => page.evaluate(() => document.getElementById('graph-directory-type-toggle').getAttribute('aria-expanded'));
  const focusedType = () => page.evaluate(() => document.activeElement?.dataset.directoryType);
  const original = await value();
  assert.equal(await expanded(), 'false');
  await page.click(trigger);
  const options = await page.evaluate(() => [...document.querySelectorAll('#graph-directory-type-menu [role="menuitemradio"]')]
    .map((item) => item.dataset.directoryType));
  assert.ok(options.length > 1);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#graph-directory-type-menu [aria-checked="true"]')]
    .map((item) => item.dataset.directoryType)), [original]);
  const bounds = await page.evaluate(() => {
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    const menu = document.getElementById('graph-directory-type-menu');
    const rect = menu.getBoundingClientRect();
    return { contained: rect.width > 0 && rect.height > 0 && rect.left >= graph.left - 1 &&
      rect.right <= graph.right + 1 && rect.top >= graph.top - 1 && rect.bottom <= graph.bottom + 1,
      touchTargets: [...document.querySelectorAll('.graph-directory-actions > button')].every((button) => {
        const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
      }), scrollable: menu.scrollHeight > menu.clientHeight,
      scrollOverflow: getComputedStyle(menu).overflowY };
  });
  assert.equal(bounds.contained, true, 'Type menu stays within its graph pane');
  assert.equal(bounds.touchTargets, true, 'Directory actions retain 44px touch targets');
  if (bounds.scrollable) assert.ok(['auto', 'scroll'].includes(bounds.scrollOverflow), 'Short panes allow menu scrolling');
  await page.keyboard.press('Escape');
  assert.equal(await expanded(), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-directory-type-toggle');
  assert.equal(await page.evaluate(() => document.getElementById('graph-directory').hidden), false, 'Menu Escape must leave the directory open');

  await page.click(trigger);
  await page.click(trigger);
  assert.equal(await expanded(), 'false', 'Clicking the same trigger closes its open menu');
  assert.equal(await page.evaluate(() => document.getElementById('graph-directory').hidden), false);
  await page.click(trigger);
  await page.keyboard.press('End');
  assert.equal(await focusedType(), options.at(-1));
  await page.keyboard.press('Home');
  assert.equal(await focusedType(), options[0]);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedType(), options[1]);
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedType(), options[0]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await value(), options[1]);
  assert.equal(await expanded(), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-directory-type-toggle');
  assert.equal(await page.evaluate((type) => [...document.querySelectorAll('.graph-directory-tree button[data-node-key]')]
    .every((button) => type === 'all' || button.dataset.supplementType === type), options[1]), true);
  await page.click(trigger);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#graph-directory-type-menu [aria-checked="true"]')]
    .map((item) => item.dataset.directoryType)), [options[1]]);
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  assert.equal(await value(), options[0]);
  assert.equal(await expanded(), 'false');
  await page.click(trigger);
  await page.keyboard.press('Tab');
  assert.equal(await expanded(), 'false');
  await page.click(trigger);
  await page.click('.graph-directory-heading h2');
  await page.waitForFunction(() => document.getElementById('graph-directory-type-toggle').getAttribute('aria-expanded') === 'false');
  assert.equal(await page.evaluate(() => document.getElementById('graph-directory').hidden), false);
  await chooseDirectoryType(page, original);
  return { keyboardSelection: true, layeredEscape: true, lightDismiss: true, tabCloses: true, bounds };
}
