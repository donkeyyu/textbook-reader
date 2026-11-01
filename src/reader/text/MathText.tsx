import { useEffect, useSyncExternalStore } from "react";
import { loadMath, mathReady, renderMath, splitMath, subscribeMath } from "./math";
import { spaceSegments } from "./text-spacing";
import "./math.css";

/** 正文中的公式：MathJax 就绪前先露出源文本，就绪后替换为 SVG。 */
export function MathText({ text }: { text: string }) {
  const ready = useSyncExternalStore(subscribeMath, mathReady, mathReady);
  useEffect(() => { void loadMath().catch(() => {}); }, []);
  const segments = spaceSegments(splitMath(text));
  if (segments.every(({ kind }) => kind === "text")) return <>{text}</>;
  return <>
    {segments.map((segment, index) => segment.kind === "text"
      ? segment.value
      : <Formula key={index} tex={segment.value} display={segment.display} ready={ready} />)}
  </>;
}

function Formula({ tex, display, ready }: { tex: string; display: boolean; ready: boolean }) {
  const html = ready ? renderMath(tex, display) : null;
  if (html === null) return <span className="math-pending">{tex}</span>;
  return <span className={display ? "math-display" : "math-inline"} dangerouslySetInnerHTML={{ __html: html }} />;
}
