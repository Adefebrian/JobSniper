import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("JobSniper root element is missing.");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
