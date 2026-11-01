import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, chmod, stat, lstat, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Vault, digest } from './vault.ts';
import { NoteMoves, rewriteReferences } from './moves.ts';
import { parse, prepareSave } from './format.ts';
import { noteReferences, resolveLink } from './links.ts';

async function setup(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'note-moves-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = path.join(root, '笔记库'); await mkdir(library);
  await mkdir(path.join(library, '七年级')); await mkdir(path.join(library, '复习'));
  const recovery = path.join(root, 'recovery');
  const vault = await Vault.open(library, recovery);
  const moves = await NoteMoves.open(vault);
  const put = async (name: string, text = name) => {
    const source = prepareSave(null, text, '2020-01-01T00:00:00Z');
    await writeFile(path.join(library, name), source);
    return source;
  };
  return { root, library, recovery, vault, moves, put };
}

test('batch rewrite keeps every body/property alias, unknown YAML, CRLF and literal ranges', () => {
  const source = '\uFEFF---\r\n# 保留注释\r\n未知: {a: [true, 8], "[[键]]": value}\r\n相关: "[[原|甲]] 和 [[原|乙]] 与 [[其他]]"\r\n列表: ["[[原]] 与 [[原|丙]]", 8]\r\n_textbook: {schema_version: 1, id: id}\r\n---\r\n[[原|丁]]，[[原]]，`[[原]]`\r\n';
  const refs = noteReferences(source).filter((ref) => ref.target === '原');
  const changed = rewriteReferences(source, refs, '长目录/新中文笔记.md');
  assert.equal(noteReferences(changed).filter((ref) => ref.target === '长目录/新中文笔记.md').length, 6);
  assert.deepEqual(noteReferences(changed).filter((ref) => ref.target !== '其他').map((ref) => ref.alias), ['丁', undefined, '甲', '乙', undefined, '丙']);
  assert.ok(changed.includes('# 保留注释')); assert.ok(changed.includes('`[[原]]`'));
  assert.deepEqual(parse(changed).data.未知, parse(source).data.未知);
  assert.ok(changed.startsWith('\uFEFF')); assert.equal(changed.replace(/\r\n/g, '').includes('\n'), false);
  assert.throws(() => rewriteReferences(source + 'external', refs, '新.md', source), /改变/);
});

test('preview is read-only; Chinese rename/move preserves identity/time/source, rejects collisions and maintains only certain links', async (t) => {
  const { library, vault, moves, put } = await setup(t);
  const original = await put('七年级/相反数.md', '---\n_textbook:\n  ai_source: {source_id: stable-origin, version: "1"}\n---\n内容');
  await put('复习/相反数.md');
  const references = await put('引用.md', '---\n未知: {a: [1, true]}\n相关: "[[七年级/相反数|甲]] 和 [[七年级/相反数|乙]]"\n---\n[[相反数]] [[七年级/相反数|正文]] [[复习/相反数|另一本]]\n');
  await vault.scan();
  const note = await vault.read('七年级/相反数.md');
  await assert.rejects(moves.plan(note.path, '复习/相反数.md', note.revision), /存在/);
  await assert.rejects(moves.plan(note.path, '缺失目录/新.md', note.revision), /ENOENT/);
  const before = await stat(path.join(library, note.path));
  const plan = await moves.plan(note.path, '复习/有理数·相反数.md', note.revision);
  assert.equal(plan.edits.length, 1); assert.equal(plan.edits[0]?.count, 3);
  assert.equal(await readFile(path.join(library, '引用.md'), 'utf8'), references);
  const result = await moves.apply(plan.id);
  assert.equal(result.moved, true); assert.equal(result.error, undefined); assert.ok(result.edits.every((edit) => edit.done));
  assert.equal(await readFile(path.join(library, result.to), 'utf8'), original);
  assert.equal((await stat(path.join(library, result.to))).mtimeMs, before.mtimeMs);
  const changed = await readFile(path.join(library, '引用.md'), 'utf8');
  assert.ok(changed.includes('[[相反数]]')); assert.ok(changed.includes('[[复习/相反数|另一本]]'));
  assert.equal(noteReferences(changed).filter((ref) => ref.target === result.to).length, 3);
  assert.deepEqual(parse(changed).data.未知, { a: [1, true] });
  assert.notEqual(parse(changed).data._textbook.update_time, parse(references).data._textbook.update_time);
  assert.equal(parse(original).data._textbook.ai_source.source_id, 'stable-origin');
  assert.deepEqual((await moves.status()).notices, []);
});

test('partial failure never overwrites external content; retry writes only unfinished files with frozen times', async (t) => {
  const { library, vault, moves, put } = await setup(t);
  await put('目标.md'); const a = await put('甲.md', '[[目标|甲]] [[目标|乙]]');
  const b = await put('乙.md', '[[目标]]');
  await vault.scan();
  const target = await vault.read('目标.md'); const plan = await moves.plan(target.path, '复习/目标.md', target.revision);
  await writeFile(path.join(library, '乙.md'), b + '\nexternal change');
  const first = await moves.apply(plan.id);
  assert.equal(first.moved, true); assert.equal(first.edits.filter((edit) => edit.done).length, 1);
  assert.match(first.edits.find((edit) => edit.path === '乙.md')!.error!, /外改/);
  const savedA = await readFile(path.join(library, '甲.md'), 'utf8'); assert.notEqual(savedA, a);
  assert.equal(await readFile(path.join(library, '乙.md'), 'utf8'), b + '\nexternal change');
  await rm(path.join(library, '乙.md'));
  const missing = await moves.apply(plan.id);
  assert.match(missing.edits.find((edit) => edit.path === '乙.md')!.error!, /无可确认/);
  assert.equal(await lstat(path.join(library, '乙.md')).catch(() => null), null, 'ordinary deletion must not be recreated');
  await writeFile(path.join(library, '乙.md'), b);
  const reopened = await Vault.open(library, vault.recoveryDir); const retry = await NoteMoves.open(reopened);
  const last = await retry.apply(plan.id); assert.ok(last.edits.every((edit) => edit.done));
  assert.equal(await readFile(path.join(library, '甲.md'), 'utf8'), savedA);
  assert.equal(resolveLink('复习/目标.md', (await reopened.links()).entries).kind, 'resolved');
});

test('readonly reference can be retried and source/target races do not replace files', async (t) => {
  const { library, vault, moves, put } = await setup(t);
  const source = await put('目标.md'); await put('引用.md', '[[目标]]'); await vault.scan();
  const target = await vault.read('目标.md');
  const plan = await moves.plan(target.path, '复习/新.md', target.revision);
  await writeFile(path.join(library, plan.to), 'claimed after preview');
  assert.match((await moves.apply(plan.id)).error!, /存在/);
  assert.equal(await readFile(path.join(library, plan.to), 'utf8'), 'claimed after preview');
  assert.equal(await readFile(path.join(library, plan.from), 'utf8'), source);
  await rm(path.join(library, plan.to));
  if (process.platform !== 'win32') await chmod(path.join(library, '引用.md'), 0o400);
  const first = await moves.apply(plan.id);
  if (process.platform !== 'win32') {
    assert.equal(first.edits[0]?.done, false); assert.match(first.edits[0]!.error!, /只读/);
    await chmod(path.join(library, '引用.md'), 0o600);
  }
  assert.ok((await moves.apply(plan.id)).edits.every((edit) => edit.done));
});

test('external rename needs unique historical identity and unchanged content; scanning never rewrites references', async (t) => {
  const { library, vault, moves, put } = await setup(t);
  await put('目标.md'); const refs = await put('引用.md', '[[目标|别名]] [[目标]]'); await vault.scan();
  await rename(path.join(library, '目标.md'), path.join(library, '复习/外部中文.md'));
  const status = await moves.status(); assert.equal(status.notices.length, 1); assert.equal(status.notices[0]?.problem, undefined);
  assert.equal(await readFile(path.join(library, '引用.md'), 'utf8'), refs);
  const plan = await moves.planRepair(status.notices[0]!.id); assert.equal(plan.edits[0]?.count, 2);
  assert.equal((await moves.status()).notices.length, 1, 'cancelled preview must leave the repair entry available');
  assert.equal(await readFile(path.join(library, '引用.md'), 'utf8'), refs);
  assert.ok((await moves.apply(plan.id)).edits.every((edit) => edit.done));
  const emptyHistoryVault = await Vault.open(library, path.join(library, '..', 'new-cache'));
  const empty = await NoteMoves.open(emptyHistoryVault);
  assert.deepEqual((await empty.status()).notices, []);
});

test('source changes and late duplicate IDs stop before moving; self references update content time; reopening loses scan history', async (t) => {
  const { library, recovery, vault, moves, put } = await setup(t);
  const original = await put('原.md', '---\n相关: "[[原|自己]] [[原|再次]]"\n---\n[[原|正文自己]]'); await vault.scan();
  const note = await vault.read('原.md');
  const plan = await moves.plan(note.path, '新.md', note.revision);
  await writeFile(path.join(library, note.path), original + 'external');
  assert.match((await moves.apply(plan.id)).error!, /外改/);
  await writeFile(path.join(library, note.path), original);
  await writeFile(path.join(library, '副本.md'), original);
  assert.match((await moves.apply(plan.id)).error!, /ID 冲突/);
  assert.ok((await vault.list()).includes('原.md'));
  await rm(path.join(library, '副本.md'));
  const done = await moves.apply(plan.id); assert.equal(done.error, undefined); assert.ok(done.edits.every((edit) => edit.done));
  const changed = await readFile(path.join(library, '新.md'), 'utf8');
  assert.equal(noteReferences(changed).filter((ref) => ref.target === '新.md').length, 3);
  assert.equal(parse(changed).data._textbook.create_time, parse(original).data._textbook.create_time);
  assert.notEqual(parse(changed).data._textbook.update_time, parse(original).data._textbook.update_time);
  await rename(path.join(library, '新.md'), path.join(library, '复习/外部.md'));
  const reopened = await NoteMoves.open(await Vault.open(library, recovery));
  assert.deepEqual((await reopened.status()).notices, [], 'scan history is memory-only, even with the same recovery directory');
});

test('duplicate IDs, simultaneous external changes and uncertain old links never claim or rewrite a target', async (t) => {
  const { library, vault, moves, put } = await setup(t);
  const original = await put('目标.md'); const refs = await put('引用.md', '[[目标]]'); await vault.scan();
  await rename(path.join(library, '目标.md'), path.join(library, '七年级/目标.md'));
  await writeFile(path.join(library, '复习/目标.md'), original);
  const status = await moves.status(); assert.match(status.notices[0]!.problem!, /ID 冲突/);
  await assert.rejects(moves.planRepair(status.notices[0]!.id), /ID 冲突/);
  const note = await vault.read('七年级/目标.md');
  await assert.rejects(moves.plan(note.path, '新.md', note.revision), /ID 冲突/);
  assert.equal(await readFile(path.join(library, '引用.md'), 'utf8'), refs);
  await rm(path.join(library, '复习/目标.md')); await vault.scan();
  await rename(path.join(library, '七年级/目标.md'), path.join(library, '复习/改名.md'));
  await writeFile(path.join(library, '复习/改名.md'), original + '\nexternal');
  const conflict = (await moves.status()).notices.find((notice) => notice.from === '七年级/目标.md');
  assert.match(conflict!.problem!, /内容同时改变/);
  assert.equal(await readFile(path.join(library, '引用.md'), 'utf8'), refs);
});

test('real process exit at capture/link/write checkpoints resumes from journal without duplicate writes', async (t) => {
  const { root, library, recovery, put } = await setup(t);
  for (const stage of ['captured', 'linked', 'written', 'reference-displaced']) {
    await put(`${stage}.md`); await put(`${stage}-引用.md`, `[[${stage}|别名]]`);
    const vault = await Vault.open(library, recovery); const moves = await NoteMoves.open(vault); await vault.scan();
    const target = await vault.read(`${stage}.md`); const plan = await moves.plan(target.path, `复习/${stage}.md`, target.revision);
    // Only confirmation writes the journal, before any file mutation.
    moves.checkpoint = async (at) => { if (at === 'journaled') throw new Error('stop after confirmation'); };
    await assert.rejects(moves.apply(plan.id), /confirmation/);
    const script = path.join(root, `${stage}.mts`);
    await writeFile(script, `import {Vault} from ${JSON.stringify(new URL('./vault.ts', import.meta.url).href)};\nimport {NoteMoves} from ${JSON.stringify(new URL('./moves.ts', import.meta.url).href)};\nconst vault=await Vault.open(${JSON.stringify(library)},${JSON.stringify(recovery)});const moves=await NoteMoves.open(vault);vault.moveCheckpoint=async(stage)=>{if(stage===${JSON.stringify(stage)})process.exit(42)};moves.checkpoint=async(stage)=>{if(stage===${JSON.stringify(stage)})process.exit(42)};vault.writeCheckpoint=async(at)=>{if(${JSON.stringify(stage)}==='reference-displaced'&&at==='displaced')process.exit(42)};await moves.apply(${JSON.stringify(plan.id)});`);
    const killed = spawnSync(process.execPath, ['--experimental-strip-types', script], { encoding: 'utf8' });
    assert.equal(killed.status, 42, killed.stderr);
    const fresh = await Vault.open(library, recovery); const resumed = await NoteMoves.open(fresh);
    if (stage === 'reference-displaced') {
      fresh.writeCheckpoint = async (at) => { if (at === 'prepared') await writeFile(path.join(library, `${stage}-引用.md`), 'claimed during recovery'); };
      const failed = await resumed.apply(plan.id);
      assert.equal(failed.edits[0]?.done, false);
      assert.equal(await readFile(path.join(library, `${stage}-引用.md`), 'utf8'), 'claimed during recovery');
      assert.equal((await fresh.list()).some((name) => name.includes('（2）')), false, 'recovery must not silently create a suffixed reference file');
      fresh.writeCheckpoint = undefined;
      await rm(path.join(library, `${stage}-引用.md`));
    }
    const result = await resumed.apply(plan.id); assert.equal(result.error, undefined, stage); assert.ok(result.edits.every((edit) => edit.done), JSON.stringify(result));
    assert.equal((await fresh.read(plan.to)).id, target.id);
    const beforeRetry = await readFile(path.join(library, `${stage}-引用.md`), 'utf8');
    await resumed.apply(plan.id);
    assert.equal(await readFile(path.join(library, `${stage}-引用.md`), 'utf8'), beforeRetry);
  }
});

test('a replaced hidden capture symlink or outside hardlink is never restored into the vault', async (t) => {
  const { root, library, vault, moves, put } = await setup(t);
  for (const kind of ['symlink', 'hardlink']) {
    const original = await put(`${kind}.md`); await vault.scan();
    const target = await vault.read(`${kind}.md`); const plan = await moves.plan(target.path, `复习/${kind}.md`, target.revision);
    const outside = path.join(root, `${kind}-outside.md`); await writeFile(outside, 'outside private content');
    const captured = path.join(library, `.textbook-move-${plan.id}.tmp`);
    vault.moveCheckpoint = async (stage) => {
      if (stage !== 'captured') return;
      await rm(captured);
      if (kind === 'symlink') await symlink(outside, captured); else await link(outside, captured);
    };
    const result = await moves.apply(plan.id);
    assert.equal(result.moved, false); assert.ok(result.error);
    assert.equal(await lstat(path.join(library, plan.from)).catch(() => null), null);
    assert.equal(await lstat(path.join(library, plan.to)).catch(() => null), null);
    assert.equal(await readFile(outside, 'utf8'), 'outside private content');
    const journal = JSON.parse(await readFile(path.join(vault.recoveryDir, digest(vault.root), 'moves', `${plan.id}.json`), 'utf8'));
    assert.equal(journal.original, original, 'journal keeps the original after an unowned hidden file replaces it');
    assert.equal(moves.recoveries().find((record) => record.path === plan.from)!.candidate, original);
    await rm(captured);
  }
});
