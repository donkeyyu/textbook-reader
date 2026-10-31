import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Resize the reader panel without rerendering the textbook pages. */
export function PanelResize({ bottom }: { bottom: boolean }) {
  const handle = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(45);
  const [width, setWidth] = useState(420);
  const [maxWidth, setMaxWidth] = useState(700);

  useEffect(() => {
    const layout = handle.current?.parentElement;
    return () => {
      layout?.style.removeProperty('--supplement-height');
      layout?.style.removeProperty('--supplement-width');
      layout?.classList.remove('panel-resizing');
    };
  }, []);

  useLayoutEffect(() => {
    const layout = handle.current?.parentElement;
    const panel = layout?.querySelector<HTMLElement>('#supplement-panel');
    if (!layout || !panel || bottom) return;
    const measure = () => {
      const ownerWidth = parseFloat(getComputedStyle(layout).getPropertyValue('--panel-owner-width')) || layout.clientWidth;
      setMaxWidth(Math.max(350, ownerWidth - 400));
      setWidth(panel.getBoundingClientRect().width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(layout);
    const changes = new MutationObserver(measure);
    changes.observe(layout, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [bottom]);

  const size = bottom ? height : width;
  const minimum = bottom ? 20 : 350;
  const maximum = bottom ? 80 : maxWidth;
  function resize(value: number) {
    const next = Math.max(minimum, Math.min(maximum, value));
    handle.current?.parentElement?.style.setProperty(bottom ? '--supplement-height' : '--supplement-width', `${next}${bottom ? '%' : 'px'}`);
    if (bottom) setHeight(next);
    else setWidth(next);
  }

  return <div ref={handle} className="panel-resize" role="separator" tabIndex={0}
    aria-label={bottom ? '调整解读区域高度' : '调整解读区域宽度'} aria-orientation={bottom ? 'horizontal' : 'vertical'} aria-controls="supplement-panel"
    aria-valuemin={minimum} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(size)} aria-valuetext={`${Math.round(size)}${bottom ? '%' : ' 像素'}`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.parentElement?.classList.add('panel-resizing');
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      if (bottom) {
        if (bounds.height > 0) resize((bounds.bottom - event.clientY) / bounds.height * 100);
      } else resize(bounds.right - event.clientX);
    }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onLostPointerCapture={(event) => event.currentTarget.parentElement?.classList.remove('panel-resizing')}
    onKeyDown={(event) => {
      const increase = bottom ? 'ArrowUp' : 'ArrowLeft';
      const decrease = bottom ? 'ArrowDown' : 'ArrowRight';
      const step = bottom ? 5 : 20;
      const next = event.key === increase ? size + step : event.key === decrease ? size - step
        : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); resize(next); }
    }}><span aria-hidden="true" /></div>;
}
