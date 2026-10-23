import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用挂载节点 #root。");
}

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>课本解读</h1>
      <p>理解知识，理解变换的理由，回到教材建立联系。</p>
      <p>教材阅读功能待开发。</p>
    </main>
  </StrictMode>,
);
