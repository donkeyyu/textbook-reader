import { noteReferences, wikiLinks } from './links.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callout, calloutPosition, markdownBlocks, protectMath, referenceDefinitions } from '../src/desktop/markdown-source.ts';

test('desktop formulas stay outside code and escaped dollars; TeX punctuation survives Markdown', () => {
  const source = '`price $` 后面 $x$，`$code$`，\\$5 与 $y$。\n\n```tex\n$literal$\n```\n\n$$\\frac{1}{2} + \\sqrt{4}$$\n\\(z\\) 与 \\[w\\]';
  const protectedSource = protectMath(source);
  assert.deepEqual([...protectedSource.formulas.values()], [
    { value: 'x', display: false }, { value: 'y', display: false },
    { value: '\\frac{1}{2} + \\sqrt{4}', display: true }, { value: 'z', display: false }, { value: 'w', display: true },
  ]);
  assert.ok(protectedSource.source.includes('`price $`'));
  assert.ok(protectedSource.source.includes('`$code$`'));
  assert.ok(protectedSource.source.includes('\\$5'));
  assert.ok(protectedSource.source.includes('```tex\n$literal$\n```'));
  const link = protectMath('[$x$](https://example.com/$path$)\n\n[ref]: https://example.com/$literal$');
  assert.deepEqual([...link.formulas.values()], [{ value: 'x', display: false }]);
  assert.ok(link.source.includes('https://example.com/$path$'));
  assert.ok(link.source.includes('[ref]: https://example.com/$literal$'));
  const escaped = protectMath('\\$not math\\$ and $x + \\$1$');
  assert.deepEqual([...escaped.formulas.values()], [{ value: 'x + \\$1', display: false }]);
});

test('desktop Markdown blocks retain exact source offsets and known/unknown callout fold syntax', () => {
  const source = '# Header\n\n> [!hint]- Think\n> Body\n\n> [!unknown]+ Keep\n> Unknown body';
  const blocks = markdownBlocks(source, 12);
  for (const block of blocks) assert.equal(source.slice(block.from - 12, block.to - 12), block.source);
  assert.deepEqual(callout(blocks[1]!.source), { type: 'hint', fold: '-', title: 'Think', body: 'Body' });
  assert.deepEqual(callout(blocks[2]!.source), { type: 'unknown', fold: '+', title: 'Keep', body: 'Unknown body' });
});


test('desktop reference definitions remain available across block rendering boundaries', () => {
  const source = '[说明][ref]\n\n> [!hint] 提示\n> [链接][ref]\n\n[ref]: https://example.com "说明"';
  const definitions = referenceDefinitions(source);
  assert.equal(definitions, '[ref]: https://example.com "说明"');
  assert.equal(markdownBlocks(source).at(-1)?.type, 'LinkReference');
});


test('rendered callout links map each duplicate to its exact original body offset', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = ['---', '属性: "[[同名]]"', '---', '[[同名]]', '', '> [!hint] 提示', '>第一行 [[同名]]', '> 第二行 [[同名]]'].join(newline);
    const offset = source.indexOf('[[同名]]', source.indexOf('---', 4) + 3);
    const block = markdownBlocks(source.slice(offset), offset).find((block) => block.type === 'Blockquote')!;
    const body = callout(block.source)!.body;
    const rendered = wikiLinks(body).map((reference) => ({
      ...reference, from: block.from + calloutPosition(block.source, reference.from), to: block.from + calloutPosition(block.source, reference.to),
    }));
    const expected = noteReferences(source).filter((reference) => !reference.property && reference.from >= block.from);
    assert.deepEqual(rendered, expected);
    assert.equal(rendered.length, 2);
    for (const reference of rendered) assert.equal(source.slice(reference.from, reference.to), reference.raw);
  }
});
