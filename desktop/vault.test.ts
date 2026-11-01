import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, symlink, link, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { inspect, prepareSave } from './format.ts';
import { Vault, notePath } from './vault.ts';
import { cleanState, LocalState } from './state.ts';

const time = '2026-11-01T09:00:00.000Z';
const metadata = (source: string) => parse(source.split(/\r?\n---(?:\r?\n|$)/)[0]!.replace(/^---\r?\n/, ''));
test('format: identity, unknown fields, comments and time maintenance', () => {
  const created = prepareSave(null, '# 新笔记\n', time);
  const meta = metadata(created)._textbook;
  assert.match(meta.id, /^[0-9a-f-]{36}$/);
  assert.equal(meta.create_time, time); assert.equal(meta.update_time, time);
  const manual = '---\n# keep comment\ncustom: [1, two]\n创建时间: yesterday\n_textbook:\n  id: legacy-id\n  schema_version: 1\n  create_time: "2020-01-01T10:00:00+08:00"\n  update_time: "2021-01-01T10:00:00+08:00"\n  future: {keep: yes}\n---\noriginal\n';
  assert.equal(metadata(prepareSave(manual, manual, time))._textbook.update_time, '2021-01-01T10:00:00+08:00');
  for (const edited of [manual.replace('original', 'edited'), manual.replace('two', 'three'), manual.replace('  future:', '  anchors: [{textbook: current}]\n  future:')]) {
    const saved = prepareSave(manual, edited, time);
    assert.ok(saved.includes('# keep comment'));
    assert.deepEqual(metadata(saved)._textbook.future, { keep: 'yes' });
    assert.equal(metadata(saved)._textbook.id, 'legacy-id');
    assert.equal(metadata(saved)._textbook.create_time, '2020-01-01T10:00:00+08:00');
    assert.equal(metadata(saved)._textbook.update_time, time);
    assert.equal(metadata(saved).创建时间, 'yesterday');
  }
  const identityOnly = metadata(prepareSave('manual\n', 'manual\n', time))._textbook;
  assert.ok(identityOnly.id); assert.equal(identityOnly.create_time, undefined); assert.equal(identityOnly.update_time, undefined);
  const bomManual = '\uFEFF# 手动标题\n';
  const bomSaved = prepareSave(bomManual, bomManual, time);
  assert.ok(bomSaved.startsWith('\uFEFF---\n'));
  assert.equal([...bomSaved].filter((character) => character === '\uFEFF').length, 1);
  assert.ok(bomSaved.endsWith('---\n# 手动标题\n'));
  assert.ok(!bomSaved.includes('update_time:'));
  assert.ok(prepareSave(bomSaved, bomSaved, time).startsWith('\uFEFF---\n'));
  const editedManual = metadata(prepareSave('manual\n', 'edited\n', time))._textbook;
  assert.equal(editedManual.create_time, undefined); assert.equal(editedManual.update_time, time);
  const abnormal = manual.replace('2020-01-01T10:00:00+08:00', '2020-02-31T10:00:00Z').replace('2021-01-01T10:00:00+08:00', 'bad-time');
  assert.equal(inspect(abnormal).problems.length, 2);
  assert.equal(metadata(prepareSave(abnormal, abnormal.replace('original', 'changed'), time))._textbook.update_time, 'bad-time');
  assert.throws(() => prepareSave(null, '---\nx: 1\nx: 2\n---\n'), /YAML/);
  assert.throws(() => prepareSave(null, '---\nx: a\n'), /结束/);
  assert.throws(() => prepareSave(null, '---\n_textbook: {id: 4}\n---\n'), /ID/);
  assert.throws(() => prepareSave(null, '---\n_textbook: {schema_version: 2}\n---\n'), /只读/);
  const fixed = prepareSave('---\nx: [\n---\nbody', '---\nx: []\n---\nbody', time);
  assert.equal(metadata(fixed)._textbook.update_time, time);
  const crlf = prepareSave('---\r\nx: 1\r\n---\r\nbody\r\n', '---\r\nx: 2\r\n---\r\nbody\r\n', time);
  assert.equal(crlf.replace(/\r\n/g, '').includes('\n'), false);
});

test('vault: read-only scans, exclusive names, conflict and write failure preserve files', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'textbook-vault-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'vault'); await mkdir(root);
  const full = path.join(root, 'manual.md'); await writeFile(full, '# 原始\n');
  const vault = await Vault.open(root, path.join(directory, 'recovery'));
  const before = await stat(full);
  assert.deepEqual(await vault.list(), ['manual.md']);
  const original = await vault.read('manual.md');
  assert.equal(original.source, '# 原始\n'); assert.equal((await stat(full)).mtimeMs, before.mtimeMs);
  const identity = await vault.save(original.path, original.source, original.revision);
  assert.equal(metadata(identity.source)._textbook.create_time, undefined);
  assert.equal(metadata(identity.source)._textbook.update_time, undefined);
  const saved = await vault.save('manual.md', `${identity.source}changed\n`, identity.revision);
  assert.equal((await vault.read('manual.md')).source, saved.source);
  assert.ok(metadata(saved.source)._textbook.update_time);
  const newNote = await vault.save('manual.md', 'new\n', null);
  assert.equal(newNote.path, 'manual（2）.md');
  assert.notEqual(metadata(newNote.source)._textbook.id, metadata(saved.source)._textbook.id);
  await writeFile(full, 'external changed\n');
  await assert.rejects(vault.save('manual.md', 'my draft', saved.revision), /磁盘文件已改变/);
  assert.equal(await readFile(full, 'utf8'), 'external changed\n');
  await writeFile(path.join(directory, 'blocked'), 'not a directory');
  const broken = await Vault.open(root, path.join(directory, 'blocked', 'recovery'));
  const disk = await broken.read('manual.md');
  await assert.rejects(broken.save('manual.md', 'draft retained', disk.revision));
  assert.equal(await readFile(full, 'utf8'), disk.source);
  if (process.platform !== 'win32') {
    await chmod(root, 0o500);
    try { await assert.rejects(vault.save('cannot-write.md', 'draft', null), /EACCES|EPERM/); }
    finally { await chmod(root, 0o700); }
  }
  await writeFile(path.join(root, 'duplicate.md'), saved.source);
  await assert.rejects(vault.save('duplicate2.md', saved.source, null), /ID 重复/);
  await writeFile(path.join(root, 'invalid.md'), '---\n_textbook: {id: 99}\n---\nbody');
  const invalid = await vault.read('invalid.md');
  await assert.rejects(vault.save(invalid.path, `${invalid.source}edit`, invalid.revision), /ID 异常/);
  assert.equal(await readFile(path.join(root, 'invalid.md'), 'utf8'), invalid.source);
  await writeFile(path.join(root, 'future.md'), '---\n_textbook: {schema_version: 2}\n---\nbody');
  assert.equal((await vault.read('future.md')).readOnly, true);
});

test('vault: reject traversal, outside links, hard links and invalid bytes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'textbook-boundary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'vault'); await mkdir(root);
  const outside = path.join(directory, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.md'), 'secret');
  let symlinks = true;
  try {
    await symlink(outside, path.join(root, 'shortcut'), 'dir');
    await symlink(path.join(outside, 'secret.md'), path.join(root, 'linked.md'));
  } catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    symlinks = false; t.diagnostic('Windows 未授予创建符号链接权限；真实链接边界须另行验收。');
  }
  await link(path.join(outside, 'secret.md'), path.join(root, 'hard.md'));
  const vault = await Vault.open(root, path.join(directory, 'recovery'));
  for (const input of ['../outside/secret.md', '/secret.md', 'a/../../secret.md', 'C:/secret.md', 'a\\secret.md', '.textbook/x.md', 'CON.md', 'trailing /x.md', 'a\0.md']) assert.throws(() => notePath(input));
  assert.deepEqual(await vault.list(), []);
  for (const input of [...(symlinks ? ['shortcut/secret.md', 'linked.md'] : []), 'hard.md']) {
    await assert.rejects(vault.read(input));
    await assert.rejects(vault.save(input, 'attack', null));
  }
  assert.equal(await readFile(path.join(outside, 'secret.md'), 'utf8'), 'secret');
  await writeFile(path.join(root, 'bytes.md'), new Uint8Array([0xff]));
  await assert.rejects(vault.read('bytes.md'));
  const saved = await vault.save('healthy.md', 'healthy', null);
  assert.ok(saved.source.includes('healthy'));
});

test('local state: independent vaults, absent or invalid positions do not affect content', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'textbook-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const local = new LocalState(directory);
  await local.remember('/vault-one'); assert.equal(await local.lastVault(), '/vault-one');
  await local.save('/vault-one', { activePath: 'one.md', positions: { 'one.md': { cursor: 90000, scroll: 456 } } }, { x: 20 });
  await local.save('/vault-two', { activePath: 'two.md', positions: {} }, { x: 100 });
  assert.equal((await local.load('/vault-one')).state.activePath, 'one.md');
  assert.equal((await local.load('/vault-two')).state.activePath, 'two.md');
  assert.deepEqual(cleanState({ positions: { bad: { cursor: 'bad', scroll: 0 }, fine: { cursor: -1, scroll: -5 } } }).positions.fine, { cursor: 0, scroll: 0 });
  assert.equal(cleanState({ positions: { bad: {} } }).positions.bad, undefined);
});
