// MathJax 3 rendered on demand: the SVG pipeline is loaded as its own chunk so the
// reader bundle does not carry the TeX font data until a formula is on screen.
type MathRenderer = (tex: string, display: boolean) => string;

let renderer: MathRenderer | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();

export function mathReady(): boolean {
  return renderer !== null;
}

export function subscribeMath(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function loadMath(): Promise<void> {
  // mathjax-full 读构建期注入的 PACKAGE_VERSION；没有注入时会退到 eval('require')，浏览器里直接报错。
  (globalThis as { PACKAGE_VERSION?: string }).PACKAGE_VERSION ??= '3.2.1';
  loading ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const document = mathjax.document('', {
      InputJax: new TeX({ packages: AllPackages }),
      // Local font cache keeps every SVG self-contained, so cached markup can be reused anywhere.
      OutputJax: new SVG({ fontCache: 'local' }),
    });
    renderer = (tex, display) => adaptor.outerHTML(document.convert(tex, { display }));
    for (const listener of listeners) listener();
  })().catch((error: unknown) => {
    // 加载失败时清空缓存的 promise，下次打开条目重新加载；公式在就绪前一直显示源文本。
    loading = null;
    throw error;
  });
  return loading;
}

export function renderMath(tex: string, display = false): string | null {
  if (!renderer) return null;
  const key = `${display ? 'D' : 'I'}${tex}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const html = renderer(tex, display);
  cache.set(key, html);
  return html;
}

export type MathSegment = { kind: 'text'; value: string } | { kind: 'math'; value: string; display: boolean };

// 行间公式优先：$$…$$ 与 \[…\] 先匹配，剩下的 $…$ 与 \(…\) 才是行内。
const DELIMITERS = /\$\$([^$]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;

/** 把一段带公式的文本切成文字与 TeX 片段；没有公式时只剩一个文字片段。 */
export function splitMath(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let end = 0;
  for (const match of text.matchAll(DELIMITERS)) {
    const start = match.index ?? 0;
    if (start > end) segments.push({ kind: 'text', value: text.slice(end, start) });
    const [, block, bracket, inline, paren] = match;
    const tex = block ?? bracket ?? inline ?? paren ?? '';
    // 空公式保留原文，避免连续两个 $ 被吞掉。
    if (tex.trim()) segments.push({ kind: 'math', value: tex, display: block !== undefined || bracket !== undefined });
    else segments.push({ kind: 'text', value: match[0] });
    end = start + match[0].length;
  }
  if (end < text.length) segments.push({ kind: 'text', value: text.slice(end) });
  return segments;
}
