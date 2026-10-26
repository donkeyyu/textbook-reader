import { useLayoutEffect, useRef, useState } from 'react';

/** Choose the drawer placement from its owning pane, before subtracting the drawer. */
export function usePanelLayout(split: boolean, navigationOpen: boolean) {
  const layoutRef = useRef<HTMLElement>(null);
  const [bottomPanel, setBottomPanel] = useState(() => window.innerWidth <= 1100);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const measure = () => {
      const width = layout.getBoundingClientRect().width;
      let ownerWidth = width;
      if (split) {
        const style = getComputedStyle(layout);
        const graphShare = parseFloat(style.getPropertyValue('--graph-share')) || 45;
        const bookShare = parseFloat(style.getPropertyValue('--book-share')) || 55;
        ownerWidth = Math.max(0, width - 12) * bookShare / (graphShare + bookShare);
        const value = `${ownerWidth}px`;
        if (layout.style.getPropertyValue('--book-pane-width') !== value) layout.style.setProperty('--book-pane-width', value);
      } else if (navigationOpen && width > 760) {
        ownerWidth -= layout.querySelector('.page-sidebar')?.getBoundingClientRect().width ?? 0;
      }
      setBottomPanel(ownerWidth <= 1100);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(layout);
    const changes = new MutationObserver(measure);
    changes.observe(layout, { attributes: true, attributeFilter: ['style'] });
    return () => { resize.disconnect(); changes.disconnect(); };
  }, [split, navigationOpen]);

  return { layoutRef, bottomPanel };
}
