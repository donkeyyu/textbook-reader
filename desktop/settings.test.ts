import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, readdir, rename, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VaultSettingsStore } from './settings.ts';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-settings-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'vault'); await mkdir(root);
  return { directory, root, store: new VaultSettingsStore(root), file: path.join(root, '.textbook', 'settings.json') };
}

test('settings: defaults do not write; preferences and property types are per vault, never note values', async (t) => {
  const { root, file, store, directory } = await fixture(t);
  const defaults = await store.read();
  assert.deepEqual(defaults, { revision: null, settings: { editor: { bodyMode: 'live', frontmatterMode: 'properties' }, propertyTypes: {} } });
  assert.deepEqual(await readdir(root), []);
  const saved = await store.save(null, { editor: { bodyMode: 'edit' }, propertyTypes: { score: 'number', tags: 'list' } });
  assert.equal(saved.settings.editor.frontmatterMode, 'properties');
  assert.equal((await new VaultSettingsStore(root).read()).settings.propertyTypes.score, 'number');
  const otherRoot = path.join(directory, 'other'); await mkdir(otherRoot);
  assert.deepEqual(await new VaultSettingsStore(otherRoot).read(), defaults);
  await assert.rejects(store.save(saved.revision, { propertyValues: { score: 2 } }), /只能包含/);
  await assert.rejects(store.save(saved.revision, { propertyTypes: { score: 2 } }), /属性类型/);
  await assert.rejects(store.save(saved.revision, { propertyTypes: { _textbook: 'text' } }), /属性类型/);
  await assert.rejects(store.save(saved.revision, { editor: { cursor: 1 } }), /参数/);
  assert.equal((await store.read()).revision, saved.revision);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { editor: { bodyMode: 'edit' }, propertyTypes: { score: 'number', tags: 'list' } });
});

test('settings: unknown fields survive, stale revisions and invalid JSON cannot be overwritten', async (t) => {
  const { file, root, store } = await fixture(t);
  await mkdir(path.dirname(file));
  const initial = { future: { keep: ['a'] }, editor: { future: 'keep', bodyMode: 'edit' }, propertyTypes: { future: 'future-type', score: 'number' } };
  await writeFile(file, JSON.stringify(initial));
  const opened = await store.read();
  assert.deepEqual(opened.settings.propertyTypes, { score: 'number' });
  assert.deepEqual(opened.unsupportedPropertyTypes, ['future']);
  const updated = await store.save(opened.revision, { editor: { frontmatterMode: 'source' }, propertyTypes: { tags: 'list' } });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...initial, editor: { ...initial.editor, frontmatterMode: 'source' }, propertyTypes: { ...initial.propertyTypes, tags: 'list' } });
  assert.deepEqual(updated.unsupportedPropertyTypes, ['future']);
  const externallyChanged = JSON.stringify({ ...initial, external: true }); await writeFile(file, externallyChanged);
  await assert.rejects(store.save(updated.revision, { editor: { bodyMode: 'preview' } }), /外部修改/);
  assert.equal(await readFile(file, 'utf8'), externallyChanged);
  const beforeInvalid = await store.read(); await writeFile(file, '{');
  await assert.rejects(store.read(), /有效 JSON/);
  await assert.rejects(store.save(beforeInvalid.revision, {}), /外部修改/);
  assert.equal(await readFile(file, 'utf8'), '{');
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.md')), []);
});

test('settings: reject directory, file and hard links without changing the outside file', async (t) => {
  const { directory, root, store, file } = await fixture(t);
  const outside = path.join(directory, 'outside'); await mkdir(outside);
  const outsideFile = path.join(outside, 'settings.json'); await writeFile(outsideFile, '{"outside":true}');
  await symlink(outside, path.join(root, '.textbook'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.read(), /链接/); await assert.rejects(store.save(null, {}), /链接/);
  await rm(path.join(root, '.textbook')); await mkdir(path.dirname(file));
  await symlink(outsideFile, file);
  await assert.rejects(store.read(), /链接/); await assert.rejects(store.save(null, {}), /链接/);
  await rm(file); await link(outsideFile, file);
  await assert.rejects(store.read(), /链接/); await assert.rejects(store.save(null, {}), /链接/);
  assert.equal(await readFile(outsideFile, 'utf8'), '{"outside":true}');
});

test('settings: concurrent writes reject stale revisions and a replacement after the final check is retained', async (t) => {
  const { store, file } = await fixture(t);
  const initial = await store.save(null, { editor: { bodyMode: 'edit' } });
  const results = await Promise.allSettled([store.save(initial.revision, { editor: { bodyMode: 'live' } }), store.save(initial.revision, { editor: { bodyMode: 'preview' } })]);
  assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
  const current = await store.read();
  const external = '{"external":"replacement"}';
  store.writeCheckpoint = async (stage) => {
    if (stage === 'checked') { await writeFile(`${file}.external`, external); await rename(`${file}.external`, file); }
  };
  await assert.rejects(store.save(current.revision, { editor: { bodyMode: 'preview' } }), /外部修改/);
  assert.equal(await readFile(file, 'utf8'), external);
  store.writeCheckpoint = undefined;
  assert.equal((await store.read()).settings.editor.bodyMode, 'live');
});

test('settings: an intervening writer keeps its target and the captured preimage', async (t) => {
  const { store, file } = await fixture(t);
  const initial = await store.save(null, { editor: { bodyMode: 'edit' } });
  const original = await readFile(file, 'utf8'), external = '{"external":1}';
  store.writeCheckpoint = async (stage) => { if (stage === 'displaced') await writeFile(file, external); };
  await assert.rejects(store.save(initial.revision, { editor: { bodyMode: 'preview' } }));
  assert.equal(await readFile(file, 'utf8'), external);
  const backup = (await readdir(path.dirname(file))).find((name) => name.endsWith('.previous'))!;
  assert.ok(backup); assert.equal(await readFile(path.join(path.dirname(file), backup), 'utf8'), original);
  await rm(file);
  await assert.rejects(store.read(), /先前设置保留/);
  await assert.rejects(store.save(null, {}), /先前设置保留/);
});


test('settings: displaced symlink or outside hard link is never installed during failed-write restoration', async (t) => {
  for (const kind of ['symlink', 'hardlink']) {
    const { directory, file, store } = await fixture(t);
    const initial = await store.save(null, { editor: { bodyMode: 'edit' } });
    const original = await readFile(file, 'utf8');
    const outside = path.join(directory, 'outside.json');
    const outsideSource = '{"outside":"must remain untouched"}';
    await writeFile(outside, outsideSource);
    let displaced = '';
    store.writeCheckpoint = async (stage) => {
      if (stage !== 'displaced') return;
      displaced = path.join(path.dirname(file), (await readdir(path.dirname(file))).find((name) => name.endsWith('.previous'))!);
      await rename(displaced, `${displaced}.original`);
      if (kind === 'symlink') await symlink(outside, displaced);
      else await link(outside, displaced);
    };
    await assert.rejects(store.save(initial.revision, { editor: { bodyMode: 'preview' } }), /链接/);
    await assert.rejects(lstat(file), { code: 'ENOENT' });
    assert.equal(await readFile(outside, 'utf8'), outsideSource);
    assert.equal(await readFile(`${displaced}.original`, 'utf8'), original);
    assert.equal((await lstat(displaced)).isSymbolicLink(), kind === 'symlink');
    assert.equal((await lstat(outside)).nlink, kind === 'hardlink' ? 2 : 1);
    await assert.rejects(store.read(), /先前设置保留/);
  }
});

test('settings: property names matching object prototype keys remain isolated own entries', async (t) => {
  const { file, store } = await fixture(t);
  const patch = JSON.parse('{"propertyTypes":{"__proto__":"text","toString":"number","constructor":"boolean"}}');
  const saved = await store.save(null, patch);
  assert.deepEqual(Object.entries(saved.settings.propertyTypes), [['__proto__', 'text'], ['toString', 'number'], ['constructor', 'boolean']]);
  const changed = await store.save(saved.revision, { propertyTypes: { toString: 'date' } });
  assert.equal(Object.hasOwn(changed.settings.propertyTypes, '__proto__'), true);
  assert.equal(changed.settings.propertyTypes['__proto__'], 'text');
  assert.equal(changed.settings.propertyTypes['toString'], 'date');
  assert.equal(Object.getPrototypeOf(changed.settings.propertyTypes), Object.prototype);
  const disk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(disk.propertyTypes['__proto__'], 'text');
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'bodyMode'), false);
});


test('settings: unknown property types are reported without automatic conversion; explicit type choice replaces only that type', async (t) => {
  const { file, store } = await fixture(t);
  await mkdir(path.dirname(file));
  await writeFile(file, JSON.stringify({ propertyTypes: { future: 'future-type', other: { future: true }, tags: 'list' }, unknown: 'keep' }));
  const opened = await store.read();
  assert.deepEqual(opened.unsupportedPropertyTypes, ['future', 'other']);
  const updated = await store.save(opened.revision, { editor: { bodyMode: 'edit' } });
  assert.deepEqual(updated.unsupportedPropertyTypes, ['future', 'other']);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).propertyTypes.future, 'future-type');
  const chosen = await store.save(updated.revision, { propertyTypes: { future: 'text' } });
  assert.deepEqual(chosen.unsupportedPropertyTypes, ['other']);
  assert.equal(chosen.settings.propertyTypes.future, 'text');
  const known = await store.save(chosen.revision, { propertyTypes: { other: 'object' } });
  assert.equal(Object.hasOwn(known, 'unsupportedPropertyTypes'), false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).unknown, 'keep');
});
