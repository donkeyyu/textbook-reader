import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from './vault.ts';
import { parse } from './format.ts';
import { InitialNotes, loadInitialPackage } from './initial-notes.ts';
import { initialBody, packageVersion, type InitialPackage } from './initial-package.ts';

const project = path.resolve(import.meta.dirname, '..');
const fixed = await loadInitialPackage(project);
function sample(): InitialPackage {
  const entries = fixed.entries.slice(0, 3);
  return { ...fixed, entries, version: packageVersion({ source: fixed.source, entries }) };
}
async function fixture(pack = sample()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'initial-notes-unit-'));
  return { root, vault: await Vault.open(root, path.join(root, '.recoveries')), importer: new InitialNotes(pack), pack };
}

test('conversion preserves every source paragraph/guide, fold intent, source relations and indexed rects', () => {
  const source = fixed.source as { content: { supplements: { id: string; paragraphs: string[]; questionGuide?: { continuous?: boolean; knowledgePoints?: string[]; method: string[]; cautions?: string[] }; related: unknown[] }[] }; locations: Record<string, unknown>; diagrams: Record<string, string> };
  assert.equal(fixed.entries.length, 971);
  for (const note of source.content.supplements) {
    const entry = fixed.entries.find((entry) => entry.sourceId === note.id)!;
    const unquoted = entry.body.replace(/^> ?/gm, '');
    for (const text of [...note.paragraphs, ...(note.questionGuide?.knowledgePoints ?? []), ...(note.questionGuide?.method ?? []), ...(note.questionGuide?.cautions ?? [])]) assert.ok(unquoted.includes(text), note.id);
    if (note.questionGuide?.method.length && !note.questionGuide.continuous) assert.ok(entry.body.includes('[!hint]-'));
    for (const anchor of entry.anchors) {
      assert.equal(anchor.textbook, fixed.textbook);
      assert.ok(anchor.pdf_page >= 1 && anchor.pdf_page <= 202);
      assert.ok(anchor.rects.every((rect) => rect.length === 4 && rect.every((number) => number >= 0 && number <= 1)));
    }
  }
  assert.equal(Object.keys(source.diagrams).length, 3);
  assert.equal(initialBody({ paragraphs: [] }), '');
});

test('full 971-note import is explicit, uses independent IDs, and repeated import preserves user changes/moves/deletion', async (t) => {
  const { root, vault, importer } = await fixture(fixed); t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await vault.list(), []);
  await assert.rejects(importer.index(vault));
  assert.deepEqual(await readdir(root), []);
  const start = performance.now();
  const first = await importer.import(vault);
  t.diagnostic(`Full import: ${Math.round(performance.now() - start)} ms, ${first.created} files`);
  assert.equal(first.created, 971);
  const index = await importer.index(vault); const item = index.notes[0]!;
  const read = vault.read.bind(vault); let lookupReads = 0;
  vault.read = async (relative) => { lookupReads++; return read(relative); };
  assert.equal((await importer.note(vault, item.sourceId)).path, item.path);
  assert.equal(lookupReads, 1, 'a warm 971-note lookup only reads its final target');
  vault.read = read;
  const note = await vault.read(item.path!); const meta = parse(note.source).data._textbook;
  assert.notEqual(meta.id, item.sourceId); assert.equal(meta.id, item.id);
  assert.equal(meta.create_time, meta.update_time); assert.equal(meta.ai_source.archive, 'unpublished');
  assert.equal(meta.ai_source.version, fixed.version);
  const beforeSource = await readFile(path.join(root, `.textbook/textbooks/${fixed.textbook}/initial-notes/source.json`));
  await writeFile(path.join(root, item.path!), note.source + '\n用户修改\n');
  await mkdir(path.join(root, '我的笔记')); const moved = '我的笔记/已改名.md'; await rename(path.join(root, item.path!), path.join(root, moved));
  const removed = index.notes[1]!; await rm(path.join(root, removed.path!));
  assert.equal((await importer.import(vault)).created, 0);
  assert.ok((await readFile(path.join(root, moved), 'utf8')).endsWith('用户修改\n'));
  assert.equal((await importer.note(vault, item.sourceId)).path, moved);
  await assert.rejects(importer.note(vault, removed.sourceId), /缺失/);
  assert.deepEqual(await readFile(path.join(root, `.textbook/textbooks/${fixed.textbook}/initial-notes/source.json`)), beforeSource);
  assert.equal((await vault.list()).length, 970);
});

test('failure before receipt retries without duplicates, preserves edits, handles existing same-name files', async (t) => {
  const { root, vault, importer, pack } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const conflict = pack.entries[0]!.path;
  await mkdir(path.dirname(path.join(root, conflict)), { recursive: true }); await writeFile(path.join(root, conflict), '用户同名原件');
  importer.checkpoint = async () => { throw new Error('simulated interruption'); };
  await assert.rejects(importer.import(vault), /simulated/);
  const index = await importer.index(vault); const created = index.notes.find((note) => note.path)!;
  assert.notEqual(created.path, conflict);
  const original = await readFile(path.join(root, created.path!), 'utf8'); await writeFile(path.join(root, created.path!), original + '\n失败后编辑');
  importer.checkpoint = undefined;
  assert.equal((await importer.import(vault)).created, 2);
  assert.equal(await readFile(path.join(root, conflict), 'utf8'), '用户同名原件');
  assert.ok((await readFile(path.join(root, created.path!), 'utf8')).endsWith('失败后编辑'));
  assert.equal((await importer.index(vault)).notes.filter((note) => note.path).length, 3);
});

test('claimed planned paths, replaced receipt directories and copied IDs stop without overwriting', async (t) => {
  const { root, vault, importer, pack } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  importer.checkpoint = async () => { throw new Error('stop'); };
  await assert.rejects(importer.import(vault)); importer.checkpoint = undefined;
  const plan = JSON.parse(await readFile(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/plan.json`), 'utf8'));
  const target = plan.notes[1].path; await writeFile(path.join(root, target), '并发用户内容');
  await assert.rejects(importer.import(vault), /exist/i); assert.equal(await readFile(path.join(root, target), 'utf8'), '并发用户内容');
  await rm(path.join(root, target));
  const first = plan.notes[0].path; await writeFile(path.join(root, '副本.md'), await readFile(path.join(root, first)));
  await assert.rejects(importer.note(vault, plan.notes[0].sourceId), /重复/); await rm(path.join(root, '副本.md'));
  const receipts = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/receipts`);
  await rm(receipts, { recursive: true, force: true }); const external = await mkdtemp(path.join(os.tmpdir(), 'initial-outside-')); t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, receipts, 'dir'); await assert.rejects(importer.import(vault), /符号链接|目录联接/); assert.deepEqual(await readdir(external), []);
});


test('lost persistent import plan never duplicates existing source notes', async (t) => {
  const { root, vault, importer, pack } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await importer.import(vault);
  const before = await vault.list();
  await rm(path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/plan.json`));
  await assert.rejects(importer.import(vault), /导入计划缺失/);
  assert.deepEqual(await vault.list(), before);
});


test('identity lookup sees immediate external moves, replacement, duplicates and deletion, and retries a race', async (t) => {
  const { root, vault, importer } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await importer.import(vault);
  const item = (await importer.index(vault)).notes[0]!; const original = await readFile(path.join(root, item.path!), 'utf8');
  await mkdir(path.join(root, '移动')); const moved = '移动/改名.md';
  await rename(path.join(root, item.path!), path.join(root, moved));
  // No refresh callback, delay or explicit scan: the lookup must observe the change.
  const changes: string[] = [];
  const stop = vault.watch(() => {}, (change) => changes.push(...change.changed)); t.after(stop);
  assert.equal((await importer.note(vault, item.sourceId)).path, moved);
  assert.ok(changes.includes(moved)); assert.ok(changes.includes(item.path!));
  await writeFile(path.join(root, item.path!), original.replace(item.id, 'another-note'));
  assert.equal((await importer.note(vault, item.sourceId)).path, moved);
  await writeFile(path.join(root, '副本.md'), original);
  await assert.rejects(importer.note(vault, item.sourceId), /重复/);
  await rm(path.join(root, '副本.md'));
  const read = vault.read.bind(vault); let raced = false; const next = '移动/再次移动.md';
  vault.read = async (relative) => {
    if (relative === moved && !raced) {
      raced = true; await rename(path.join(root, moved), path.join(root, next));
      await writeFile(path.join(root, moved), original.replace(item.id, 'replacement'));
    }
    return read(relative);
  };
  assert.equal((await importer.note(vault, item.sourceId)).path, next);
  vault.read = read;
  await writeFile(path.join(root, next), original.replace(item.id, 'changed-identity'));
  await assert.rejects(importer.note(vault, item.sourceId), /缺失或身份已改变/);
  await writeFile(path.join(root, next), original); await rm(path.join(root, next));
  await assert.rejects(importer.note(vault, item.sourceId), /缺失或身份已改变/);
});

test('save uses the fresh identity index and still rejects newly copied IDs or tolerates unreadable unrelated files', async (t) => {
  const { root, vault, importer } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await importer.import(vault);
  const item = (await importer.index(vault)).notes[0]!;
  let note = await vault.read(item.path!);
  const read = vault.read.bind(vault); let reads = 0;
  vault.read = async (relative) => { reads++; return read(relative); };
  await writeFile(path.join(root, '无效编码.md'), Buffer.from([0xff, 0xfe]));
  note = await vault.save(note.path, note.source + '\n索引保存\n', note.revision);
  assert.equal(reads, 3, 'save only rereads the target at its existing protection checkpoints');
  await writeFile(path.join(root, '新外部副本.md'), note.source);
  await assert.rejects(vault.save(note.path, note.source + '\n不能写入\n', note.revision), /ID 重复/);
  assert.equal(await readFile(path.join(root, note.path), 'utf8'), note.source);
});


test('internal scans publish unrelated external changes on successful and failed save/copy/import', async (t) => {
  const { root, vault, importer, pack } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await importer.import(vault);
  const items = (await importer.index(vault)).notes; const a = items[0]!, b = items[1]!;
  let aNote = await vault.read(a.path!); let bSource = (await vault.read(b.path!)).source;
  const notices: string[][] = []; const stop = vault.watch(() => {}, (change) => notices.push(change.changed)); t.after(stop);
  async function externalB(label: string) { notices.length = 0; bSource += `\n${label}\n`; await writeFile(path.join(root, b.path!), bSource); }
  const sawB = () => assert.ok(notices.some((paths) => paths.includes(b.path!)), 'the internal scan must publish B before a later scan can consume it');
  await externalB('保存成功之前');
  aNote = await vault.save(aNote.path, aNote.source + '\n保存 A\n', aNote.revision); sawB();
  assert.ok(notices.some((paths) => paths.includes(a.path!)), 'successful self-write also publishes its changed path');
  await externalB('保存失败之前'); await writeFile(path.join(root, '重复 A.md'), aNote.source);
  await assert.rejects(vault.save(aNote.path, aNote.source + '\n不能覆盖\n', aNote.revision), /ID 重复/); sawB();
  await rm(path.join(root, '重复 A.md'));
  await externalB('复制失败之前');
  await assert.rejects(vault.copy(aNote.path, aNote.source, 'outdated', false), /磁盘文件已改变/); sawB();
  await externalB('重复导入成功之前'); await importer.import(vault); sawB();
  await externalB('重复导入失败之前');
  const receipt = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes/receipts/${a.id}.json`);
  await writeFile(receipt, 'invalid receipt');
  await assert.rejects(importer.import(vault), /导入记录无法读取/); sawB();
  stop(); notices.length = 0; await externalB('取消观察之后'); await vault.scan(); assert.deepEqual(notices, []);
});
