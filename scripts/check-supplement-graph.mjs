import assert from 'node:assert/strict';
import { jumpToFilePage } from './check-related-return.mjs';

export async function graphState(page) {
  return page.evaluate(() => {
    const graph = document.querySelector('.supplement-graph:not([hidden])');
    const canvas = graph?.querySelector('canvas');
    const bounds = canvas?.getBoundingClientRect();
    return { visible: !!graph, nodes: Number(graph?.getAttribute('data-node-count')),
      edges: Number(graph?.getAttribute('data-edge-count')), title: document.getElementById('supplement-title')?.textContent,
      paperScroll: document.querySelector('.paper-scroller')?.scrollTop,
      methods: [...document.querySelectorAll('.method-toggle')].map((item) => item.getAttribute('aria-expanded')),
      zoom: graph?.querySelector('output')?.textContent,
      canvas: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null };
  });
}

export async function searchGraph(page, query, key, { keyboard = false } = {}) {
  await page.fill('.graph-search input', query);
  await page.waitForFunction((key) => [...document.querySelectorAll('#graph-search-results button')]
    .some((button) => button.getAttribute('data-node-key') === key), key);
  const matches = await page.evaluate(() => [...document.querySelectorAll('#graph-search-results button')]
    .map((button) => ({ key: button.getAttribute('data-node-key'), text: button.textContent })));
  const index = matches.findIndex((item) => item.key === key);
  if (keyboard) {
    await page.press('.graph-search input', 'ArrowDown');
    for (let step = 0; step < index; step++) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  } else await page.click(`#graph-search-results button >> nth=${index}`);
  await page.waitForFunction(() => !document.querySelector('#graph-search-results'));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.supplement-graph:not([hidden]) canvas');
    return canvas && Math.abs(canvas.width / devicePixelRatio - canvas.getBoundingClientRect().width) < 1.5;
  });
  await page.waitForFunction(() => document.activeElement?.id === 'supplement-title');
  return matches;
}

export async function checkGraphSelection(page, query, key, options) {
  const before = await graphState(page);
  const matches = await searchGraph(page, query, key, options);
  const after = await graphState(page);
  assert.equal(after.visible, true);
  assert.equal(after.paperScroll, before.paperScroll, 'Selecting a node must not scroll the textbook');
  assert.ok(after.methods.every((value) => value === 'false'), 'Methods start closed on a new graph selection');
  assert.equal(after.nodes, before.nodes);
  return { before, after, matches };
}

// Call after selecting the target. The real pointer, screenshots and surrounding
// nodes show following, edge updates and settling; coordinates are not fixtures.
export async function captureGraphDrag(page, directory, label, { focus = true } = {}) {
  if (focus) await page.click('.graph-zoom button:text-is("当前节点")');
  const { canvas } = await graphState(page);
  assert.ok(canvas?.width > 0);
  const paths = ['before', 'during', 'released', 'settled'].map((phase) => `${directory}/${label}-${phase}.png`);
  await page.screenshot({ path: paths[0], raw: true });
  // A still-cooling node can move after centering. The optional browser-only
  // Pixi probe gives its current screen point, including at low zoom.
  const nodePoint = await page.evaluate(() => {
    const world = window.qa03GraphProbe?.app?.stage.children[0];
    const dot = world?.children[1].children.find((dot) => dot.alpha === 1 && Math.abs(world.x + dot.x * world.scale.x - window.qa03GraphProbe.app.screen.width / 2) < 2 && Math.abs(world.y + dot.y * world.scale.y - window.qa03GraphProbe.app.screen.height / 2) < 2);
    const rect = document.querySelector('.graph-viewport canvas').getBoundingClientRect();
    return dot ? { x: rect.x + world.x + dot.x * world.scale.x, y: rect.y + world.y + dot.y * world.scale.y } : null;
  });
  const start = nodePoint ?? { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  const end = { x: start.x + Math.min(90, canvas.width / 5), y: start.y + 65 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12, label: '拖动当前补充节点' });
  await page.screenshot({ path: paths[1], raw: true });
  await page.mouse.up();
  await page.screenshot({ path: paths[2], raw: true });
  const settling = await page.evaluate(() => new Promise((resolve) => {
    const start = performance.now();
    let frames = 0, done = false;
    const finish = (deadline) => {
      if (done) return;
      done = true; clearTimeout(timer); resolve({ frames, deadline, elapsedMs: performance.now() - start });
    };
    const timer = setTimeout(() => finish(true), 5000);
    const frame = () => { if (!done && ++frames < 140) requestAnimationFrame(frame); else finish(false); };
    requestAnimationFrame(frame);
  }));
  await page.screenshot({ path: paths[3], raw: true });
  return { start, end, paths, settling, state: await graphState(page) };
}

// Browser-only probes use the loaded Pixi API. Nothing is exposed by the app.
export async function startGraphProbe(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  await page.evaluate(async () => {
    if (window.qa03GraphProbe) throw new Error('Graph probe already installed');
    const url = performance.getEntriesByType('resource').map((item) => item.name).find((url) => url.includes('/pixi__js.js'));
    const { Application } = await import(url);
    const original = Application.prototype.render;
    window.qa03GraphProbe = { Application, original, hidden: 0, visible: 0, app: null };
    Application.prototype.render = function (...args) {
      const probe = window.qa03GraphProbe;
      probe.app = this;
      if (document.getElementById('supplement-graph').hidden) probe.hidden++;
      else probe.visible++;
      return original.apply(this, args);
    };
  });
  await page.click('.graph-zoom button:text-is("当前节点")');
  await page.waitForFunction(() => !!window.qa03GraphProbe?.app);
}

export async function graphEmphasis(page, selectedKey) {
  return page.evaluate(async (selectedKey) => {
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { contentNodes } = await import('/src/textbook/content.ts');
    const { supabase } = await import('/src/reader/supabase.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const { projectGraph } = await import('/src/reader/graph/project-graph.ts');
    const session = (await supabase.auth.getSession()).data.session;
    const personal = session ? (await readPersonal(session.user.id)).data : { supplements: [], notes: {} };
    const nodes = contentNodes(await readPublishedContent(), personal);
    const world = window.qa03GraphProbe.app.stage.children[0];
    const dots = world.children[1].children, labels = world.children[2].children;
    if (dots.length !== nodes.length) throw new Error('Wait for the current node snapshot before inspecting the canvas');
    const direct = new Set([selectedKey]);
    const edges = projectGraph(nodes).edges;
    for (const edge of edges) {
      if (edge.source === selectedKey) direct.add(edge.target);
      if (edge.target === selectedKey) direct.add(edge.source);
    }
    const matches = new Set([...document.querySelectorAll('#graph-search-results button')].map((item) => item.dataset.nodeKey));
    let clear = 0, dim = 0, wrong = 0, visibleLabels = 0, searchLabels = 0;
    let unrelated = null, selected = null;
    const canvas = document.querySelector('.graph-viewport canvas').getBoundingClientRect();
    nodes.forEach((node, index) => {
      const dot = dots[index], label = labels[index];
      const emphasized = !selectedKey || direct.has(node.key) || matches.has(node.key);
      if (emphasized) { clear++; if (dot.alpha !== 1 || label.alpha !== 1) wrong++; }
      else { dim++; if (!(dot.alpha > 0 && dot.alpha < 1 && label.alpha > 0 && label.alpha < 1)) wrong++; }
      if (label.visible) visibleLabels++;
      if (matches.has(node.key) && label.visible) searchLabels++;
      const point = { x: canvas.x + world.x + dot.x * world.scale.x, y: canvas.y + world.y + dot.y * world.scale.y };
      if (node.key === selectedKey) selected = { visible: label.visible, text: label.text, point };
      if (!emphasized && node.source === 'default' && !unrelated && point.x > canvas.x + 120 && point.x < canvas.right - 120 && point.y > canvas.y + 100 && point.y < canvas.bottom - 100) {
        unrelated = { key: node.key, title: node.title, point };
      }
    });
    return { nodes: nodes.length, direct: selectedKey ? direct.size : 0, clear, dim, wrong, visibleLabels,
      search: { matched: matches.size, visibleLabels: searchLabels }, selected, unrelated,
      world: { x: world.x, y: world.y, scale: world.scale.x } };
  }, selectedKey);
}

export async function stopGraphProbe(page) {
  await page.evaluate(() => {
    const probe = window.qa03GraphProbe;
    if (!probe) return;
    probe.Application.prototype.render = probe.original;
    delete window.qa03GraphProbe;
  });
}

export async function checkRepeatedGraphOriginal(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  const chain = await page.evaluate(async () => {
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { getLocation } = await import('/src/textbook/supplements.ts');
    const content = await readPublishedContent();
    const at = new Map(content.supplements.map((node) => [node.locationId, node]));
    const incoming = new Map();
    for (const source of content.supplements) for (const related of source.related) {
      const target = at.get(related.locationId);
      if (target && target.id !== source.id) incoming.set(target.id, source);
    }
    const middle = content.supplements.find((node) => incoming.has(node.id) && node.related.some((related) => !at.has(related.locationId)));
    if (!middle) throw new Error('No current two-level return fixture');
    const source = incoming.get(middle.id);
    const original = middle.related.find((related) => !at.has(related.locationId));
    return { source: { id: source.id, title: source.title, page: getLocation(source.locationId).page },
      middle: { id: middle.id, title: middle.title, locationId: middle.locationId },
      original: { id: original.locationId, page: getLocation(original.locationId).page } };
  });
  if (await page.evaluate(() => !document.getElementById('supplement-graph').hidden)) await page.click('.graph-toolbar > button');
  await jumpToFilePage(page, chain.source.page);
  await page.click(`[data-supplement-ids~="${chain.source.id}"]`);
  if (await page.evaluate((id) => !!document.getElementById(`choice-${id}`), chain.source.id)) await page.click(`#choice-${chain.source.id}`);
  await page.click(`#related-${chain.source.id}-${chain.middle.locationId}`);
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, chain.middle.title);
  await page.click('#open-supplement-graph');
  const relation = `#related-${chain.middle.id}-${chain.original.id}`;
  await page.click(relation);
  await page.waitForFunction(() => document.getElementById('supplement-graph').hidden);
  const first = await page.evaluate(() => document.querySelector('.paper-scroller').scrollTop);
  const paper = await page.evaluate(() => { const r = document.querySelector('.paper-scroller').getBoundingClientRect(); return { x: r.x + 100, y: r.y + 100 }; });
  await page.mouse.move(paper.x, paper.y);
  await page.mouse.wheel(0, 500, { label: '离开原文位置后再定位' });
  await page.waitForFunction((first) => Math.abs(document.querySelector('.paper-scroller').scrollTop - first) > 10, first);
  await page.click('#open-supplement-graph');
  await page.evaluate((pageNumber) => {
    window.qa03Decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      return this.src.includes(`/page-${pageNumber}.webp`) ? Promise.reject(new Error('QA03 repeat locate failure')) : window.qa03Decode.call(this);
    };
  }, chain.original.page);
  try {
    await page.click(relation);
    await page.waitForSelector('.reading-message[role="alert"]');
    assert.equal((await graphState(page)).visible, true);
  } finally {
    await page.evaluate(() => { HTMLImageElement.prototype.decode = window.qa03Decode; delete window.qa03Decode; });
  }
  await page.click('.reading-message button');
  await page.waitForFunction(() => document.getElementById('supplement-graph').hidden && !document.querySelector('.reading-message'));
  const retry = await page.evaluate(() => document.querySelector('.paper-scroller').scrollTop);
  assert.ok(Math.abs(first - retry) < 1, 'Repeat locate must reposition the original');
  await page.click('#open-supplement-graph'); await page.click(relation);
  await page.waitForFunction(() => document.getElementById('supplement-graph').hidden && !document.querySelector('.reading-message'));
  await page.click('.return-button');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title && !!document.querySelector('.return-button'), chain.middle.title);
  const firstFocus = await page.evaluate(() => document.activeElement.id);
  assert.equal(firstFocus, `related-${chain.middle.id}-${chain.original.id}`);
  await page.click('.return-button');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title && !document.querySelector('.return-button'), chain.source.title);
  return { chain, repeatRevealsOriginal: true, repositionsAfterScroll: true, failureRetry: true,
    preservesTwoReturnLevels: true, noDuplicateReturnLayer: true, validReturnFocus: true };
}
