// Run with Node's type stripping. The input is a generated initial-note package;
// all Markdown and edits belong to a disposable, separately created library.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { Vault, notePath } from './vault.ts';
import { backlinks, pathLink } from './links.ts';
const input = process.argv[2];
if (!input) throw new Error('Pass the path to a 971-entry initial-note JSON package.');
const pack = JSON.parse(await readFile(input, 'utf8'));
assert.equal(pack.entries.length, 971);
const evidence = await mkdtemp(path.join(os.tmpdir(), 'textbook-link-benchmark-'));
const root = path.join(evidence, '库'); await mkdir(root);
// The package contains suggested paths. Import assigns available suffixes to
// repeated suggestions; do the same before writing this benchmark library.
const taken = new Set();
const entries = pack.entries.map((entry) => {
  notePath(entry.path);
  let name = entry.path;
  for (let number = 2; taken.has(name.toLocaleLowerCase('en-US')); number++) name = `${entry.path.slice(0, -3)}（${number}）.md`;
  taken.add(name.toLocaleLowerCase('en-US'));
  return { ...entry, path: name };
});
const target = entries[0].path;
const parents = new Set(entries.map((entry) => path.dirname(entry.path)));
for (const parent of parents) await mkdir(path.join(root, parent), { recursive: true });
let bytes = 0;
for (const entry of entries) {
  const source = `---\n${stringify({ _textbook: { schema_version: 1, id: `benchmark-${entry.sourceId}`, anchors: entry.anchors }, 用户链接: pathLink(target) })}---\n${entry.body}\n`;
  bytes += Buffer.byteLength(source);
  await writeFile(path.join(root, entry.path), source);
}
const vault = await Vault.open(root, path.join(evidence, 'recovery'));
const results = [];
let previous = new Map();
async function measure(stage) {
  const start = performance.now(), index = await vault.links();
  const milliseconds = performance.now() - start;
  // linkEntry returns a new object each time a Markdown entry is parsed. Object
  // identity exposes cache reuse without adding benchmark hooks to production.
  const entriesParsed = index.entries.filter((entry) => previous.get(entry.path) !== entry).length;
  const removed = [...previous.keys()].filter((name) => !index.entries.some((entry) => entry.path === name)).length;
  previous = new Map(index.entries.map((entry) => [entry.path, entry]));
  results.push({ stage, milliseconds: Math.round(milliseconds * 10) / 10, entriesParsed, removed });
  return index;
}
const first = await measure('first');
assert.equal(first.entries.length, 971);
assert.equal(backlinks(target, first.entries).length, 971);
const unchanged = await measure('unchanged');
assert.deepEqual(unchanged, first);
const edited = path.join(root, entries[1].path);
await writeFile(edited, `${await readFile(edited, 'utf8')}\n${pathLink(target)}\n`);
const updated = await measure('one-edit');
assert.equal(backlinks(target, updated.entries).find(({ entry }) => entry.path === entries[1].path).references.length, 2);
await rm(edited);
const deleted = await measure('one-delete');
assert.equal(deleted.entries.length, 970);
assert.equal(backlinks(target, deleted.entries).length, 970);
const result = { evidence, input, notes: 971, bytes, results, note: 'Real initial-note bodies and anchors; one controlled user-property reference added per note. Counts are linkEntry constructions, not inner YAML parser calls. Timings include safe filesystem scan.' };
await writeFile(path.join(evidence, 'benchmark.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
