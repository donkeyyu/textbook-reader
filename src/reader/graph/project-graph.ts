import type { ContentNode } from '../../textbook/content.ts';

export type GraphNode = Pick<ContentNode, 'key' | 'title' | 'type'>;
export type GraphEdge = { source: string; target: string };
export type DefaultRelation = {
  locationId: string; label: string; purpose: string; targets: ContentNode[];
};

// Locations remain evidence and jump targets. They do not become graph nodes.
export function projectGraph(nodes: ContentNode[]) {
  const atLocation = new Map<string, ContentNode[]>();
  for (const node of nodes) {
    if (node.source !== 'default') continue;
    const id = node.supplement.locationId;
    atLocation.set(id, [...(atLocation.get(id) ?? []), node]);
  }
  const relations = new Map<string, DefaultRelation[]>();
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    if (node.source !== 'default') continue;
    relations.set(node.key, node.supplement.related.map((related) => {
      const targets = atLocation.get(related.locationId) ?? [];
      for (const target of targets) edges.push({ source: node.key, target: target.key });
      return { ...related, targets };
    }));
  }
  return { nodes, edges, relations };
}
