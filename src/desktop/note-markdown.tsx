import { wikiLinks, type NoteReference } from '../../desktop/links';
import { Fragment } from 'react';
import triangleArea from './initial-diagrams/ch3-q-p88-example4.svg';
import triangleHeight from './initial-diagrams/ch3-triangle-base-height.svg';
import areaUnit from './initial-diagrams/ch3-area-value-unit.svg';
const initialDiagrams: Record<string, string> = { '/initial-diagrams/ch3-q-p88-example4.svg': triangleArea, '/initial-diagrams/ch3-triangle-base-height.svg': triangleHeight, '/initial-diagrams/ch3-area-value-unit.svg': areaUnit };
import ReactMarkdown from 'react-markdown';
import { MathText } from '../reader/text/MathText';
import { markdownBlocks, callout, calloutPosition, protectMath, referenceDefinitions } from './markdown-source';
export { markdownBlocks } from './markdown-source';

export const calloutNames: Record<string, string> = { explanation: '理解', hint: '提示', warning: '注意', personal: '个人补充' };

function Markdown({ source, onLink, locate }: { source: string; onLink?: (reference: NoteReference) => void; locate: (at: number) => number }) {
  const links = wikiLinks(source).map((link) => ({ ...link, from: locate(link.from), to: locate(link.to), localFrom: link.from, localTo: link.to }));
  const marker = `textbook-note-${crypto.randomUUID()}-`;
  let prepared = source;
  for (const [index, link] of [...links.entries()].reverse()) {
    prepared = prepared.slice(0, link.localFrom) + `\`${marker}${index}\`` + prepared.slice(link.localTo);
  }
  const { source: protectedSource, formulas } = protectMath(prepared);
  return <ReactMarkdown skipHtml components={{
    code({ children, className }) {
      const text = String(children);
      const link = text.startsWith(marker) ? links[Number(text.slice(marker.length))] : undefined;
      if (link) return <button type="button" className="note-wikilink" role="link" data-note-link={JSON.stringify(link)} title={link.target} onClick={() => onLink?.(link)}>{link.alias ?? link.target}</button>;
      const formula = formulas.get(text);
      return formula ? <MathText text={`${formula.display ? '$$' : '$'}${formula.value}${formula.display ? '$$' : '$'}`} /> : <code className={className}>{children}</code>;
    },
    a({ children, href }) { return <a role="link" aria-disabled="true" title={href}>{children}</a>; },
    img({ alt, src }) {
      if (src && Object.hasOwn(initialDiagrams, src)) return <img className="note-initial-diagram" src={initialDiagrams[src]} alt={alt ?? ''} />;
      return <span className="note-image-placeholder">{alt || '图片'}</span>; },
  }}>{protectedSource}</ReactMarkdown>;
}

export function NoteMarkdown({ source, references = '', onLink, offset = 0 }: { source: string; references?: string; offset?: number; onLink?: (reference: NoteReference) => void }) {
  const definitions = `${references}\n${referenceDefinitions(source)}`;
  return <>{markdownBlocks(source).map((block) => {
    const item = callout(block.source);
    if (!item) return <Fragment key={block.from}><Markdown onLink={onLink} locate={(at) => offset + block.from + at} source={`${block.source}\n\n${definitions}`} /></Fragment>;
    const name = Object.hasOwn(calloutNames, item.type) ? calloutNames[item.type]! : item.type;
    const content = <Markdown onLink={onLink} locate={(at) => offset + block.from + calloutPosition(block.source, at)} source={`${item.body}\n\n${definitions}`} />;
    return item.fold ? <details key={block.from} className={`note-callout note-callout-${item.type}`} open={item.fold === '+'}>
      <summary>{item.title || name}<small>{item.title ? name : ''}</small></summary>{content}
    </details> : <section key={block.from} className={`note-callout note-callout-${item.type}`}>
      <header>{item.title || name}<small>{item.title ? name : ''}</small></header>{content}
    </section>;
  })}</>;
}
