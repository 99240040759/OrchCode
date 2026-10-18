import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./global.css";

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("selectstart", (e) => {
  const el = e.target as HTMLElement | null;
  if (!el?.closest("input, textarea, [contenteditable='true'], [contenteditable=''], .Composer-input, .selectable")) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

