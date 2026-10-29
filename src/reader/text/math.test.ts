import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMath, renderMath, splitMath } from './math.ts';

test('plain text stays a single segment', () => {
  assert.deepEqual(splitMath('底乘高再取一半'), [{ kind: 'text', value: '底乘高再取一半' }]);
});

test('inline and display formulas are split out', () => {
  assert.deepEqual(splitMath('面积是$\\frac{1}{2}ab$，代入即可'), [
    { kind: 'text', value: '面积是' },
    { kind: 'math', value: '\\frac{1}{2}ab', display: false },
    { kind: 'text', value: '，代入即可' },
  ]);
  assert.deepEqual(splitMath('$$S=\\pi r^2$$'), [{ kind: 'math', value: 'S=\\pi r^2', display: true }]);
  assert.deepEqual(splitMath('\\(a+b\\)与\\[h\\]'), [
    { kind: 'math', value: 'a+b', display: false },
    { kind: 'text', value: '与' },
    { kind: 'math', value: 'h', display: true },
  ]);
});

test('empty formulas keep their source text', () => {
  assert.deepEqual(splitMath('价格$5$'), [
    { kind: 'text', value: '价格' },
    { kind: 'math', value: '5', display: false },
  ]);
  assert.deepEqual(splitMath('$$$$'), [{ kind: 'text', value: '$$$$' }]);
});

test('tex renders to a standalone svg and is reused from cache', async () => {
  // 渲染器按需加载，未就绪时组件退化为源文本。
  assert.equal(renderMath('x'), null);
  await loadMath();
  const html = renderMath('S=\\frac{1}{2}ab-\\pi r^2');
  assert.ok(html?.includes('<mjx-container class="MathJax" jax="SVG"'));
  assert.ok(html?.includes('<svg'));
  assert.doesNotMatch(html!, /data-mjx-error|merror/, 'tex must parse without errors');
  assert.equal(renderMath('S=\\frac{1}{2}ab-\\pi r^2'), html);
  assert.ok(renderMath('\\mathrm{cm}^2', true)?.includes('display="true"'));
});
