import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// Inside JobSniper.app (Tauri) the window is transparent over native macOS glass and
// follows the system appearance. The plain browser build is always light.
if ("__TAURI_INTERNALS__" in window) {
  const html = document.documentElement;
  html.dataset.shell = "mac";
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const apply = () => { html.dataset.theme = media?.matches ? "dark" : "light"; };
  apply();
  media?.addEventListener("change", apply);
}

const root = document.getElementById("root");
if (!root) throw new Error("JobSniper root element is missing.");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
