// Browser-only QA harness: uses the production component and styles, never imported by the app.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SupplementDiagram } from '../../src/reader/supplements/SupplementDiagram';
import { publishedContent, supplementKind } from '../../src/textbook/content';
import { loadMath } from '../../src/reader/text/math';

export async function checkAllVisuals() {
  await loadMath();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0 auto 0 0;z-index:10000;overflow:auto;display:block';
  host.className = 'reading-layout panel-bottom';
  document.body.append(host);
  const root = createRoot(host);
  const notes = publishedContent().supplements.filter((note) => note.visual);
  const results = [];
  try {
    for (const width of [320, 390, 560]) {
      host.style.width = `${width}px`;
      flushSync(() => root.render(createElement('div', null, notes.map((note) => createElement('aside', {
        style: { width: '100%', position: 'relative', height: 'auto' }, key: note.id, className: 'supplement-panel', 'data-supplement-type': supplementKind(note), 'data-qa-id': note.id,
      }, createElement('div', { className: 'supplement-body' }, createElement(SupplementDiagram, { note })))))));
      await new Promise(requestAnimationFrame);
      for (const panel of host.querySelectorAll<HTMLElement>('[data-qa-id]')) {
        const figure = panel.querySelector<HTMLElement>('[data-diagram]')!;
        const svg = figure.querySelector<SVGElement>(':scope > svg');
        const rect = svg?.getBoundingClientRect();
        results.push({id: panel.dataset.qaId, width,
          panel: panel.scrollWidth <= panel.clientWidth + 1,
          figure: figure.scrollWidth <= figure.clientWidth + 1,
          formulas: [...figure.querySelectorAll('mjx-container')].every((e) => e.getBoundingClientRect().width <= figure.clientWidth - 16),
          mathErrors: figure.querySelectorAll('[data-mml-node="merror"]').length,
          labels: !svg || [...svg.querySelectorAll('text')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= rect!.left && r.right <= rect!.right && r.top >= rect!.top && r.bottom <= rect!.bottom; }),
        });
      }
    }
  } finally { root.unmount(); host.remove(); }
  return results;
}
