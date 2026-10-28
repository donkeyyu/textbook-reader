import assert from 'node:assert/strict';
import { startGraphInteractionCheck, stopGraphInteractionCheck } from './check-graph-hover-preview.mjs';

// Instrument only the owned Vite origin. The production modules expose no QA API.
export async function startGraphIncrementalServer({ port = 47922 } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'graph-incremental-check', enforce: 'pre',
    configureServer(vite) {
      vite.middlewares.use('/__graph_incremental_check', (_request, response) => {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ kind: 'reader-graph-incremental' }));
      });
    },
    transform(source, id) {
      if (id.endsWith('/reader/graph/SupplementGraph.tsx')) {
        return source.replace('  const host = useRef', `  const [qaInputs, qaSetInputs] = useState(null);
  const qa = window.qaIncremental ??= {};
  if (qaInputs) { nodes = qaInputs.nodes; personalEdges = qaInputs.personalEdges; }
  qa.inputs = { nodes, personalEdges }; qa.setInputs = qaSetInputs;
  const host = useRef`);
      }
      if (id.endsWith('/reader/graph/useSupplementGraph.ts')) {
        return source.replace('simulation.current = force;', `simulation.current = force;
    const qa = window.qaIncremental ??= {};
    qa.generations = (qa.generations ?? 0) + 1; qa.force = force; qa.sprites = sprites.current;
    qa.ticks ??= 0; qa.restarts ??= 0; qa.heats ??= 0;
    force.on('tick.incrementalCheck', () => qa.ticks++);
    const qaRestart = force.restart, qaAlpha = force.alpha;
    qa.forceOriginal = { restart: qaRestart, alpha: qaAlpha };
    force.restart = function (...args) { qa.restarts++; return qaRestart.apply(this, args); };
    force.alpha = function (...args) { if (args.length) qa.heats++; return qaAlpha.apply(this, args); };`);
      }
    },
  }] });
  await server.listen();
  return server;
}

export async function startGraphIncrementalCheck(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal((await (await fetch(`${testOrigin}/__graph_incremental_check`)).json()).kind, 'reader-graph-incremental');
  await startGraphInteractionCheck(page, { testOrigin });
  assert.ok(await page.evaluate(() => !!window.qaIncremental?.force));
}

// Identity comes from the live map, never from the input array's ordering.
export async function incrementalGraphState(page) {
  return page.evaluate(() => {
    const p = window.qaIncremental, app = window.qa08Graph.app, world = app.stage.children[0];
    p.ids ??= new WeakMap(); p.nextId ??= 0;
    const identity = (object) => { if (!p.ids.has(object)) p.ids.set(object, ++p.nextId); return p.ids.get(object); };
    const rect = app.canvas.getBoundingClientRect();
    return { generations: p.generations, ticks: p.ticks, restarts: p.restarts, heats: p.heats,
      alpha: p.force.alpha(), target: p.force.alphaTarget(), renders: window.qa08Graph.renders,
      objects: { dots: world.children[1].children.length, labels: world.children[2].children.length },
      links: p.force.force('link').links().map(({ source, target, kind }) => ({ source: source.key, target: target.key, kind })),
      camera: { x: (app.screen.width / 2 - world.x) / world.scale.x,
        y: (app.screen.height / 2 - world.y) / world.scale.x, zoom: world.scale.x },
      nodes: [...p.sprites].map(([key, { node, dot, circle, label }]) => ({ key, title: node.title, type: node.type,
        x: node.x, y: node.y, vx: node.vx, vy: node.vy, fx: node.fx ?? null, fy: node.fy ?? null,
        nodeId: identity(node), dotId: identity(dot), circleId: identity(circle), labelId: identity(label),
        label: label.text, anchor: label.anchor.y, alpha: dot.alpha, labelVisible: label.visible,
        fill: circle.context.instructions.find((instruction) => instruction.action === 'fill')?.data.style.color,
        screen: { x: rect.x + world.x + node.x * world.scale.x, y: rect.y + world.y + node.y * world.scale.x } })),
      preview: document.querySelector('.graph-preview')?.textContent ?? null,
      title: document.getElementById('supplement-title')?.textContent ?? null,
      paperScroll: document.querySelector('.paper-scroller').scrollTop,
      resizeEvents: window.qa08Graph.events };
  });
}

// Topology may move retained nodes. Their objects, valid pins and camera survive.
export function assertRetainedGraph(before, after) {
  assert.equal(after.generations, before.generations);
  assert.deepEqual(after.camera, before.camera);
  const previous = new Map(before.nodes.map((node) => [node.key, node]));
  for (const node of after.nodes) {
    const old = previous.get(node.key);
    if (!old) continue;
    for (const field of ['nodeId', 'dotId', 'circleId', 'labelId', 'fx', 'fy']) assert.equal(node[field], old[field], `${node.key}: ${field}`);
  }
  assert.equal(after.objects.dots, after.nodes.length);
  assert.equal(after.objects.labels, after.nodes.length);
  const keys = new Set(after.nodes.map((node) => node.key));
  assert.ok(after.links.every(({ source, target }) => keys.has(source) && keys.has(target)));
}

export function assertStableGraph(before, after, { moving = false } = {}) {
  assert.equal(after.generations, before.generations);
  assert.equal(after.restarts, before.restarts, 'A content refresh must not restart layout');
  assert.equal(after.heats, before.heats, 'A content refresh must not heat layout');
  assert.deepEqual(after.camera, before.camera);
  assert.equal(after.paperScroll, before.paperScroll);
  assert.equal(after.nodes.length, before.nodes.length);
  const previous = new Map(before.nodes.map((node) => [node.key, node]));
  for (const node of after.nodes) {
    const old = previous.get(node.key); assert.ok(old);
    for (const field of ['nodeId', 'dotId', 'circleId', 'labelId', 'fx', 'fy']) assert.equal(node[field], old[field], `${node.key}: ${field}`);
    if (!moving) for (const field of ['x', 'y', 'vx', 'vy']) assert.equal(node[field], old[field], `${node.key}: ${field}`);
  }
  if (moving && before.target === 0) assert.ok(after.alpha <= before.alpha, 'An active layout continues cooling');
}

export async function checkEquivalentGraphInputs(page) {
  await page.waitForFunction(() => window.qaIncremental.force.alpha() < window.qaIncremental.force.alphaMin());
  const before = await incrementalGraphState(page);
  await page.evaluate(() => {
    const p = window.qaIncremental;
    p.expectedFirst = p.inputs.nodes.at(-1).key;
    p.setInputs({ nodes: p.inputs.nodes.map((node) => ({ ...node })).reverse(),
      personalEdges: p.inputs.personalEdges.map((edge) => ({ ...edge, source: edge.target, target: edge.source })).reverse() });
  });
  await page.waitForFunction(() => window.qaIncremental.inputs.nodes[0].key === window.qaIncremental.expectedFirst);
  const after = await incrementalGraphState(page);
  assertStableGraph(before, after);
  return { equalObjectsAndReorderedNodesAndEdges: true, stableObjectsAndLayout: true, nodes: after.nodes.length };
}

// Start with no selected node, a cold layout and the target inside the viewport.
export async function checkGraphHoverDwell(page, { key, delay = 800 }) {
  const point = (await incrementalGraphState(page)).nodes.find((node) => node.key === key)?.screen;
  assert.ok(point);
  const move = (point) => page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 0 });
  const off = { x: 10, y: 120 };
  await move(off);
  await page.evaluate((key) => {
    const p = window.qaIncremental, app = window.qa08Graph.app;
    const trace = p.dwellCheck = { events: [], frames: [], own: Object.hasOwn(app, 'render'), original: app.render };
    trace.listener = (event) => trace.events.push({ type: event.type, time: performance.now() });
    for (const type of ['pointermove', 'pointerleave']) app.canvas.addEventListener(type, trace.listener, true);
    app.render = function (...args) {
      const result = trace.original.apply(this, args);
      trace.frames.push({ time: performance.now(), focused: p.sprites.get(key).dot.alpha === 1 && [...p.sprites.values()].some((sprite) => sprite.dot.alpha < 1) });
      return result;
    };
  }, key);
  try {
    await move(point); await move(off);
    await new Promise((resolve) => setTimeout(resolve, delay + 60));
    const quick = await page.evaluate(() => { const p = window.qaIncremental.dwellCheck; return { events: p.events, frames: p.frames }; });
    assert.ok(quick.events[1].time - quick.events[0].time < delay, 'The quick-pass input must finish before the dwell threshold');
    assert.ok(!quick.frames.some((frame) => frame.focused));
    await page.evaluate(() => { const p = window.qaIncremental.dwellCheck; p.events = []; p.frames = []; });
    await move(point);
    await new Promise((resolve) => setTimeout(resolve, delay / 2));
    await move({ x: point.x + 1, y: point.y + 1 });
    await new Promise((resolve) => setTimeout(resolve, delay));
    const dwell = await page.evaluate(() => {
      const p = window.qaIncremental.dwellCheck; return { events: p.events, frames: p.frames };
    });
    const focused = dwell.frames.find((frame) => frame.focused);
    assert.ok(focused && focused.time - dwell.events[0].time >= delay - 5);
    assert.ok(dwell.events[1].time < focused.time && focused.time - dwell.events[1].time >= delay - 5, 'Motion within the same node must restart the timer');
    return { quickPassMs: quick.events[1].time - quick.events[0].time,
      dwellMs: focused.time - dwell.events[0].time, sameNodeTimerRestarted: true, dwell };
  } finally {
    await page.evaluate(() => {
      const p = window.qaIncremental.dwellCheck, app = window.qa08Graph.app;
      if (p.own) app.render = p.original; else delete app.render;
      for (const type of ['pointermove', 'pointerleave']) app.canvas.removeEventListener(type, p.listener, true);
      delete window.qaIncremental.dwellCheck;
    });
  }
}

export async function stopGraphIncrementalCheck(page) {
  await stopGraphInteractionCheck(page);
  await page.evaluate(() => {
    const p = window.qaIncremental;
    if (p) { p.force.on('tick.incrementalCheck', null); if (p.forceOriginal) Object.assign(p.force, p.forceOriginal); }
    delete window.qaIncremental;
  });
}
