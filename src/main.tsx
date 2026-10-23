import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Reader } from "./reader/Reader";
import "./style.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用挂载节点 #root。");
}

createRoot(root).render(
  <StrictMode>
    <Reader />
  </StrictMode>,
);
