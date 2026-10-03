import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// Inside JobSniper.app (Tauri) the window is transparent over native macOS vibrancy.
if ("__TAURI_INTERNALS__" in window) document.documentElement.dataset.shell = "mac";

const root = document.getElementById("root");
if (!root) throw new Error("JobSniper root element is missing.");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
