import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { DesktopApp } from "./desktop/DesktopApp";
import "./style.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用挂载节点 #root。");
}

createRoot(root).render(
  <StrictMode>
    {window.textbookDesktop ? <DesktopApp /> : <App />}
  </StrictMode>,
);
