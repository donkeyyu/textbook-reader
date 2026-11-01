import { linkResolver, type LinkEntry } from './links.ts';

export function searchNotes(entries: LinkEntry[], query: string) {
  const words = query.normalize('NFC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.length ? entries.filter((entry) => words.every((word) => entry.searchText.includes(word))) : [];
}

// Path is the graph key. IDs and anchors never merge separate Markdown files.
export function projectNotes(entries: LinkEntry[]) {
  const ids = new Map<string, string[]>();
  for (const entry of entries) if (entry.id) ids.set(entry.id, [...ids.get(entry.id) ?? [], entry.path]);
  const conflicts = new Set([...ids.values()].filter((paths) => paths.length > 1).flat());
  const nodes = entries.map((entry) => ({ key: entry.path, title: `${entry.path.split('/').at(-1)!.slice(0, -3)}${conflicts.has(entry.path) ? ' · ID 冲突' : ''}`, type: 'personal' as const }));
  const edges: { source: string; target: string; kind: 'default' }[] = [];
  const resolve = linkResolver(entries);
  for (const entry of entries) {
    const targets = new Set<string>();
    for (const reference of entry.references) {
      const result = resolve(reference.target);
      if (result.kind === 'resolved') targets.add(result.candidates[0]!.path);
    }
    for (const target of targets) edges.push({ source: entry.path, target, kind: 'default' });
  }
  return { nodes, edges, conflicts };
}
