import type { Supplement } from '../textbook/supplements';

export const supplementTypes = {
  concept: '概念与性质', method: '方法与推理', question: '题目引导', review: '回顾与探究', personal: '我的补充',
};
export type SupplementType = keyof typeof supplementTypes;
export function supplementType(note: Supplement): SupplementType {
  if (note.questionGuide) return 'question';
  if (/定义概念|陈述性质/.test(note.learningRole)) return 'concept';
  if (/示范方法|推导或证明/.test(note.learningRole)) return 'method';
  return 'review';
}
export function TypeMarker({ type }: { type: SupplementType | 'group' }) {
  const paths = {
    concept: 'M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z',
    method: 'M4 6h12m-4-4 4 4-4 4M20 18H8m4-4-4 4 4 4',
    question: 'M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12h8M8 16h5',
    review: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
    personal: 'm4 16 12-12 4 4L8 20H4v-4ZM13 7l4 4',
    group: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]} /></svg>;
}
