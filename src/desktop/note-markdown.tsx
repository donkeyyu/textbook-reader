import { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import { MathText } from '../reader/text/MathText';
import { markdownBlocks, callout, protectMath, referenceDefinitions } from './markdown-source';
export { markdownBlocks } from './markdown-source';

export const calloutNames: Record<string, string> = { explanation: '理解', hint: '提示', warning: '注意', personal: '个人补充' };

function Markdown({ source }: { source: string }) {
  const { source: protectedSource, formulas } = protectMath(source);
  return <ReactMarkdown skipHtml components={{
    code({ children, className }) {
      const formula = formulas.get(String(children));
      return formula ? <MathText text={`${formula.display ? '$$' : '$'}${formula.value}${formula.display ? '$$' : '$'}`} /> : <code className={className}>{children}</code>;
    },
    a({ children, href }) { return <a role="link" aria-disabled="true" title={href}>{children}</a>; },
    img({ alt }) { return <span className="note-image-placeholder">{alt || '图片'}</span>; },
  }}>{protectedSource}</ReactMarkdown>;
}

export function NoteMarkdown({ source, references = '' }: { source: string; references?: string }) {
  const definitions = `${references}\n${referenceDefinitions(source)}`;
  return <>{markdownBlocks(source).map((block) => {
    const item = callout(block.source);
    if (!item) return <Fragment key={block.from}><Markdown source={`${block.source}\n\n${definitions}`} /></Fragment>;
    const name = Object.hasOwn(calloutNames, item.type) ? calloutNames[item.type]! : item.type;
    const content = <Markdown source={`${item.body}\n\n${definitions}`} />;
    return item.fold ? <details key={block.from} className={`note-callout note-callout-${item.type}`} open={item.fold === '+'}>
      <summary>{item.title || name}<small>{item.title ? name : ''}</small></summary>{content}
    </details> : <section key={block.from} className={`note-callout note-callout-${item.type}`}>
      <header>{item.title || name}<small>{item.title ? name : ''}</small></header>{content}
    </section>;
  })}</>;
}
