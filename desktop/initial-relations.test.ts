import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialRelations, relationBody } from './initial-relations.ts';
import { originalHrefs, originalLink, originalTargets } from './original-links.ts';
import { loadInitialPackage, InitialNotes } from './initial-notes.ts';
import { packageVersion, type InitialPackage } from './initial-package.ts';
import { Vault } from './vault.ts';
import { noteReferences, linkEntry } from './links.ts';
import { projectNotes } from './note-projection.ts';
import type { Catalog } from './anchors.ts';
const project = path.resolve(import.meta.dirname, '..');
const fixed = await loadInitialPackage(project);
const catalog = JSON.parse(await readFile(path.join(project, 'resources/offline/grade-7-volume-1/catalog.json'), 'utf8')) as Catalog;

test('all 1241 source relations preserve exact target IDs, labels and purposes; 831 originals never become graph nodes', () => {
  const relations = initialRelations(fixed);
  const raw = fixed.source as { content: { supplements: { id: string; locationId: string; related: { locationId: string; label: string; purpose: string }[] }[] } };
  const paths = new Map(fixed.entries.map((entry, index) => [entry.sourceId, `实际/${index}（2）.md`]));
  let notes = 0, originals = 0;
  const indexed = fixed.entries.map((entry) => {
    const converted = relations.get(entry.sourceId)!;
    const source = raw.content.supplements.find((note) => note.id === entry.sourceId)!;
    assert.equal(converted.length, source.related.length);
    const body = entry.body + relationBody(converted, paths);
    for (const [at, relation] of converted.entries()) {
      const expected = source.related[at]!;
      assert.equal(relation.locationId, expected.locationId); assert.equal(relation.label, expected.label); assert.equal(relation.purpose, expected.purpose);
      assert.deepEqual(relation.targets, raw.content.supplements.filter((note) => note.locationId === expected.locationId).map((note) => note.id));
      assert.equal(relation.problem, undefined); assert.ok(body.includes(expected.purpose));
      if (relation.targets.length) { notes++; assert.ok(noteReferences(body).some((link) => link.target === paths.get(relation.targets[0]!))); }
      else { originals++; assert.ok(originalHrefs(body).includes(originalLink(relation.anchors))); assert.deepEqual(originalTargets(originalLink(relation.anchors), catalog), relation.anchors.map((anchor) => ({ textbook: anchor.textbook, page: anchor.pdf_page, rects: anchor.rects }))); }
    }
    return linkEntry(paths.get(entry.sourceId)!, body);
  });
  assert.deepEqual({ notes, originals, total: notes + originals }, { notes: 410, originals: 831, total: 1241 });
  const projection = projectNotes(indexed);
  assert.equal(projection.nodes.length, 971); assert.equal(projection.edges.length, 410);
});

test('only actual Markdown URL syntax retains an original target after source edits', () => {
  const href = originalLink([{ textbook: fixed.textbook, pdf_page: 9 }]);
  assert.deepEqual(originalHrefs(`[原文](${href})`), [href]);
  assert.deepEqual(originalHrefs(`[原文](<${href}>)`), [href]);
  assert.deepEqual(originalHrefs(`[原文][a]\n\n[a]: ${href}`), [href]);
  assert.deepEqual(originalHrefs(`原文 ${href}\n\n\`[原文](${href})\`\n\n![图片](${href})`), []);
});

test('original encoding preserves multiple pages/rects and rejects absent catalogs, wrong versions, invalid ranges and unverified locations', () => {
  const anchors = [{ textbook: fixed.textbook, pdf_page: 12, rects: [[.1, .2, .3, .1], [.1, .5, .3, .1]] }, { textbook: fixed.textbook, pdf_page: 13, rects: [[.2, .2, .5, .1]] }];
  assert.equal(originalTargets(originalLink(anchors), catalog).length, 2);
  const warnings: string[] = [];
  assert.equal(originalTargets(originalLink([{ ...anchors[0], chapter: 'unknown-chapter', section: 'unknown-section' }]), catalog, (items) => warnings.push(...items)).length, 1);
  assert.ok(warnings.some((item) => item.includes('章标识无效')));
  assert.equal(originalTargets(originalLink([{ ...anchors[0], chapter: 'unknown-chapter' }]), catalog)[0]!.page, 12);
  assert.throws(() => originalTargets(originalLink(anchors), null), /尚未下载/);
  for (const bad of [[], [{ ...anchors[0], textbook: 'wrong' }], [{ ...anchors[0], pdf_page: 0 }], [{ ...anchors[0], rects: [[.9, 0, .2, .1]] }]]) assert.throws(() => originalTargets(originalLink(bad), catalog));
  assert.throws(() => originalTargets('textbook:%invalid', catalog), /无法读取/);
  const broken = structuredClone(fixed); const source = broken.source as { locations: Record<string, { page: number }> }; source.locations['ch1-source-positive-negative']!.page = 0;
  const relation = initialRelations(broken).get('ch1-why-negative')!;
  assert.ok(relation[0]!.problem); assert.ok(!relationBody(relation, new Map()).includes('textbook:'));
});

async function interrupted(t: { after: (fn: () => Promise<void>) => void }, receipt: boolean) {
  const order = ['ch1-deviation', 'ch1-zero-reference'];
  const entries = order.map((id) => fixed.entries.find((entry) => entry.sourceId === id)!);
  const pack: InitialPackage = { ...fixed, entries, version: packageVersion({ source: fixed.source, entries }) };
  const root = await mkdtemp(path.join(os.tmpdir(), 'initial-relations-')); t.after(() => rm(root, { recursive: true, force: true }));
  const vault = await Vault.open(root, path.join(root, '.recoveries')); const importer = new InitialNotes(pack);
  const occupied = path.join(root, entries[0]!.path); await mkdir(path.dirname(occupied), { recursive: true }); await writeFile(occupied, '学生同名内容');
  importer.checkpoint = async () => { throw new Error('interrupted'); }; await assert.rejects(importer.import(vault), /interrupted/); importer.checkpoint = undefined;
  const base = path.join(root, `.textbook/textbooks/${pack.textbook}/initial-notes`);
  const plan = JSON.parse(await readFile(path.join(base, 'plan.json'), 'utf8')) as { notes: { id: string; path: string; sourceId: string }[] };
  if (receipt) { await mkdir(path.join(base, 'receipts'), { recursive: true }); await writeFile(path.join(base, `receipts/${plan.notes[0]!.id}.json`), JSON.stringify({ ...plan.notes[0], version: pack.version })); }
  return { root, vault, importer, entries, plan, base };
}

test('first creation uses suffix plan paths; retry follows moved identity and never links the replacement at its former path', async (t) => {
  const f = await interrupted(t, false); const first = f.plan.notes[0]!;
  assert.ok(first.path.includes('（2）'));
  const original = await readFile(path.join(f.root, first.path), 'utf8'); const moved = '学生改名.md';
  await rename(path.join(f.root, first.path), path.join(f.root, moved)); await writeFile(path.join(f.root, first.path), '无关占位');
  await f.importer.import(f.vault);
  const body = await readFile(path.join(f.root, f.plan.notes[1]!.path), 'utf8'); assert.equal(noteReferences(body)[0]!.target, moved);
  assert.equal(await readFile(path.join(f.root, moved), 'utf8'), original);
  assert.equal(await readFile(path.join(f.root, f.entries[0]!.path), 'utf8'), '学生同名内容');
});

test('receipted deleted target is not recreated or linked to its new occupant; existing legacy bodies remain untouched', async (t) => {
  const f = await interrupted(t, true); const first = f.plan.notes[0]!;
  await writeFile(path.join(f.root, first.path), '另一个学生文件');
  await f.importer.import(f.vault);
  let body = await readFile(path.join(f.root, f.plan.notes[1]!.path), 'utf8'); assert.ok(body.includes('目标笔记缺失')); assert.deepEqual(noteReferences(body), []);
  assert.equal(await readFile(path.join(f.root, first.path), 'utf8'), '另一个学生文件');
  body = '学生旧版正文，没有关联。'; await writeFile(path.join(f.root, f.plan.notes[1]!.path), body);
  assert.equal((await f.importer.import(f.vault)).created, 0); assert.equal(await readFile(path.join(f.root, f.plan.notes[1]!.path), 'utf8'), body);
});
