import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeKey, type ContentNode, type NodeRef } from '../../textbook/content.ts';
import type { PersonalData, PersonalSupplement } from '../../content/personal.ts';
import { linkText, linkTokens, type LinkBinding } from './document.ts';
import { projectReferences } from './project-references.ts';
import { projectGraph } from '../graph/project-graph.ts';

const bookId = 'book';
const a: NodeRef = { bookId, source: 'default', id: 'a' };
const b: NodeRef = { bookId, source: 'personal', id: 'b' };
function document(...targets: NodeRef[]) {
  const markdown = targets.map(() => linkText('同名')).join('，');
  return { markdown, bindings: linkTokens(markdown).map((token, index): LinkBinding =>
    ({ ...token, id: `instance-${index}`, target: targets[index]! })) };
}
function item(ref: NodeRef, ...targets: NodeRef[]): PersonalSupplement {
  const linked = document(...targets);
  return { id: ref.id, title: '同名', ...linked, markdown: linked.markdown || '没有引用', page: null, region: null };
}
function node(ref: NodeRef): ContentNode {
  const fields = { ...ref, key: nodeKey(ref), title: '同名', summary: ref.id, chapterId: null, sectionId: null };
  if (ref.source === 'personal') return { ...fields, source: 'personal', type: 'personal', location: null, personal: item(ref) };
  return { ...fields, source: 'default', type: 'concept',
    location: { page: 1, region: { x: 0, y: 0, width: 1, height: 1 }, locationId: 'location' },
    supplement: { id: ref.id, locationId: 'location', title: '同名', preview: '', learningRole: '定义概念',
      learningGap: '', learningAction: '', paragraphs: [], related: [] } };
}
function saved(defaultTargets: NodeRef[] = [], personalTargets: NodeRef[] = []): PersonalData {
  const note = document(...defaultTargets);
  return { notes: { [a.id]: note.markdown }, noteBindings: { [a.id]: note.bindings }, supplements: [item(b, ...personalTargets)] };
}
const project = (data: PersonalData, nodes = [node(a), node(b)]) => projectReferences(bookId, nodes, data);
const incoming = (data: PersonalData, target: NodeRef, nodes?: ContentNode[]) =>
  project(data, nodes).incoming.get(nodeKey(target))?.map(({ source, count }) => [nodeKey(source), count]) ?? [];

test('repeated references survive successive deletion until the last saved occurrence', () => {
  const twice = saved([b, b]);
  assert.equal(project(twice).edges.length, 1);
  assert.deepEqual(incoming(twice, b), [[nodeKey(a), 2]]);
  const once = saved([b]);
  assert.equal(project(once).edges.length, 1);
  assert.deepEqual(incoming(once, b), [[nodeKey(a), 1]]);
  const none = saved();
  assert.equal(project(none).edges.length, 0);
  assert.deepEqual(incoming(none, b), []);
});

test('reciprocal references share one undirected pair and keep truthful incoming directions', () => {
  const both = saved([b, b], [a]);
  assert.equal(project(both).edges.length, 1);
  assert.deepEqual(incoming(both, b), [[nodeKey(a), 2]]);
  assert.deepEqual(incoming(both, a), [[nodeKey(b), 1]]);
  const reverseOnly = saved([], [a]);
  assert.deepEqual(project(reverseOnly).edges, project(both).edges, 'the pair is stable regardless of direction');
  assert.deepEqual(incoming(reverseOnly, b), [], 'an undirected line never invents a written reverse reference');
  assert.deepEqual(incoming(reverseOnly, a), [[nodeKey(b), 1]]);
  assert.equal(project(saved()).edges.length, 0);
});

test('deleted targets and removed published or personal sources create no phantom relations', () => {
  const data = saved([b], [a]);
  assert.equal(project(data, [node(a)]).edges.length, 0);
  assert.equal(project(data, [node(a)]).incoming.size, 0);
  assert.equal(project(data, [node(b)]).incoming.size, 0, 'a retained note on an unpublished default is not a graph source');
  const replacement = { ...b, id: 'replacement-with-same-title' };
  assert.equal(project(data, [node(a), node(replacement)]).incoming.size, 0);
  const deleted = { ...data, supplements: [] };
  assert.deepEqual(incoming(deleted, a), [], 'stale node body cannot substitute for the accepted personal snapshot');
});

test('full book, source and id identities remain distinct, including source/target id collisions', () => {
  const personalA = { ...a, source: 'personal' as const };
  const foreignA = { ...a, bookId: 'other-book' };
  const data = saved([personalA, foreignA]);
  data.supplements = [item(personalA, a)];
  const nodes = [node(a), node(personalA), node(foreignA)];
  const result = project(data, nodes);
  assert.equal(result.edges.length, 1);
  assert.deepEqual(incoming(data, personalA, nodes), [[nodeKey(a), 1]]);
  assert.deepEqual(incoming(data, a, nodes), [[nodeKey(personalA), 1]]);
  assert.equal(result.incoming.has(nodeKey(foreignA)), false);
  assert.deepEqual([result.edges[0]!.source, result.edges[0]!.target].sort(), [nodeKey(a), nodeKey(personalA)].sort());
});

test('self-reference remains navigable in the incoming list and has no graph loop', () => {
  const data = saved([a], [b]);
  assert.equal(project(data).edges.length, 0);
  assert.deepEqual(incoming(data, a), [[nodeKey(a), 1]]);
  assert.deepEqual(incoming(data, b), [[nodeKey(b), 1]]);
});

test('canonical syntax and saved bindings exclude stale, code and unbound text without title guessing', () => {
  const data = saved([b, b]);
  const bindings = data.noteBindings![a.id]!;
  data.notes[a.id] = `\`${linkText('同名')}\`，${linkText('同名')}，[[未绑定]]`;
  data.noteBindings![a.id] = [{ ...bindings[0]!, from: 1, to: 7 }, { ...bindings[1]!, from: 9, to: 15 }];
  assert.deepEqual(incoming(data, b), [[nodeKey(a), 1]]);
  data.notes[a.id] = '链接文字已被改写';
  assert.equal(project(data).edges.length, 0);
});

test('projection reads saved text, survives reload/rename, and never modifies target content', () => {
  const data = saved([b, b], [a]);
  const before = structuredClone(data);
  const nodes = [node(a), { ...node(b), title: '新的名称' }];
  const result = project(data, nodes);
  const reloaded = project(JSON.parse(JSON.stringify(data)), nodes);
  assert.deepEqual(reloaded, result);
  assert.deepEqual(data, before);
  assert.equal(result.incoming.get(nodeKey(a))![0]!.source.title, '新的名称');
  assert.equal(result.edges[0]!.kind, 'personal');
  const c = { ...a, id: 'c' };
  const source = node(a), target = node(c);
  assert.ok(source.source === 'default' && target.source === 'default');
  target.supplement.locationId = 'target-location';
  source.supplement.related = [{ locationId: 'target-location', label: '教材依据', purpose: '回顾理由' }];
  const graphNodes = [source, target];
  const defaultGraph = projectGraph(graphNodes);
  const linkedGraph = projectGraph(graphNodes, project(saved([c]), graphNodes).edges);
  assert.equal(linkedGraph.edges.length, defaultGraph.edges.length + 1);
  assert.deepEqual(linkedGraph.defaultEdges, defaultGraph.edges);
  assert.deepEqual(projectGraph(graphNodes, []).edges, defaultGraph.edges, 'removing the last personal edge preserves the default edge');
  assert.equal(linkedGraph.relations.get(nodeKey(a))![0]!.purpose, '回顾理由');
});
