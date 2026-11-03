import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { Vault } from './vault.ts';

// A disposable copy of the bundled notes; never reads or changes a user's vault.
const directory = await mkdtemp(path.join(os.tmpdir(), 'textbook-vault-benchmark-'));
try {
  const root = path.join(directory, 'notes');
  const pack = JSON.parse(await readFile(new URL('../resources/initial-notes/grade-7-volume-1.json', import.meta.url), 'utf8'));
  for (const [index, entry] of pack.entries.entries()) {
    const full = path.join(root, path.dirname(entry.path), `${index}-${path.basename(entry.path)}`);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, `---\n${stringify({ _textbook: { schema_version: 1, id: entry.sourceId, anchors: entry.anchors } })}---\n${entry.body}`);
  }
  const vault = await Vault.open(root, path.join(directory, 'recovery'));
  const measure = async (operation) => {
    const started = performance.now();
    const result = await operation();
    return { ms: Math.round(performance.now() - started), result };
  };
  const cold = await measure(() => vault.scan());
  assert.equal(cold.result.notes.length, pack.entries.length);
  const warm = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const scan = await measure(() => vault.scan());
    assert.deepEqual(scan.result.changed, []);
    warm.push(scan.ms);
  }
  const links = await measure(() => vault.links());
  assert.equal(links.result.entries.length, pack.entries.length);
  console.log(JSON.stringify({ notes: pack.entries.length, coldMs: cold.ms, warmMs: warm, linksMs: links.ms }));
  const maxWarm = Number(process.argv[2] ?? Infinity);
  assert.ok(warm.every((ms) => ms < maxWarm), `unchanged scan exceeds ${maxWarm} ms`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
