import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Vault } from './vault.ts';
import { backlinks, linkEntry, linkPath, noteReferences, pathLink, replaceReference, resolveLink, wikiLinks } from './links.ts';

const entries = ['七年级/相反数.md', '八年级/相反数.md', '中文 空格.md', 'Case.md', 'case.md', '根.md', '目录/根.md'].map((path) => linkEntry(path, `${path} 的摘要`));
test('exact case, optional lowercase extension, explicit root path, NFC collision and safe path grammar', () => {
  assert.equal(resolveLink('相反数', entries).kind, 'ambiguous');
  assert.equal(resolveLink('七年级/相反数', entries).candidates[0]?.path, '七年级/相反数.md');
  assert.equal(resolveLink('中文 空格.md', entries).kind, 'resolved');
  assert.equal(resolveLink('Case', entries).candidates[0]?.path, 'Case.md');
  assert.equal(resolveLink('CASE', entries).kind, 'missing');
  assert.equal(resolveLink('根', entries).kind, 'ambiguous');
  assert.equal(resolveLink('根.md', entries).candidates[0]?.path, '根.md');
  const collision = ['café.md', 'cafe\u0301.md'].map((path) => linkEntry(path, ''));
  assert.equal(resolveLink('café', collision).kind, 'ambiguous');
  for (const target of ['../外部', '/绝对', 'C:/盘符', '目录/../外部', '.隐藏', 'CON', 'a\\b', 'a.md/..', 'a.MD', 'a/尾空格 ', 'a\u0000b']) {
    assert.equal(resolveLink(target, entries).kind, 'invalid', target);
    assert.throws(() => linkPath(target));
  }
  assert.equal(linkPath('百分%20号'), '百分%20号.md');
});

test('syntax exclusions and escapes are shared by index and rendering', () => {
  const text = String.raw`[[中文 空格|中文别名]] [[a\#b\^c\[d\].md|别名\|含竖线]]
\[[转义]] \\[[双斜线]] [[目标#标题]] [[目标^块]]
\`[[行内代码]]\`

~~~md
[[围栏代码]]
~~~

    [[缩进代码]]

[普通链接](https://example.com/[[伪引用]])

[普通链接 [[嵌套伪引用]]](https://example.com)

[引用链接 [[引用伪引用]]][ref]

[ref]: https://example.com

<!-- [[注释]] -->

> [!hint] 提示
> [[提示内链接]]

$ [[数学文字]] $ 与 $$ [[显示数学]] $$
` .replace(/\\`/g, '`');
  assert.deepEqual(wikiLinks(text).map((link) => link.target), ['中文 空格', 'a#b^c[d].md', '双斜线', '提示内链接']);
  const link = pathLink('目录/a#b^c[d].md', '别名|[甲]');
  assert.equal(wikiLinks(link)[0]?.target, '目录/a#b^c[d].md');
  assert.equal(wikiLinks(link)[0]?.alias, '别名|[甲]');
});

test('body and nested user property values, replacements and persistent backlink deduplication', () => {
  const source = '---\n# 保留\n指向: "[[相反数|别名]]"\n列表: ["[[中文 空格]]", 2]\n嵌套: {a: "[[根.md]]"}\n"[[属性名]]": ignored\n_textbook: {id: "[[内置信息]]", schema_version: 1}\n---\n[[相反数|别名]] 与 [[相反数|别名]]。\n';
  const refs = noteReferences(source);
  assert.equal(refs.length, 5);
  assert.deepEqual(refs.filter((ref) => ref.property).map((ref) => ref.property), [['指向'], ['列表', 0], ['嵌套', 'a']]);
  const fixed = replaceReference(source, refs.find((ref) => ref.property?.[0] === '指向')!, pathLink('七年级/相反数.md', '别名'));
  assert.ok(fixed.includes('# 保留'));
  assert.equal(noteReferences(fixed).find((ref) => ref.property?.[0] === '指向')?.target, '七年级/相反数.md');
  assert.equal(noteReferences(fixed).filter((ref) => !ref.property && ref.target === '相反数').length, 2);
  const fixedBody = replaceReference(fixed, noteReferences(fixed)[0]!, pathLink('七年级/相反数.md'));
  const all = [...entries, linkEntry('来源.md', fixedBody)];
  assert.equal(backlinks('七年级/相反数.md', all).length, 1);
  assert.equal(backlinks('七年级/相反数.md', all)[0]?.references.length, 2);
  assert.equal(backlinks('八年级/相反数.md', all).length, 0, 'ambiguous names never invent edges');
  assert.throws(() => replaceReference('changed', refs[0]!, '[[x]]'));
  assert.throws(() => replaceReference(source + '外部更新', refs[0]!, '[[x]]', source), /内容已改变/);
  const repeated = '[[相反数]] 之间 [[相反数]]';
  const second = noteReferences(repeated)[1]!;
  assert.equal(replaceReference(repeated, second, '[[七年级/相反数.md]]', repeated), '[[相反数]] 之间 [[七年级/相反数.md]]');
  const escapedThenPath = String.raw`\[[转义]]

[[a\#b\[d\].md|a\#b\[d\]]]`;
  assert.equal(noteReferences(escapedThenPath)[0]?.target, 'a#b[d].md');
  assert.deepEqual(noteReferences('---\n坏: [\n---\n[[根.md]]').map((ref) => ref.target), ['根.md']);
});

test('disk index rebuild, manual files without IDs, changes/deletion, unreadable and escape boundaries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'note-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = path.join(root, '库'); await mkdir(library);
  await writeFile(path.join(library, '来源.md'), '[[目标]] [[目标]]');
  await writeFile(path.join(library, '目标.md'), '手动正文，无 ID。');
  await writeFile(path.join(root, '外部.md'), '外部');
  await symlink(path.join(root, '外部.md'), path.join(library, '逃逸.md'));
  const vault = await Vault.open(library, path.join(root, '恢复'));
  const first = await vault.links();
  assert.equal(first.entries.length, 2);
  const unchanged = await vault.links();
  for (const entry of first.entries) assert.strictEqual(unchanged.entries.find((item) => item.path === entry.path), entry, 'unchanged content must reuse derived links');
  assert.equal(backlinks('目标.md', first.entries)[0]?.references.length, 2);
  await utimes(path.join(library, '目标.md'), new Date(), new Date(Date.now() + 1000));
  assert.strictEqual((await vault.links()).entries.find((entry) => entry.path === '目标.md'), first.entries.find((entry) => entry.path === '目标.md'), 'stamp-only changes retain revision-based links');
  await mkdir(path.join(library, '目录'));
  await writeFile(path.join(library, '目录/目标.md'), '同名候选');
  const ambiguous = await vault.links();
  assert.strictEqual(ambiguous.entries.find((entry) => entry.path === '来源.md'), first.entries.find((entry) => entry.path === '来源.md'));
  assert.equal(backlinks('目标.md', ambiguous.entries).length, 0, 'cached raw references must resolve against the current candidates');
  await rm(path.join(library, '目录/目标.md'));
  assert.equal(backlinks('目标.md', (await vault.links()).entries)[0]?.references.length, 2);
  assert.equal(await readFile(path.join(library, '目标.md'), 'utf8'), '手动正文，无 ID。');
  assert.equal((await vault.read('目标.md')).id, undefined);
  await assert.rejects(vault.read('../外部.md'));
  await assert.rejects(vault.read('逃逸.md'));
  await writeFile(path.join(library, '来源.md'), '移除引用');
  let notified: string[] = [];
  const modified = await vault.links((change) => { notified = change.changed; });
  assert.equal(backlinks('目标.md', modified.entries).length, 0);
  assert.strictEqual(modified.entries.find((entry) => entry.path === '目标.md'), first.entries.find((entry) => entry.path === '目标.md'));
  assert.notStrictEqual(modified.entries.find((entry) => entry.path === '来源.md'), first.entries.find((entry) => entry.path === '来源.md'));
  assert.ok(notified.includes('来源.md'), 'index refresh must not swallow watcher changes');
  await rm(path.join(library, '目标.md'));
  assert.equal(resolveLink('目标', (await vault.links()).entries).kind, 'missing');
  await writeFile(path.join(library, '目标.md'), '手动正文，无 ID。');
  assert.notStrictEqual((await vault.links()).entries.find((entry) => entry.path === '目标.md'), first.entries.find((entry) => entry.path === '目标.md'), 'deletion must discard the derived entry');
  await writeFile(path.join(library, '目标.md'), new Uint8Array([255]));
  assert.equal((await vault.links()).entries.some((entry) => entry.path === '目标.md'), false, 'unreadable content cannot retain stale links');
  await writeFile(path.join(library, '目标.md'), '[[来源]]');
  assert.equal(backlinks('来源.md', (await vault.links()).entries).length, 1);
  await writeFile(path.join(library, '新文件.md'), '[[来源]]');
  const rebuilt = await (await Vault.open(library, path.join(root, '恢复'))).links();
  assert.equal(resolveLink('新文件', rebuilt.entries).kind, 'resolved');
  assert.equal(backlinks('来源.md', rebuilt.entries).length, 2);
});
