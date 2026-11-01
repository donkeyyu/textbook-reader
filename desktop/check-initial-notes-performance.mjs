// Pass a 971-note fixture. All save/rename/delete probes run in a new disposable copy.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
const baselineApp = process.env.INITIAL_NOTES_BASELINE_APP;
const { Vault } = await import(baselineApp ? pathToFileURL(path.join(baselineApp, 'build-desktop/vault.js')).href : new URL('./vault.ts', import.meta.url).href);
const { InitialNotes, loadInitialPackage } = await import(baselineApp ? pathToFileURL(path.join(baselineApp, 'build-desktop/initial-notes.js')).href : new URL('./initial-notes.ts', import.meta.url).href);

const source = process.argv[2];
assert.ok(source, 'Pass an existing 971-note test vault to clone.');
const evidence = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-identity-performance-')));
const root = path.join(evidence, 'vault'); await cp(source, root, { recursive: true, force: false, errorOnExist: true });
const pack = await loadInitialPackage(path.resolve(import.meta.dirname, '..'));
const importer = new InitialNotes(pack); const vault = await Vault.open(root, path.join(evidence, 'recoveries'));
assert.equal((await vault.list()).length, 971);
const phase = baselineApp ? 'before' : 'after';
const results = []; let reads = 0;
const read = vault.read.bind(vault);
vault.read = async (...args) => { reads++; return read(...args); };
async function measure(name, operation) {
  const before = reads; const start = performance.now(); const value = await operation();
  const result = { phase, name, ms: Math.round((performance.now() - start) * 100) / 100, publicReads: reads - before };
  results.push(result); console.log(JSON.stringify(result)); return value;
}
await measure('cold scan', () => vault.scan());
await measure('warm scan', () => vault.scan());
for (let round = 0; round < 3; round++) {
  const note = await measure(`indexed note() ${round}`, () => importer.note(vault, 'ch3-q-p88-example4'));
  assert.ok(note.path); assert.equal(results.at(-1).publicReads, baselineApp ? 971 : 1);
}
const selected = await importer.note(vault, 'ch3-q-p88-example4');
for (let round = 0; round < 3; round++) {
  const note = await read(selected.path);
  await measure(`indexed save ${round}`, () => vault.save(note.path, `${note.source}\n性能检查 ${round}\n`, note.revision));
  assert.equal(results.at(-1).publicReads, baselineApp ? 973 : 3);
}
const renamed = '性能检查/外部改名.md'; await mkdir(path.join(root, '性能检查'));
await rename(path.join(root, selected.path), path.join(root, renamed));
assert.equal((await measure('external rename lookup', () => importer.note(vault, 'ch3-q-p88-example4'))).path, renamed);
const current = await read(renamed);
await writeFile(path.join(root, '外部副本.md'), current.source);
await measure('new duplicate ID rejection', () => assert.rejects(importer.note(vault, 'ch3-q-p88-example4'), /重复/));
await measure('new duplicate ID save rejection', () => assert.rejects(vault.save(renamed, `${current.source}\n不应保存\n`, current.revision), /ID 重复/));
assert.equal(await readFile(path.join(root, renamed), 'utf8'), current.source);
await rm(path.join(root, '外部副本.md')); await rm(path.join(root, renamed));
await measure('missing target rejection', () => assert.rejects(importer.note(vault, 'ch3-q-p88-example4'), /缺失/));
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ phase, baselineApp, source, root, countBeforeProbes: 971, results, changesVerified: ['external rename/move', 'new duplicate ID lookup/save rejection', 'deletion'], note: 'Fresh metadata scan remains O(N); unchanged Markdown contents are reused. No window/UI timing in this script.' }, null, 2));
console.log(JSON.stringify({ evidence }));
