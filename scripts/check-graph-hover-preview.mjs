import assert from 'node:assert/strict';
import { readCloudPersonal } from './check-content-migration.mjs';
import { installSaveProbe } from './check-stable-note-links.mjs';
import { searchGraph } from './check-supplement-graph.mjs';

// Run on ticket08's owned origin/page only. Probes stay in this test page.
export async function startGraphInteractionCheck(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  await installSaveProbe(page);
  await page.evaluate(async () => {
    if (window.qa08Graph) throw new Error('Graph interaction probe already installed');
    const url = performance.getEntriesByType('resource').map((item) => item.name).find((url) => url.includes('/pixi__js.js'));
    const { Application } = await import(url);
    const original = Application.prototype.render;
    const probe = window.qa08Graph = { Application, original, app: null, pending: false, events: [], canvases: new Set(), renders: 0 };
    Application.prototype.render = function (...args) {
      probe.app = this; probe.canvases.add(this.canvas);
      const result = original.apply(this, args);
      probe.renders++; probe.pending = false;
      return result;
    };
  });
  await page.click('button[aria-label="放大节点图"]');
  await page.waitForFunction(() => !!window.qa08Graph.app);
  await page.evaluate(() => {
    const probe = window.qa08Graph, renderer = probe.app.renderer;
    const resize = renderer.resize;
    probe.resize = resize;
    renderer.resize = function (...args) {
      const result = resize.apply(this, args);
      probe.pending = true;
      const event = { width: args[0], height: args[1], sameTurnDraw: false, pixel: null };
      probe.events.push(event);
      queueMicrotask(() => {
        event.sameTurnDraw = !probe.pending;
        const gl = this.gl, data = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
        event.pixel = [...data];
      });
      return result;
    };
  });
}

export async function graphInteractionCatalog(page) {
  return page.evaluate(async () => {
    const { contentNodes, bookId } = await import('/src/textbook/content.ts');
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const { supabase } = await import('/src/reader/supabase.ts');
    const { projectGraph } = await import('/src/reader/graph/project-graph.ts');
    const { projectReferences } = await import('/src/reader/links/project-references.ts');
    const session = (await supabase.auth.getSession()).data.session;
    const personal = session ? (await readPersonal(session.user.id)).data : { supplements: [], notes: {} };
    const nodes = contentNodes(await readPublishedContent(), personal);
    const { edges } = projectGraph(nodes, projectReferences(bookId, nodes, personal).edges);
    window.qa08Graph.nodes = nodes; window.qa08Graph.edges = edges;
    return { nodes: nodes.length, defaultEdges: edges.filter((edge) => edge.kind === 'default').length,
      personalEdges: edges.filter((edge) => edge.kind === 'personal').length };
  });
}

export async function graphInteractionState(page, focusedKey = null) {
  return page.evaluate((focusedKey) => {
    const p = window.qa08Graph, world = p.app.stage.children[0];
    const canvas = p.app.canvas.getBoundingClientRect(), dots = world.children[1].children, labels = world.children[2].children;
    const direct = new Set([focusedKey]);
    for (const edge of p.edges) {
      if (edge.source === focusedKey) direct.add(edge.target);
      if (edge.target === focusedKey) direct.add(edge.source);
    }
    const matches = new Set([...document.querySelectorAll('#graph-search-results button')].map((item) => item.dataset.nodeKey));
    const nodes = p.nodes.map((node, i) => {
      const dot = dots[i], label = labels[i];
      if (!dot) throw new Error('Refresh the catalog after a saved node change');
      return { key: node.key, title: node.title, source: node.source, alpha: dot.alpha,
        labelAlpha: label.alpha, labelVisible: label.visible, labelAnchor: label.anchor.y,
        labelY: canvas.y + world.y + label.y * world.scale.x, labelHeight: label.height * world.scale.x,
        x: canvas.x + world.x + dot.x * world.scale.x, y: canvas.y + world.y + dot.y * world.scale.x };
    });
    const wrong = nodes.filter((node) => (!focusedKey || direct.has(node.key) || matches.has(node.key))
      ? node.alpha !== 1 || node.labelAlpha !== 1 : node.alpha !== .15 || node.labelAlpha !== .15).length;
    const popup = document.querySelector('.graph-preview'), panel = document.getElementById('supplement-panel');
    return { wrong, direct: direct.size, clear: nodes.filter((node) => node.alpha === 1).length,
      focused: nodes.find((node) => node.key === focusedKey),
      visibleNodes: nodes.filter((n) => n.x > canvas.x + 30 && n.x < canvas.right - 30 && n.y > canvas.y + 50 && n.y < canvas.bottom - 50),
      camera: { x: (p.app.screen.width / 2 - world.x) / world.scale.x,
        y: (p.app.screen.height / 2 - world.y) / world.scale.x, zoom: world.scale.x },
      edges: world.children[0].context.instructions.filter((i) => i.action === 'stroke').map((i) => ({ alpha: i.data.style.alpha, color: i.data.style.color })),
      popup: popup ? { text: popup.textContent, key: popup.dataset.nodeKey, bounds: popup.getBoundingClientRect().toJSON(),
        pointerEvents: getComputedStyle(popup).pointerEvents, unsafe: popup.querySelectorAll('script,img,iframe,a,button').length } : null,
      title: document.getElementById('supplement-title')?.textContent ?? null,
      paperScroll: document.querySelector('.paper-scroller').scrollTop,
      saves: window.qa05Network.saves, canvases: p.canvases.size, renders: p.renders,
      panelAnimation: panel ? getComputedStyle(panel).animationName : null,
      resizeEvents: p.events, dimensions: { width: innerWidth, height: innerHeight } };
  }, focusedKey);
}

export async function checkStationaryControlPreview(page, key) {
  const before = await graphInteractionState(page, key);
  assert.equal(before.wrong, 0);
  assert.ok(before.focused);
  // Ego's high-level keyboard action disturbed canvas hover in this run.
  // CDP keeps the real pointer stationary and sends an explicit Control key.
  await graphControl(page, true);
  await page.waitForSelector('.graph-preview');
  const shown = await graphInteractionState(page, key);
  assert.equal(shown.popup.key, key);
  assert.equal(shown.focused.labelAnchor, 1);
  assert.ok(shown.focused.labelY < shown.focused.y);
  assert.ok(shown.popup.bounds.y > shown.focused.y);
  assert.equal(shown.popup.pointerEvents, 'none');
  assert.equal(shown.popup.unsafe, 0);
  assert.ok(shown.popup.bounds.right <= shown.dimensions.width - 10);
  assert.ok(shown.popup.bounds.bottom <= shown.dimensions.height - 10);
  await graphControl(page, false);
  await page.waitForFunction(() => !document.querySelector('.graph-preview'));
  const hidden = await graphInteractionState(page, key);
  assert.equal(hidden.focused.labelAnchor, 0);
  assert.equal(hidden.title, before.title);
  assert.equal(hidden.paperScroll, before.paperScroll);
  assert.equal(hidden.saves, before.saves);
  assert.deepEqual(hidden.camera, before.camera);
  return { key, preview: shown.popup, stationaryDownUp: true, labelAboveThenRestored: true, noSelectionScrollCameraOrSave: true };
}

export async function graphControl(page, down) {
  await page.cdp('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp',
    key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: down ? 2 : 0 });
}

export async function hoverGraphNode(page, key, modifiers = 0) {
  const point = await page.evaluate((key) => {
    const p = window.qa08Graph, world = p.app.stage.children[0];
    const dot = world.children[1].children[p.nodes.findIndex((node) => node.key === key)];
    const rect = p.app.canvas.getBoundingClientRect();
    return { x: rect.x + world.x + dot.x * world.scale.x, y: rect.y + world.y + dot.y * world.scale.y };
  }, key);
  await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 0, modifiers });
  await page.waitForFunction(() => window.qa08Graph.app.stage.children[0].children[1].children.some((dot) => dot.children[0].visible));
  return point;
}

// Bounded frame sampling catches a resize left unpainted until a later frame.
export async function recordGraphTransition(page, action, path) {
  await page.evaluate(() => {
    const p = window.qa08Graph;
    p.events = []; p.frames = []; p.motion = [];
    const recording = p.recording = {};
    p.motionListener = (event) => {
      if (event.target === document.querySelector('.reading-layout')) p.motion.push({ type: event.type, property: event.propertyName, elapsed: event.elapsedTime });
    };
    for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) document.querySelector('.reading-layout').addEventListener(type, p.motionListener);
    const start = performance.now();
    function frame() {
      if (p.recording !== recording || performance.now() - start > 30000 || p.frames.length >= 300) return;
      const rect = p.app.canvas.getBoundingClientRect();
      p.frames.push({ time: performance.now() - start, width: rect.width, height: rect.height, blank: p.pending });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  let failure, result;
  try {
    await action();
    await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((animation) => animation.playState === 'running'), undefined, { timeout: 30000 });
  } catch (error) { failure = error; }
  finally {
    result = await page.evaluate(() => {
      const p = window.qa08Graph; p.recording = null;
      for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) document.querySelector('.reading-layout').removeEventListener(type, p.motionListener);
      return { events: p.events, frames: p.frames, motion: p.motion, canvases: p.canvases.size, blankFrames: p.frames.filter((frame) => frame.blank).length };
    });
  }
  if (failure) result.failure = failure.message;
  if (path) await (await import('node:fs/promises')).writeFile(path, JSON.stringify(result, null, 2));
  if (failure) throw failure;
  assert.equal(result.canvases, 1, 'Keep the same renderer/canvas');
  assert.equal(result.blankFrames, 0, 'No unpainted resize may reach a presentation frame');
  assert.ok(result.events.every((event) => event.sameTurnDraw), 'Resize redraws before the current observer turn ends');
  return result;
}

export async function stopGraphInteractionCheck(page) {
  await page.evaluate(() => {
    const p = window.qa08Graph;
    if (p) {
      p.recording = null;
      for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) document.querySelector('.reading-layout').removeEventListener(type, p.motionListener);
      p.Application.prototype.render = p.original; p.app.renderer.resize = p.resize;
    }
    delete window.qa08Graph;
    delete window.qa08Panel;
    if (window.qa05Network) window.fetch = window.qa05Network.original;
    delete window.qa05Network;
  });
}

export async function assertGraphFixtureEmpty(page) {
  const { data } = await readCloudPersonal(page);
  assert.equal(data.supplements.length, 0); assert.equal(Object.keys(data.notes).length, 0);
  assert.equal(Object.keys(data.noteBindings ?? {}).length, 0);
}

// Public A/B regression: capture a long A, select a fitting B, then shrink B's
// reading area. B must start at its own zero rather than inherit A's bookmark.
export async function checkGraphPanelBookmark(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (await page.evaluate(() => !!document.querySelector('button[aria-label="关闭教材视图"]'))) await page.click('button[aria-label="关闭教材视图"]');
  await page.click('#show-graph-view');
  const fixtures = await page.evaluate(async () => {
    const { contentNodes } = await import('/src/textbook/content.ts');
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const nodes = contentNodes(await readPublishedContent(), { notes: {}, supplements: [] });
    return ['ch6-q-p197-field-task1', 'ch1-road-model'].map((id) => nodes.find((node) => node.id === id));
  });
  assert.ok(fixtures.every(Boolean));
  const panel = () => page.evaluate(() => {
    const element = document.getElementById('supplement-panel');
    return { title: document.getElementById('supplement-title').textContent, scroll: element.scrollTop,
      max: element.scrollHeight - element.clientHeight, sameShell: element === window.qa08BookmarkA };
  });
  await searchGraph(page, fixtures[0].title, fixtures[0].key, { keyboard: true });
  await page.click('.method-toggle');
  await page.evaluate(() => {
    const element = document.getElementById('supplement-panel');
    window.qa08BookmarkA = element; element.scrollTop = element.scrollHeight;
  });
  const a = await panel(); assert.ok(a.scroll > 100);
  await page.click('#show-graph-view');
  await searchGraph(page, fixtures[1].title, fixtures[1].key, { keyboard: true });
  const bFits = await panel(); assert.equal(bFits.max, 0); assert.equal(bFits.scroll, 0);
  await page.click('#show-book-view');
  await page.waitForFunction(() => document.querySelector('.reading-layout.views-split'));
  const bSplit = await panel(); assert.ok(bSplit.max > 0); assert.equal(bSplit.scroll, 0);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true });
  await page.click('#show-graph-view');
  const bNarrow = await panel(); assert.ok(bNarrow.max > 0); assert.equal(bNarrow.scroll, 0);
  assert.equal(bNarrow.sameShell, false);
  await page.evaluate(() => { delete window.qa08BookmarkA; });
  return { a, bFits, bSplit, bNarrow, noInheritedScroll: true };
}
