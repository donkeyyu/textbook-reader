import ReactMarkdown from 'react-markdown';
import type { NodeRef } from '../../textbook/content.ts';
import { nodeKey } from '../../textbook/content.ts';
import { resolveLink, type LinkCatalog } from './candidates.ts';
import { matchingBindings, type LinkBinding } from './document.ts';

export type LinkContext = LinkCatalog & {
  chapterId: string | null;
  onNavigate: (target: NodeRef) => void;
  onCreate: (item: import('../../content/personal.ts').PersonalSupplement) => Promise<NodeRef>;
};

export function LinkContent({ markdown, bindings = [], links }: {
  markdown: string; bindings?: readonly LinkBinding[]; links?: LinkContext;
}) {
  const bound = matchingBindings(markdown, bindings);
  const generated = new Map<string, { from: number; to: number }>();
  let rendered = '';
  let offset = 0;
  for (const binding of [...bound].sort((a, b) => a.from - b.from)) {
    const label = `[[${binding.label}]]`.replace(/[\\`*_[\]<>]/g, '\\$&');
    rendered += markdown.slice(offset, binding.from);
    const from = rendered.length;
    rendered += `[${label}](#reader-link-${binding.id})`;
    generated.set(binding.id, { from, to: rendered.length });
    offset = binding.to;
  }
  rendered += markdown.slice(offset);
  return <div className="markdown-content"><ReactMarkdown components={{ a({ href, children, node }) {
    const binding = bound.find(({ id }) => href === `#reader-link-${id}`);
    const range = binding && generated.get(binding.id);
    if (!binding || !links || node?.position?.start.offset !== range?.from || node?.position?.end.offset !== range?.to) return <a href={href}>{children}</a>;
    const target = resolveLink(binding, links.nodes);
    return target ? <button className="node-link" type="button" data-link-id={binding.id} data-node-key={nodeKey(binding.target)}
      title={target.title} onClick={() => links.onNavigate(binding.target)}>[[{binding.label}]]</button>
      : <span className="node-link-invalid" data-link-id={binding.id} title="目标已删除或不再提供">[[{binding.label}]]（目标已失效）</span>;
  } }}>{rendered}</ReactMarkdown></div>;
}
