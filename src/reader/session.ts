export type PageMetric = { top: number; height: number };

/** The page crossing the upper reading area; the last page wins at the bottom. */
export function readingPage(metrics: readonly PageMetric[], scrollTop: number, viewportHeight: number, scrollHeight: number): number {
  if (metrics.length === 0) return 1;
  if (scrollTop > 0 && scrollTop + viewportHeight >= scrollHeight - 2) return metrics.length;
  const line = scrollTop + Math.min(240, viewportHeight * 0.35);
  let low = 0;
  let high = metrics.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (metrics[mid]!.top <= line) low = mid + 1;
    else high = mid;
  }
  return Math.max(1, low);
}

/** Keep the same page-relative reading position when the available width changes. */
export function restoredScroll(metric: PageMetric, fraction: number): number {
  return Math.max(0, metric.top + metric.height * fraction);
}
