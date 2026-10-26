import type { NodeRef } from '../../textbook/content.ts';
import { linkCandidates, type LinkCatalog } from './candidates.ts';
import type { IncomingReference } from './project-references.ts';
import './backlinks.css';

export function Backlinks({ references, catalog, onNavigate, disabled = false }: {
  references: readonly IncomingReference[];
  catalog: LinkCatalog;
  onNavigate: (source: NodeRef) => void;
  disabled?: boolean;
}) {
  if (!references.length) return null;
  const candidates = linkCandidates({ ...catalog, nodes: references.map(({ source }) => source) }, '');
  return <section className="backlinks" aria-label="引用此处">
    <h3>引用此处</h3>
    <ul>{references.map(({ source, count }) => <li key={source.key}>
      <button type="button" className="text-button backlink" disabled={disabled} data-node-key={source.key} data-reference-count={count}
        onClick={() => onNavigate({ bookId: source.bookId, source: source.source, id: source.id })}>
        <span>来自 {source.title} 的引用{count > 1 ? `（${count} 处）` : ''}</span>
        <span className="backlink-context">{candidates.find(({ node }) => node.key === source.key)?.detail}</span>
      </button>
    </li>)}</ul>
  </section>;
}
