// Disposable library: real 971-note initial content, plus one controlled link/tag.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { Vault } from './vault.ts';
import { InitialNotes } from './initial-notes.ts';
import { pathLink } from './links.ts';
import { projectNotes, searchNotes } from './note-projection.ts';
const pack = JSON.parse(await readFile(new URL('../resources/initial-notes/grade-7-volume-1.json', import.meta.url), 'utf8'));
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-search-graph-benchmark-'));
const root = path.join(evidence, '库'); await mkdir(root);
const vault = await Vault.open(root, path.join(evidence, '恢复'));
await new InitialNotes(pack).import(vault);
const plan = JSON.parse(await readFile(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/plan.json`), 'utf8'));
assert.equal(plan.notes.length, 971);
const target = plan.notes[0].path;
let bytes = 0;
for (const entry of plan.notes) {
  await mkdir(path.dirname(path.join(root, entry.path)), { recursive: true });
  const source = `${await readFile(path.join(root, entry.path), 'utf8')}\n${pathLink(target)}\n`;
  bytes += Buffer.byteLength(source);
  await writeFile(path.join(root, entry.path), source);
}
let previous = new Map();
const results = [];
async function measure(stage) {
  const start = performance.now(), index = await vault.links(), scanned = performance.now();
  const graph = projectNotes(index.entries), projected = performance.now();
  const matches = searchNotes(index.entries, '有理数'), searched = performance.now();
  const result = { stage, scanMs: scanned - start, graphMs: projected - scanned, searchMs: searched - projected, entriesParsed: index.entries.filter((entry) => previous.get(entry.path) !== entry).length, nodes: graph.nodes.length, edges: graph.edges.length, matches: matches.length };
  previous = new Map(index.entries.map((entry) => [entry.path, entry]));
  results.push(result);
  return index;
}
const first = await measure('first');
await measure('unchanged');
const edited = path.join(root, plan.notes[1].path);
await writeFile(edited, `---\n${stringify({ tags: ['规模检查标签'] })}---\n单篇外改 ${pathLink(target)}`);
const changed = await measure('one-edit');
assert.equal(searchNotes(changed.entries, '规模检查标签 单篇外改').length, 1);
assert.equal(results.at(-1).entriesParsed, 1);
await rm(edited);
const deleted = await measure('one-delete');
assert.equal(results.at(-1).entriesParsed, 0);
const start = performance.now();
const rebuilt = await (await Vault.open(root, path.join(evidence, '恢复'))).links();
const rebuildMs = performance.now() - start;
assert.deepEqual(rebuilt, deleted);
assert.equal(first.entries.length, 971);
const result = { evidence, count: 971, bytes, results, rebuildMs, note: 'Initial-note package bodies/anchors, one controlled link per note. Safe filesystem scan included. Uncached Vault memory; OS disk caches were not cleared. Parsing counts are LinkEntry constructions.' };
await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
