import assert from 'node:assert/strict';
import { openPersonalLibrary } from './check-personal-library.mjs';
import { readCloudPersonal } from './check-content-migration.mjs';
import { editorDocument, installSaveProbe, replaceEditor, savePersonalEditor, selectEditorRange } from './check-stable-note-links.mjs';

export async function startBidirectionalLinksServer({ port = 54946 } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'bidirectional-links-check-origin', configureServer(vite) {
      vite.middlewares.use('/__bidirectional_links_check', (_request, response) => {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ kind: 'reader-bidirectional-links-06' }));
      });
    },
  }] });
  await server.listen();
  return server;
}

// Use only a fresh, dedicated origin and the orchestrator's ticket06 synthetic account.
export async function startBidirectionalLinksCheck(page, { testOrigin, credentials }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal((await (await fetch(`${testOrigin}/__bidirectional_links_check`)).json()).kind, 'reader-bidirectional-links-06');
  assert.equal(credentials.ticket, '06');
  assert.equal(credentials.synthetic, true);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('textbook-personal-'))), false);
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

export async function savedReferenceState(page) {
  return page.evaluate(async () => {
    const { bookId, contentNodes, nodeKey } = await import('/src/textbook/content.ts');
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const { supabase } = await import('/src/reader/supabase.ts');
    const { projectReferences } = await import('/src/reader/links/project-references.ts');
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) throw new Error('Ticket06 synthetic login required');
    const { data } = await readPersonal(session.user.id);
    const nodes = contentNodes(await readPublishedContent(), data);
    const result = projectReferences(bookId, nodes, data);
    return { edges: result.edges, incoming: [...result.incoming].map(([target, references]) =>
      ({ target, sources: references.map(({ source, count }) => ({ source: nodeKey(source), count })) })) };
  });
}

export async function createReferenceFixtures(page) {
  assert.equal((await readCloudPersonal(page)).data.supplements.length, 0);
  for (const [title, markdown] of [['QA06 同名', '06目标A摘要'], ['QA06 同名', '06目标B摘要'], ['QA06 来源', '06个人来源摘要']]) {
    await openPersonalLibrary(page);
    await page.click('.personal-library button:text-is("新建补充")');
    await page.fill('.personal-title input', title);
    await page.selectOption('select[aria-label="章节"]', 'chapter-2');
    await page.selectOption('select[aria-label="节"]', '2.1');
    await replaceEditor(page, markdown);
    await savePersonalEditor(page);
  }
  const { data } = await readCloudPersonal(page);
  const a = data.supplements.find((item) => item.markdown === '06目标A摘要');
  const b = data.supplements.find((item) => item.markdown === '06目标B摘要');
  const source = data.supplements.find((item) => item.title === 'QA06 来源');
  assert.ok(a && b && source);
  assert.notEqual(a.id, b.id);
  return { a: a.id, b: b.id, source: source.id };
}

export async function rebindReference(page, index, summary) {
  const binding = (await editorDocument(page)).bindings[index];
  assert.ok(binding);
  await selectEditorRange(page, binding.to - 2);
  await page.keyboard.press('Control+Space');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  const position = await page.evaluate((summary) => [...document.querySelectorAll('.cm-tooltip-autocomplete li')]
    .findIndex((item) => item.textContent.includes(summary)), summary);
  assert.ok(position >= 0);
  for (let step = 0; step < position; step++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
}

export async function checkProjectedView(page, targetKey) {
  const saved = await savedReferenceState(page);
  const view = await referenceView(page);
  assert.equal(view.personalEdges, saved.edges.length);
  assert.deepEqual(view.incoming.map(({ source, count }) => ({ source, count })),
    saved.incoming.find(({ target }) => target === targetKey)?.sources ?? []);
  return { saved, view };
}

export async function referenceGraphEmphasis(page, selectedKey) {
  return page.evaluate(async (selectedKey) => {
    const { bookId, contentNodes } = await import('/src/textbook/content.ts');
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { readPersonal } = await import('/src/reader/cloud-personal.ts');
    const { supabase } = await import('/src/reader/supabase.ts');
    const { projectGraph } = await import('/src/reader/graph/project-graph.ts');
    const { projectReferences } = await import('/src/reader/links/project-references.ts');
    const user = (await supabase.auth.getSession()).data.session.user;
    const { data } = await readPersonal(user.id);
    const nodes = contentNodes(await readPublishedContent(), data);
    const edges = projectGraph(nodes, projectReferences(bookId, nodes, data).edges).edges;
    const direct = new Set([selectedKey]);
    for (const { source, target } of edges) {
      if (source === selectedKey) direct.add(target);
      if (target === selectedKey) direct.add(source);
    }
    const app = window.qa03GraphProbe?.app;
    if (!app) throw new Error('Install the QA-only Pixi probe first');
    const world = app.stage.children[0], dots = world.children[1].children, labels = world.children[2].children;
    if (dots.length !== nodes.length) throw new Error('Graph has not adopted the current saved node snapshot');
    let wrong = 0, clear = 0, dim = 0, selected;
    nodes.forEach((node, index) => {
      const dot = dots[index], label = labels[index];
      if (direct.has(node.key)) { clear++; if (dot.alpha !== 1 || label.alpha !== 1) wrong++; }
      else { dim++; if (!(dot.alpha > 0 && dot.alpha < 1)) wrong++; }
      if (node.key === selectedKey) selected = { labelVisible: label.visible, title: label.text };
    });
    return { direct: direct.size, clear, dim, wrong, selected, visibleLabels: labels.filter((label) => label.visible).length, zoom: world.scale.x };
  }, selectedKey);
}

export async function referenceView(page) {
  return page.evaluate(() => ({
    personalEdges: Number(document.querySelector('.supplement-graph')?.getAttribute('data-personal-edge-count') ?? NaN),
    defaultEdges: Number(document.querySelector('.supplement-graph')?.getAttribute('data-default-edge-count') ?? NaN),
    incoming: [...document.querySelectorAll('.backlinks .backlink')].map((button) =>
      ({ source: button.getAttribute('data-node-key'), count: Number(button.getAttribute('data-reference-count')), text: button.textContent })),
    invalidLinks: document.querySelectorAll('.node-link-invalid').length,
    title: document.getElementById('supplement-title')?.textContent,
    paperScroll: document.querySelector('.paper-scroller')?.scrollTop,
  }));
}

export async function checkIncomingNavigation(page, sourceKey, title) {
  const before = await referenceView(page);
  const index = before.incoming.findIndex((reference) => reference.source === sourceKey);
  assert.ok(index >= 0, 'Only a real incoming source offers reverse navigation');
  await page.click(`.backlinks .backlink >> nth=${index}`);
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, title);
  const after = await referenceView(page);
  assert.equal(after.paperScroll, before.paperScroll, 'Reverse navigation leaves textbook position intact');
  return { before, after };
}
