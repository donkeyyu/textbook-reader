import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CustomCatalog, withCustom } from './custom-catalog.ts';
import { Vault } from './vault.ts';
import { readAnchors, resolveAnchor, type Catalog } from './anchors.ts';
import { parse } from './format.ts';
import { validateCatalog } from './textbooks.ts';
const catalog = JSON.parse(await readFile(new URL('../resources/offline/grade-7-volume-1/catalog.json', import.meta.url), 'utf8')) as Catalog;
const source = (anchors: unknown[], version = 1) => `---\n# retained\ncustom: [原值]\n_textbook:\n  schema_version: ${version}\n  create_time: "2026-10-01T00:00:00Z"\n  anchors: ${JSON.stringify(anchors)}\n---\n正文与 [[链接]]。\n`;
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'custom-catalog-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'vault'); await mkdir(root);
  const vault = await Vault.open(root, path.join(temporary, 'recovery'));
  const manager = await CustomCatalog.open(vault, catalog.textbookId);
  const file = path.join(root, `.textbook/textbooks/${catalog.textbookId}/custom.json`);
  return { temporary, root, vault, manager, file };
}
async function add(manager: CustomCatalog, title = '复习章', kind: 'chapter' | 'section' = 'chapter', chapterId?: string) {
  return manager.save(catalog, (await manager.read(catalog)).revision, { kind, title, chapterId });
}
test('stable shared custom entries, same-parent reuse covers index and custom; unknown JSON survives rename', async (t) => {
  const { manager, file, vault, root } = await fixture(t);
  const chapter = await add(manager), section = await add(manager, '复习节', 'section', chapter.entry.id);
  assert.equal((await add(manager)).entry.id, chapter.entry.id);
  assert.equal((await add(manager, catalog.chapters[0]!.title)).entry.id, catalog.chapters[0]!.id);
  const indexSection = catalog.sections[0]!;
  assert.equal((await add(manager, indexSection.title, 'section', indexSection.chapterId)).entry.id, indexSection.id);
  assert.equal((await add(manager, '复习节', 'section', indexSection.chapterId)).reused, false);
  const raw = JSON.parse(await readFile(file, 'utf8')); raw.extension = { keep: true }; raw.chapters[0].extra = 'keep'; await writeFile(file, JSON.stringify(raw));
  const current = await manager.read(catalog);
  const renamed = await manager.save(catalog, current.revision, { kind: 'chapter', id: chapter.entry.id, title: '改名章' });
  assert.equal(renamed.entry.id, chapter.entry.id); assert.equal(renamed.view.data.extension && renamed.view.data.chapters[0]!.extra, 'keep');
  const reopened = await CustomCatalog.open(vault, catalog.textbookId), merged = withCustom(catalog, await reopened.read(catalog));
  const anchor = { textbook: catalog.textbookId, chapter: chapter.entry.id, section: section.entry.id, pdf_page: 20, rects: [[.1, .2, .3, .1]] };
  assert.equal(resolveAnchor(anchor, merged).chapter?.title, '改名章'); assert.equal(resolveAnchor(anchor, merged).target?.page, 20);
  assert.equal(merged.chapters.find((entry) => entry.id === chapter.entry.id)!.start, undefined);
  const otherRoot = path.join(root, 'other-vault'); await mkdir(otherRoot);
  assert.equal((await (await CustomCatalog.open(await Vault.open(otherRoot, vault.recoveryDir), catalog.textbookId)).read(catalog)).data.chapters.length, 0);
  const otherBook = await CustomCatalog.open(vault, 'a'.repeat(64)); assert.equal((await otherBook.read({ ...catalog, textbookId: 'a'.repeat(64) })).data.chapters.length, 0);
  const otherCatalog = { ...catalog, textbookId: 'a'.repeat(64) };
  const otherChapter = await otherBook.save(otherCatalog, null, { kind: 'chapter', title: '另一教材章' });
  const otherPlan = await otherBook.plan(otherCatalog, otherChapter.view.revision, 'chapter', otherChapter.entry.id, null);
  otherBook.checkpoint = async () => { throw new Error('stopped'); };
  await assert.rejects(otherBook.apply(otherCatalog, otherPlan.id), /stopped/);
  assert.equal((await CustomCatalog.open(vault, catalog.textbookId)).status().length, 0);
  assert.equal((await CustomCatalog.open(vault, otherCatalog.textbookId)).status().length, 1);
});
test('custom external changes and invalid/newer files remain intact', async (t) => {
  const { manager, file } = await fixture(t); const original = await add(manager);
  const external = `${JSON.stringify({ ...original.view.data, extension: 'outside' })}\n`; await writeFile(file, external);
  await assert.rejects(manager.save(catalog, original.view.revision, { kind: 'chapter', title: '不得覆盖' }), /外改/); assert.equal(await readFile(file, 'utf8'), external);
  for (const raw of ['{broken', JSON.stringify({ ...original.view.data, schemaVersion: 2 }), JSON.stringify({ ...original.view.data, textbookId: 'other' })]) {
    await writeFile(file, raw); assert.equal((await manager.read(catalog)).readOnly, true);
    await assert.rejects(add(manager)); assert.equal(await readFile(file, 'utf8'), raw);
  }
});
test('custom write captures original inode; replacements are never restored or followed', async (t) => {
  for (const kind of ['ordinary', 'symlink', 'hardlink']) {
    const { manager, file, root } = await fixture(t); const original = await add(manager);
    const outside = path.join(root, 'outside.txt'); await writeFile(outside, 'outside');
    manager.writeCheckpoint = async (stage) => {
      if (stage !== 'displaced') return;
      const previous = path.join(path.dirname(file), (await readdir(path.dirname(file))).find((name) => name.endsWith('.previous'))!);
      await rm(previous);
      if (kind === 'ordinary') await writeFile(previous, 'substitute');
      else if (kind === 'symlink') await symlink(outside, previous);
      else await link(outside, previous);
    };
    await assert.rejects(manager.save(catalog, original.view.revision, { kind: 'chapter', title: 'new' }), /替换|普通/);
    await assert.rejects(readFile(file), /ENOENT/); assert.equal(await readFile(outside, 'utf8'), 'outside');
    assert.equal((await manager.read(catalog)).readOnly, true);
  }
});
test('cancel is read-only; delete counts references, removes child ownership, retains pages/regions/unknown fields and times', async (t) => {
  const { manager, vault, file } = await fixture(t), chapter = await add(manager), section = await add(manager, '节', 'section', chapter.entry.id);
  const anchor = { textbook: catalog.textbookId, chapter: chapter.entry.id, section: section.entry.id, pdf_page: 20, rects: [[.1, .2, .3, .1]], unknown: { keep: true } };
  const a = await vault.save('甲.md', source([anchor, anchor]), null), b = await vault.save('乙.md', source([anchor]), null);
  const customBefore = await readFile(file, 'utf8');
  const plan = await manager.plan(catalog, section.view.revision, 'chapter', chapter.entry.id, null);
  assert.equal(plan.edits.length, 2); assert.equal(plan.edits.reduce((sum, edit) => sum + edit.count, 0), 3);
  assert.equal((await vault.read('甲.md')).source, a.source); assert.equal(await readFile(file, 'utf8'), customBefore);
  const result = await manager.apply(catalog, plan.id); assert.equal(result.removed, true);
  for (const original of [a, b]) {
    const saved = await vault.read(original.path), parsed = parse(saved.source);
    assert.equal(saved.id, original.id); assert.equal(parsed.data._textbook.create_time, parse(original.source).data._textbook.create_time);
    for (const item of readAnchors(saved.source) as Record<string, unknown>[]) { assert.deepEqual(item, { textbook: catalog.textbookId, pdf_page: 20, rects: anchor.rects, unknown: anchor.unknown }); }
    assert.equal(parsed.body, parse(original.source).body); assert.ok(saved.source.includes('# retained'));
  }
  assert.equal((await manager.read(catalog)).data.sections.length, 0);
});
test('replacement section uses explicit parent and keeps raw page chain; delete parent moves no region', async (t) => {
  const { manager, vault } = await fixture(t), chapter = await add(manager), section = await add(manager, '节', 'section', chapter.entry.id);
  const anchor = { textbook: catalog.textbookId, chapter: chapter.entry.id, section: section.entry.id, pdf_page: 20, rects: [[.1, .2, .3, .1]] };
  await vault.save('甲.md', source([anchor]), null);
  const replacement = catalog.sections[0]!;
  const plan = await manager.plan(catalog, section.view.revision, 'section', section.entry.id, replacement.id);
  assert.equal((await manager.apply(catalog, plan.id)).removed, true);
  assert.deepEqual(readAnchors((await vault.read('甲.md')).source), [{ ...anchor, chapter: replacement.chapterId, section: replacement.id }]);
});
test('partial failure, newer note and added reference retain directory; restart retries frozen timestamp and identity safely', async (t) => {
  const { manager, vault, root, file } = await fixture(t), chapter = await add(manager);
  const anchor = { textbook: catalog.textbookId, chapter: chapter.entry.id, pdf_page: 20, rects: [[.1, .2, .3, .1]] };
  await vault.save('甲.md', source([anchor]), null); const b = await vault.save('乙.md', source([anchor]), null);
  const plan = await manager.plan(catalog, chapter.view.revision, 'chapter', chapter.entry.id, null);
  await writeFile(path.join(root, '乙.md'), b.source + 'external');
  const result = await manager.apply(catalog, plan.id);
  assert.equal(result.removed, false); assert.equal(result.edits.filter((edit) => edit.done).length, 1); assert.match(result.edits.find((edit) => edit.path === '乙.md')!.error!, /外改/);
  assert.equal((await manager.read(catalog)).data.chapters.length, 1);
  const aAfter = await vault.read('甲.md');
  await writeFile(path.join(root, '乙.md'), b.source);
  const reopened = await CustomCatalog.open(vault, catalog.textbookId); assert.equal(reopened.status().length, 1);
  assert.equal((await reopened.apply(catalog, plan.id)).removed, true); assert.equal((await vault.read('甲.md')).source, aAfter.source);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).chapters.length, 0);
});
test('newer/invalid notes and new references cannot silently escape a deletion preview', async (t) => {
  const { manager, vault, root } = await fixture(t), chapter = await add(manager);
  const anchor = { textbook: catalog.textbookId, chapter: chapter.entry.id, pdf_page: 20 };
  await writeFile(path.join(root, 'newer.md'), source([anchor], 2)); await writeFile(path.join(root, 'broken.md'), '---\nbad: [\n---\n');
  const preview = await manager.plan(catalog, chapter.view.revision, 'chapter', chapter.entry.id, null);
  assert.equal(preview.edits.length, 1); assert.equal(preview.problems.length, 1);
  const result = await manager.apply(catalog, preview.id); assert.equal(result.removed, false); assert.equal(result.edits[0]!.done, false);
  await rm(path.join(root, 'newer.md')); await rm(path.join(root, 'broken.md'));
  const cleanPreview = await manager.plan(catalog, chapter.view.revision, 'chapter', chapter.entry.id, null);
  await vault.save('新增.md', source([anchor]), null);
  assert.equal((await manager.apply(catalog, cleanPreview.id)).removed, false);
});
test('interrupted prepared write resumes from actual journal without regenerating identity or time', async (t) => {
  const { manager, vault } = await fixture(t), chapter = await add(manager);
  await vault.save('甲.md', source([{ textbook: catalog.textbookId, chapter: chapter.entry.id, pdf_page: 20 }]), null);
  const plan = await manager.plan(catalog, chapter.view.revision, 'chapter', chapter.entry.id, null);
  manager.checkpoint = async (stage) => { if (stage === 'written') throw new Error('stopped'); };
  const partial = await manager.apply(catalog, plan.id); assert.equal(partial.removed, false);
  const persisted = await vault.read('甲.md');
  const reopened = await CustomCatalog.open(vault, catalog.textbookId);
  assert.equal((await reopened.apply(catalog, plan.id)).removed, true); assert.equal((await vault.read('甲.md')).source, persisted.source);
});
test('catalog reorder/removal resolves stable IDs and keeps stale anchor and custom data repairable', async (t) => {
  const { manager } = await fixture(t), custom = await add(manager);
  const updated = structuredClone(catalog); updated.chapters.reverse(); updated.sections = updated.sections.filter((entry) => entry.id !== catalog.sections[0]!.id);
  validateCatalog(updated);
  const merged = withCustom(updated, await manager.read(updated));
  const anchor = { textbook: catalog.textbookId, chapter: catalog.sections[0]!.chapterId, section: catalog.sections[0]!.id, pdf_page: 20 };
  assert.equal(resolveAnchor(anchor, merged).chapter?.id, anchor.chapter); assert.equal(resolveAnchor(anchor, merged).section, undefined);
  assert.equal(resolveAnchor(anchor, merged).target?.page, 20); assert.equal(merged.chapters.find((entry) => entry.id === custom.entry.id)!.title, '复习章');
  assert.deepEqual(anchor, { textbook: catalog.textbookId, chapter: catalog.sections[0]!.chapterId, section: catalog.sections[0]!.id, pdf_page: 20 });
});
test('final custom installation before journal completion closes only against frozen expected bytes', async (t) => {
  const { manager, vault, file } = await fixture(t), chapter = await add(manager);
  const preview = await manager.plan(catalog, chapter.view.revision, 'chapter', chapter.entry.id, null);
  manager.writeCheckpoint = async (stage) => { if (stage === 'installed') throw new Error('stop after install'); };
  assert.equal((await manager.apply(catalog, preview.id)).removed, false);
  const installed = await readFile(file, 'utf8');
  assert.equal(JSON.parse(installed).chapters.length, 0);
  const reopened = await CustomCatalog.open(vault, catalog.textbookId);
  assert.equal((await reopened.apply(catalog, preview.id)).removed, true); assert.equal(await readFile(file, 'utf8'), installed);
  const next = await add(reopened, '另一个章');
  const second = await reopened.plan(catalog, next.view.revision, 'chapter', next.entry.id, null);
  reopened.writeCheckpoint = async (stage) => { if (stage === 'installed') throw new Error('stop'); };
  await reopened.apply(catalog, second.id);
  const external = JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), unknownExternal: true }); await writeFile(file, external);
  assert.equal((await (await CustomCatalog.open(vault, catalog.textbookId)).apply(catalog, second.id)).removed, false);
  assert.equal(await readFile(file, 'utf8'), external);
});
test('custom write refuses check/install races and retains concurrent winner bytes', async (t) => {
  for (const stage of ['checked', 'installed'] as const) {
    const { manager, file } = await fixture(t), initial = await add(manager);
    const external = `${JSON.stringify({ ...initial.view.data, outside: stage })}\n`;
    manager.writeCheckpoint = async (at) => { if (at === stage) await writeFile(file, external); };
    await assert.rejects(manager.save(catalog, initial.view.revision, { kind: 'chapter', title: '新增' }), /外改/);
    assert.equal(await readFile(file, 'utf8'), external);
  }
});
test('a catalog update removing the chosen replacement stops deletion before rewriting notes', async (t) => {
  const { manager, vault } = await fixture(t), chapter = await add(manager);
  const note = await vault.save('甲.md', source([{ textbook: catalog.textbookId, chapter: chapter.entry.id, pdf_page: 20 }]), null);
  const target = catalog.chapters[0]!;
  const preview = await manager.plan(catalog, chapter.view.revision, 'chapter', chapter.entry.id, target.id);
  const updated = { ...catalog, chapters: catalog.chapters.filter((entry) => entry.id !== target.id), sections: catalog.sections.filter((entry) => entry.chapterId !== target.id) };
  const result = await manager.apply(updated, preview.id);
  assert.equal(result.removed, false); assert.match(result.error!, /替代目录/); assert.equal((await vault.read('甲.md')).source, note.source);
});
