import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, rename, readdir, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parse } from 'yaml';
import { Vault } from './vault.ts';
import { freshIdentity, prepareSave, rebaseSaved, saveProblem } from './format.ts';
import type { Note } from './contracts.ts';

const meta = (source: string) => parse(source.split(/\r?\n---(?:\r?\n|$)/)[0]!.replace(/^---\r?\n/, ''))._textbook;
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'textbook-conflicts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'vault'), recovery = path.join(directory, 'recovery');
  await mkdir(root);
  const vault = await Vault.open(root, recovery);
  return { root, recovery, vault };
}

test('index: external add/replace/delete, duplicate identities and watcher self-writes remain read-only', async (t) => {
  const { root, vault } = await fixture(t);
  await vault.scan();
  const source = freshIdentity('---\ncustom: {a: keep}\n---\nbody');
  await writeFile(path.join(root, 'first.md'), source);
  let change = await vault.scan();
  assert.deepEqual(change.notes, ['first.md']);
  assert.equal(meta((await vault.read('first.md')).source).update_time, meta(source).update_time);
  await writeFile(path.join(root, 'duplicate.md'), source);
  change = await vault.scan();
  assert.deepEqual(change.duplicates['first.md'], ['duplicate.md', 'first.md']);
  assert.deepEqual((await vault.read('duplicate.md')).duplicatePaths, ['duplicate.md', 'first.md']);
  const replacement = source + '\nexternal';
  await writeFile(path.join(root, 'replacement.tmp'), replacement);
  await rename(path.join(root, 'replacement.tmp'), path.join(root, 'first.md'));
  await rm(path.join(root, 'duplicate.md'));
  change = await vault.scan();
  assert.deepEqual(change.duplicates, {});
  assert.ok(change.changed.includes('duplicate.md')); assert.ok(change.changed.includes('first.md'));
  assert.equal(await readFile(path.join(root, 'first.md'), 'utf8'), replacement);
  const notified = new Promise<void>((resolve) => {
    const stop = vault.watch(() => { stop(); resolve(); });
    t.after(async () => stop());
  });
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'new.md'), 'external file');
  await notified;
  assert.ok((await vault.scan()).notes.includes('nested/new.md'));
  const current = await vault.read('first.md');
  const saved = await vault.save(current.path, current.source + ' saved', current.revision);
  for (let i = 0; i < 3; i++) { await vault.scan(); assert.equal(await readFile(path.join(root, saved.path), 'utf8'), saved.source); }
  assert.deepEqual((await vault.scan()).changed, []);
});

test('index: a transient read failure is retried without a file timestamp change', async (t) => {
  const { root, vault } = await fixture(t);
  const source = freshIdentity('body');
  await writeFile(path.join(root, 'a.md'), source); await writeFile(path.join(root, 'b.md'), source);
  const internal = vault as unknown as { readFile: (name: string) => Promise<Note> };
  const read = internal.readFile.bind(vault);
  internal.readFile = async (name) => { if (name === 'b.md') throw new Error('temporarily busy'); return read(name); };
  assert.deepEqual((await vault.scan()).duplicates, {});
  assert.deepEqual((await vault.scan()).changed, [], 'unreadable files do not emit an endless change loop');
  internal.readFile = read;
  const recovered = await vault.scan();
  assert.deepEqual(recovered.duplicates['a.md'], ['a.md', 'b.md']);
  assert.ok(recovered.changed.includes('b.md'));
  assert.equal(await readFile(path.join(root, 'b.md'), 'utf8'), source);
});

test('copy: explicit duplicate repair and app copy get fresh identity and time, preserve AI and unknown data', async (t) => {
  const { root, vault } = await fixture(t);
  const source = '---\n# keep\ncustom: [a, b]\n_textbook:\n  schema_version: 1\n  id: same\n  create_time: "2020-01-01T00:00:00Z"\n  update_time: "2020-01-01T00:00:00Z"\n  ai_source: {source_id: first, version: "1"}\n  future: {keep: true}\n---\nbody';
  await writeFile(path.join(root, 'original.md'), source); await writeFile(path.join(root, 'copy.md'), source);
  await vault.scan();
  const original = await vault.read('copy.md');
  await assert.rejects(vault.save(original.path, source + 'edit', original.revision), /ID 重复/);
  const repaired = await vault.copy(original.path, source, original.revision, true);
  assert.notEqual(meta(repaired.source).id, 'same');
  assert.notEqual(meta(repaired.source).create_time, '2020-01-01T00:00:00Z');
  assert.deepEqual(meta(repaired.source).ai_source, { source_id: 'first', version: '1' });
  assert.deepEqual(meta(repaired.source).future, { keep: true }); assert.ok(repaired.source.includes('# keep'));
  const copied = await vault.copy(repaired.path, repaired.source, repaired.revision, false);
  assert.equal(copied.path, 'copy（2）.md'); assert.notEqual(meta(copied.source).id, meta(repaired.source).id);
  assert.equal(await readFile(path.join(root, 'original.md'), 'utf8'), source);
  await assert.rejects(vault.copy('copy.md', repaired.source, repaired.revision, true), /已无重复/);
});

test('save: queued writes reject stale revisions; read-only file and interrupted writes retain recovery candidates', async (t) => {
  const { root, vault } = await fixture(t);
  const original = await vault.save('note.md', 'first', null);
  const [first, stale] = await Promise.allSettled([
    vault.save('note.md', original.source + 'A', original.revision), vault.save('note.md', original.source + 'B', original.revision),
  ]);
  assert.equal(first.status, 'fulfilled'); assert.equal(stale.status, 'rejected');
  const current = await vault.read('note.md');
  if (process.platform !== 'win32') {
    await chmod(path.join(root, 'note.md'), 0o444);
    await assert.rejects(vault.save('note.md', current.source + 'readonly', current.revision), /只读/);
    await chmod(path.join(root, 'note.md'), 0o466);
    await assert.rejects(vault.save('note.md', current.source + 'owner-readonly', current.revision), /EACCES|EPERM/);
    await chmod(path.join(root, 'note.md'), 0o600);
  }
  for (const stage of ['prepared', 'checked', 'displaced', 'installed'] as const) {
    const before = await vault.read('note.md');
    vault.writeCheckpoint = async (actual) => { if (actual === stage) throw new Error(`interrupted ${stage}`); };
    await assert.rejects(vault.save('note.md', before.source + stage, before.revision), /interrupted/);
    assert.ok((await vault.recoveries()).some((record) => record.original === before.source && record.candidate.endsWith(stage)));
    assert.ok((await vault.read('note.md')).source);
  }
  vault.writeCheckpoint = undefined;
});

test('save: external edits before displacement, in the replacement gap and after install never report success', async (t) => {
  const { root, vault } = await fixture(t);
  for (const stage of ['prepared', 'checked', 'displaced', 'installed'] as const) {
    const note = await vault.save(`${stage}.md`, 'initial', null);
    const full = path.join(root, note.path);
    vault.writeCheckpoint = async (actual) => { if (actual === stage) await writeFile(full, `external ${stage}`); };
    await assert.rejects(vault.save(note.path, note.source + 'candidate', note.revision));
    assert.equal(await readFile(full, 'utf8'), `external ${stage}`);
    const records = await vault.recoveries();
    assert.ok(records.some((record) => record.path === note.path && record.original === note.source && record.candidate.endsWith('candidate')));
    vault.writeCheckpoint = undefined;
  }
});

test('recovery: SIGKILL between displacement and install retains both versions after reopening', async (t) => {
  const { root, recovery, vault } = await fixture(t);
  const original = await vault.save('crash.md', 'before', null);
  const module = new URL('./vault.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { Vault } from ${JSON.stringify(module)};
    import { writeFile } from 'node:fs/promises';
    const vault = await Vault.open(${JSON.stringify(root)}, ${JSON.stringify(recovery)});
    const original = await vault.read('crash.md');
    vault.writeCheckpoint = async (stage) => {
      if (stage === 'checked') await writeFile(${JSON.stringify(path.join(root, 'crash.md'))}, 'external after final check');
      if (stage === 'displaced') { process.stdout.write('displaced'); await new Promise(() => { setInterval(() => {}, 1000); }); }
    };
    await vault.save('crash.md', original.source + 'after crash', original.revision);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let errors = ''; child.stderr.on('data', (chunk) => { errors += chunk; });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(errors || 'child exited before checkpoint'); })]);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const reopened = await Vault.open(root, recovery);
  const records = await reopened.recoveries();
  assert.equal(records.length, 1); assert.equal(records[0]!.original, original.source);
  assert.equal(records[0]!.observed, 'external after final check'); assert.ok(records[0]!.candidate.endsWith('after crash'));
  const recovered = await reopened.save('recovered.md', freshIdentity(records[0]!.candidate), null);
  assert.ok(recovered.source.endsWith('after crash'));
  assert.ok((await readdir(root)).some((name) => name.endsWith('.previous')));
});

test('recovery: failed recovery storage keeps the captured external inode when another writer claims the path', async (t) => {
  if (process.platform === 'win32') { t.skip('Windows ACL failure is verified on the Windows runtime ticket.'); return; }
  const { root, recovery, vault } = await fixture(t);
  const note = await vault.save('note.md', 'original', null);
  let recordDirectory = '';
  vault.writeCheckpoint = async (stage) => {
    if (stage === 'checked') await writeFile(path.join(root, note.path), 'external preimage');
    if (stage === 'displaced') {
      await writeFile(path.join(root, note.path), 'external replacement');
      recordDirectory = path.join(recovery, (await readdir(recovery))[0]!);
      await chmod(recordDirectory, 0o500);
    }
  };
  try {
    await assert.rejects(vault.save(note.path, note.source + 'candidate', note.revision), /EACCES|EPERM/);
    assert.equal(await readFile(path.join(root, note.path), 'utf8'), 'external replacement');
    assert.ok((await readdir(root)).some((name) => name.endsWith('.previous')));
    assert.equal((await vault.recoveries())[0]!.observed, 'external preimage');
  } finally { if (recordDirectory) await chmod(recordDirectory, 0o700); }
});

test('recovery: an external hardlink replacement of the hidden preimage is neither read nor restored', async (t) => {
  const { root, vault } = await fixture(t);
  const outside = path.join(path.dirname(root), 'outside.md'); await writeFile(outside, 'outside content');
  const note = await vault.save('note.md', 'original', null);
  vault.writeCheckpoint = async (stage) => {
    if (stage !== 'displaced') return;
    const name = (await readdir(root)).find((name) => name.endsWith('.previous'))!;
    await rm(path.join(root, name)); await link(outside, path.join(root, name));
  };
  await assert.rejects(vault.save(note.path, note.source + 'candidate', note.revision), /普通文件/);
  const record = (await vault.recoveries())[0]!;
  assert.equal(record.original, note.source); assert.equal(record.observed, undefined);
  assert.equal(await readFile(outside, 'utf8'), 'outside content');
  await assert.rejects(readFile(path.join(root, note.path)), /ENOENT/);
});

test('format: invalid YAML pauses saves; in-flight metadata rebase retains newer edits and custom fields', () => {
  assert.match(saveProblem('---\nx: [\n---\nbody'), /YAML/);
  const initial = '---\n# keep\ncustom: [one]\n---\nbody';
  const saved = prepareSave(null, initial);
  const rebased = rebaseSaved(initial, initial.replace('body', 'newer body').replace('[one]', '[two]'), saved)!;
  assert.ok(rebased.includes('# keep')); assert.deepEqual(parse(rebased.split('\n---\n')[0]!.slice(4)).custom, ['two']); assert.ok(rebased.endsWith('newer body'));
  assert.equal(meta(rebased).id, meta(saved).id); assert.equal(meta(rebased).create_time, meta(saved).create_time);
  assert.equal(rebaseSaved(initial, '---\nx: [\n---\nbody', saved), undefined);
  const repaired = initial.replace('body', 'repaired');
  const secondSave = prepareSave(saved, rebaseSaved(initial, repaired, saved)!);
  const secondRebase = rebaseSaved(repaired, repaired + ' newer', secondSave)!;
  assert.equal(saveProblem(secondRebase), '');
  assert.equal(meta(secondRebase).id, meta(saved).id);
  assert.equal(meta(secondRebase).create_time, meta(saved).create_time);
  assert.ok(secondRebase.endsWith('repaired newer'));
});
