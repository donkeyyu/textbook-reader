import type { ContentNode } from '../../textbook/content.ts';
import type { PersonalReferenceEdge } from '../links/project-references.ts';

export type GraphNode = Pick<ContentNode, 'key' | 'title' | 'type'>;
export type GraphEdge = { source: string; target: string; kind: 'default' | 'personal' };
export type DefaultRelation = {
  locationId: string; label: string; purpose: string; targets: ContentNode[];
};

// Locations remain evidence and jump targets. They do not become graph nodes.
export function projectGraph(nodes: ContentNode[], personalEdges: readonly PersonalReferenceEdge[] = []) {
  const atLocation = new Map<string, ContentNode[]>();
  for (const node of nodes) {
    if (node.source !== 'default') continue;
    const id = node.supplement.locationId;
    atLocation.set(id, [...(atLocation.get(id) ?? []), node]);
  }
  const relations = new Map<string, DefaultRelation[]>();
  const defaultEdges: GraphEdge[] = [];
  for (const node of nodes) {
    if (node.source !== 'default') continue;
    relations.set(node.key, node.supplement.related.map((related) => {
      const targets = atLocation.get(related.locationId) ?? [];
      for (const target of targets) defaultEdges.push({ source: node.key, target: target.key, kind: 'default' });
      return { ...related, targets };
    }));
  }
  return { nodes, edges: [...defaultEdges, ...personalEdges], defaultEdges, relations };
}
