import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { backlinks, linkEntry } from './links.ts';
import { searchNotes, projectNotes } from './note-projection.ts';
import { Vault } from './vault.ts';

test('saved search covers names, complete body and only top-level tags; normalized AND terms', () => {
  const source = `---\ntags: [复习, CAFÉ, 12, {x: ignored}]\n其他属性: 不检索的属性值\n_textbook: {id: 隐藏身份, tags: [嵌套标签]}\n---\n# 有理数\n${'正文。'.repeat(100)}最后的关键词`;
  const entry = linkEntry('七年级/相反数.md', source);
  assert.deepEqual(entry.tags, ['复习', 'CAFÉ']);
  for (const query of ['七年级 相反数', '相反数 最后的关键词', '复习 café', 'CAFE\u0301']) assert.deepEqual(searchNotes([entry], query), [entry], query);
  for (const query of ['', '嵌套标签', '隐藏身份', '不检索的属性值', 'ignored', '不存在 复习']) assert.deepEqual(searchNotes([entry], query), [], query);
  assert.deepEqual(linkEntry('a.md', '---\ntags: 单个标签\n---\n正文').tags, ['单个标签']);
  const invalid = linkEntry('无效.md', '---\ntags: [\n秘密: 隐藏值\n---\n可读正文');
  assert.ok(invalid.problem);
  assert.equal(searchNotes([invalid], '隐藏值').length, 0);
  assert.equal(searchNotes([invalid], '可读正文').length, 1);
});

test('one node per path, all missing/duplicate IDs retained; links agree with backlinks', () => {
  const entries = [
    linkEntry('来源.md', '---\n属性: "[[甲/同名.md]]"\n_textbook: {id: 重复, anchors: [{textbook: a}, {textbook: b}]}\n---\n[[甲/同名.md]] [[甲/同名.md]] [[同名]] [[缺失]] [[../越界]] `[[伪]]`'),
    linkEntry('甲/同名.md', '---\n_textbook: {id: 重复}\n---\n[[来源]]'),
    linkEntry('乙/同名.md', '没有 ID 的正文'),
    linkEntry('只有定位.md', '---\n_textbook: {anchors: [{textbook: a, pdf_page: 20}]}\n---\n正文'),
  ];
  const graph = projectNotes(entries);
  assert.deepEqual(graph.nodes.map((node) => node.key), entries.map((entry) => entry.path));
  assert.deepEqual([...graph.conflicts], ['来源.md', '甲/同名.md']);
  assert.deepEqual(graph.edges, [
    { source: '来源.md', target: '甲/同名.md', kind: 'default' },
    { source: '甲/同名.md', target: '来源.md', kind: 'default' },
  ]);
  for (const target of entries) assert.deepEqual(graph.edges.filter((edge) => edge.target === target.path).map((edge) => edge.source).sort(), backlinks(target.path, entries).map(({ entry }) => entry.path).sort());
});

test('disk projection reuses untouched entries, changes body/tags/edges after save or external edit; rebuild writes nothing', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'note-projection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, '库'); await mkdir(root);
  const manual = '手动笔记，没有 ID';
  await writeFile(path.join(root, '手动.md'), manual);
  await writeFile(path.join(root, '来源.md'), '---\ntags: [旧标签]\n---\n初始正文 [[手动]]');
  const vault = await Vault.open(root, path.join(dir, '恢复'));
  const first = await vault.links();
  const note = await vault.read('来源.md');
  const draft = '---\ntags: [新标签]\n---\n新正文';
  assert.equal(searchNotes(first.entries, '新正文').length, 0, 'an editor draft is not a persisted entry');
  await vault.save('来源.md', draft, note.revision);
  const saved = await vault.links();
  assert.strictEqual(saved.entries.find((entry) => entry.path === '手动.md'), first.entries.find((entry) => entry.path === '手动.md'));
  assert.equal(searchNotes(saved.entries, '旧标签').length, 0);
  assert.equal(searchNotes(saved.entries, '新标签 新正文').length, 1);
  assert.equal(projectNotes(saved.entries).edges.length, 0);
  await writeFile(path.join(root, '来源.md'), '外改正文 [[手动]]');
  assert.equal(projectNotes((await vault.links()).entries).edges.length, 1);
  await rm(path.join(root, '手动.md'));
  const deleted = await vault.links();
  assert.equal(projectNotes(deleted.entries).nodes.length, 1);
  assert.equal(projectNotes(deleted.entries).edges.length, 0);
  const before = await readFile(path.join(root, '来源.md'), 'utf8');
  const rebuilt = await (await Vault.open(root, path.join(dir, '恢复'))).links();
  assert.deepEqual(rebuilt, deleted);
  assert.equal(await readFile(path.join(root, '来源.md'), 'utf8'), before);
  await writeFile(path.join(root, '手动.md'), manual);
  await vault.links();
  assert.equal(await readFile(path.join(root, '手动.md'), 'utf8'), manual);
});
