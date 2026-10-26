import { closeCompletion, pickedCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { ContentNode, NodeRef } from '../../textbook/content.ts';
import type { ChapterRef, SectionRef } from '../../textbook/sections.ts';
import { linkQuery, sameTarget, type LinkBinding } from './document.ts';
import { bindLink } from './state.ts';

type Candidate = { node: ContentNode; label: string; detail: string };
export type LinkCatalog = { bookId: string; nodes: readonly ContentNode[]; chapters: readonly ChapterRef[]; sections: readonly SectionRef[] };
export type LinkRequest = { view: EditorView; from: number; to: number; query: string };
const searchable = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();

export function linkCandidates(catalog: LinkCatalog, query: string): Candidate[] {
  const needle = searchable(query);
  return catalog.nodes.filter((node) => node.bookId === catalog.bookId && searchable(node.title).includes(needle))
    .map((node) => ({ node, label: node.title, detail: [
      catalog.chapters.find(({ id }) => id === node.chapterId)?.title ?? '未归属章节',
      catalog.sections.find(({ id }) => id === node.sectionId)?.title ?? '未归属节',
      node.location ? `文件第 ${node.location.page} 页` : '无原文位置',
      node.summary.replace(/\s+/g, ' ').slice(0, 100),
    ].filter(Boolean).join(' · ') }))
    .map((item, _index, all) => all.some((other) => other !== item && other.label === item.label && other.detail === item.detail)
      ? { ...item, detail: `${item.detail} · ${item.node.source}:${item.node.id}` } : item);
}

export function resolveLink(binding: LinkBinding, nodes: readonly ContentNode[]): ContentNode | undefined {
  return nodes.find((node) => sameTarget(binding.target, node));
}

/** One source serves both editors; each option closes over its exact NodeRef. */
export function nodeLinkCompletions(getCatalog: () => LinkCatalog,
  onCreate: (request: LinkRequest) => void): CompletionSource {
  return (context) => {
    const range = linkQuery(context.state.doc.toString(), context.pos);
    if (!range) return null;
    const candidates = linkCandidates(getCatalog(), range.query);
    return { from: range.from + 2, to: range.to, filter: false, options: [
      ...candidates.map(({ node, label, detail }) => ({ label, detail, type: 'text',
        apply(view: EditorView, completion: Completion, from: number, to: number) {
          const current = completionRange(view, from, to);
          if (!current) return;
          const target: NodeRef = { bookId: node.bookId, source: node.source, id: node.id };
          view.dispatch(bindLink(view.state, current, target, node.title), { annotations: pickedCompletion.of(completion) });
        } })),
      ...(!candidates.length && range.query.trim() ? [{ label: `创建“${range.query}”`, detail: '新建我的补充，保存后链接',
        apply(view: EditorView, _completion: Completion, from: number, to: number) {
          const current = completionRange(view, from, to);
          if (!current) return;
          closeCompletion(view);
          onCreate({ view, ...current });
        } }] : []),
    ] };
  };
}

function completionRange(view: EditorView, from: number, to: number) {
  const markdown = view.state.doc.toString();
  const cursor = markdown.slice(to - 2, to) === ']]' ? to - 2 : to;
  const current = linkQuery(markdown, cursor);
  return current?.from === from - 2 && current.to === to ? current : null;
}
