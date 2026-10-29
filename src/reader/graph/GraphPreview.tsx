import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import type { ContentNode } from '../../textbook/content.ts';
import { supplementTypes, TypeMarker } from '../supplement-types.tsx';
import { MathText } from '../MathText';
import type { GraphPreviewAnchor } from './useSupplementGraph.ts';

export function GraphPreview({ node, anchor }: { node: ContentNode; anchor: GraphPreviewAnchor }) {
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.max(12, Math.min(anchor.x - width / 2, window.innerWidth - width - 12));
  const top = anchor.y + anchor.radius + 12;
  const height = Math.min(260, window.innerHeight - top - 12);
  if (height < 80) return null;
  return createPortal(<div className="graph-preview" role="tooltip" aria-label={node.title}
    data-node-key={node.key} data-supplement-type={node.type} style={{ left, top, width, maxHeight: height }}>
    <div className="graph-preview-type"><TypeMarker type={node.type} />{supplementTypes[node.type]}</div>
    <div className="graph-preview-content">
      {node.source === 'personal'
        ? <ReactMarkdown skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>
          {node.personal.markdown}
        </ReactMarkdown>
        : <p><MathText text={node.summary} /></p>}
    </div>
    <p className="graph-preview-hint">点击节点阅读完整内容</p>
  </div>, document.body);
}
