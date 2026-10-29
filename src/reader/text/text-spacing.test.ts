import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMath } from './math.ts';
import { spaceSegments, spacedText } from './text-spacing.ts';

const render = (text: string) => spaceSegments(splitMath(text))
  .map((segment) => segment.kind === 'text' ? segment.value : `⟨${segment.value}⟩`).join('');

test('汉字与拉丁字母、数字之间补空格', () => {
  assert.equal(spacedText('第88页'), '第 88 页');
  assert.equal(spacedText('cm乘cm'), 'cm 乘 cm');
  assert.equal(spacedText('取π值'), '取 π 值');
  // 已经写了空格的文本不再加宽，中文标点旁也不加。
  assert.equal(spacedText('面积 ab 的长方形'), '面积 ab 的长方形');
  assert.equal(spacedText('，ab。'), '，ab。');
});

test('行内公式与汉字之间补空格，标点旁不加', () => {
  assert.equal(render('取$b$作底，面积是$ab$。'), '取 ⟨b⟩ 作底，面积是 ⟨ab⟩。');
  assert.equal(render('$R$与$r$'), '⟨R⟩ 与 ⟨r⟩');
  assert.equal(render('所以，$b$是底'), '所以，⟨b⟩ 是底');
  // 段落以公式开头时只在公式后面补空格。
  assert.equal(render('$b$是底'), '⟨b⟩ 是底');
});

test('行间公式成块，不参与补空格', () => {
  assert.equal(render('面积$$ab$$'), '面积⟨ab⟩');
});
