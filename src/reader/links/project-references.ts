import { nodeKey, type ContentNode } from '../../textbook/content.ts';
import type { PersonalData } from '../personal.ts';
import { resolveLink } from './candidates.ts';
import { matchingBindings, sameTarget } from './document.ts';

export type IncomingReference = { source: ContentNode; count: number };
export type PersonalReferenceEdge = { source: string; target: string; kind: 'personal' };

/** Project only the accepted personal snapshot, never an editor's draft. */
export function projectReferences(bookId: string, nodes: readonly ContentNode[], saved: PersonalData) {
  const current = nodes.filter((node) => node.bookId === bookId);
  const personal = new Map(saved.supplements.map((item) => [item.id, item]));
  const incoming = new Map<string, IncomingReference[]>();
  const pairs = new Map<string, PersonalReferenceEdge>();
  // Iterating current nodes also excludes notes whose published source was removed.
  for (const source of current) {
    const item = source.source === 'personal' ? personal.get(source.id) : undefined;
    const markdown = source.source === 'default' ? saved.notes[source.id] ?? '' : item?.markdown ?? '';
    const bindings = source.source === 'default' ? saved.noteBindings?.[source.id] ?? [] : item?.bindings ?? [];
    for (const binding of matchingBindings(markdown, bindings)) {
      const target = resolveLink(binding, current);
      if (!target) continue;
      const sourceKey = nodeKey(source), targetKey = nodeKey(target);
      const references = incoming.get(targetKey) ?? [];
      const reference = references.find((entry) => sameTarget(entry.source, source));
      if (reference) reference.count++;
      else references.push({ source, count: 1 });
      incoming.set(targetKey, references);
      if (sameTarget(source, target)) continue;
      const [first, second] = [sourceKey, targetKey].sort() as [string, string];
      pairs.set(JSON.stringify([first, second]), { source: first, target: second, kind: 'personal' });
    }
  }
  return { incoming, edges: [...pairs.values()] };
}
