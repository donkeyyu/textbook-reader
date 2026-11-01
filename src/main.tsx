import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { DesktopWorkspace } from "./desktop/DesktopWorkspace";
import "./style.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用挂载节点 #root。");
}

// Pixi's static shader/uniform adapter works with the desktop CSP's ban on eval.
if (window.textbookDesktop) await import('pixi.js/unsafe-eval');

createRoot(root).render(
  <StrictMode>
    {window.textbookDesktop ? <DesktopWorkspace /> : <App />}
  </StrictMode>,
);
