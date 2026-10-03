import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { StatusStrip } from "../src/components/StatusStrip.tsx";
import { sampleData } from "../src/sample-data.ts";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
});

afterEach(() => {
  window.document.body.innerHTML = "";
});

describe("JobSniper shell primitives", () => {
  test("renders the operational status strip without realtime affordances", async () => {
    const host = window.document.createElement("div");
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    root.render(<StatusStrip status={sampleData.status} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.textContent).toContain("T1 last run");
    expect(host.textContent).toContain("Blocked sources");
    expect(host.querySelectorAll("button, a")).toHaveLength(0);
    root.unmount();
  });
});
