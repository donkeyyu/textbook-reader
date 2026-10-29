import type { MathSegment } from './math';

// 汉字与拉丁字母、数字、希腊字母相邻时留出空隙，中文标点旁不留。
const LATIN = 'A-Za-z0-9\\u0370-\\u03ff';
const BOUNDARY = new RegExp(`(?<=\\p{Script=Han})(?=[${LATIN}])|(?<=[${LATIN}])(?=\\p{Script=Han})`, 'gu');
const HAN_END = /\p{Script=Han}$/u;
const HAN_START = /^\p{Script=Han}/u;

/** 画布等用不上 text-autospace 的文字：按同一规则补空格，已经留空的不会被再加宽。 */
export function spacedText(text: string): string {
  return text.replace(BOUNDARY, ' ');
}

/** 行内公式不参与 text-autospace，由正文在它与相邻汉字之间补一个空格。 */
export function spaceSegments(segments: MathSegment[]): MathSegment[] {
  const spaced = segments.map((segment) => ({ ...segment }));
  spaced.forEach((segment, index) => {
    if (segment.kind !== 'math' || segment.display) return;
    const before = spaced[index - 1];
    if (before?.kind === 'text' && HAN_END.test(before.value)) before.value += ' ';
    const after = spaced[index + 1];
    if (after?.kind === 'text' && HAN_START.test(after.value)) after.value = ` ${after.value}`;
  });
  return spaced;
}
