import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { OverviewScreen } from "../src/screens/OverviewScreen.tsx";
import { sampleStats } from "../src/sample-data.ts";
import { countryName, levelName, modeName, motivation } from "../src/utils.ts";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  navigator: window.navigator,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

afterEach(() => {
  window.document.body.innerHTML = "";
});

describe("Overview", () => {
  test("renders the greeting, tiles, and every block from sample stats", async () => {
    const host = window.document.createElement("div");
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    await act(async () => { root.render(<OverviewScreen name="Ade Febrian" initialStats={sampleStats} />); });
    const text = host.textContent ?? "";
    expect(text).toMatch(/(Good morning|Good afternoon|Good evening|Working late), Ade/);
    expect(text).toContain("1 reply in, and 3 sent this week. Keep going.");
    for (const label of ["Fresh targets", "Targets open", "Applied", "Replies"]) expect(text).toContain(label);
    for (const title of ["What landed this week?", "Which roles?", "Where?", "What level?", "Remote or on-site?", "How far did they get?", "Most active companies this week"]) expect(text).toContain(title);
    expect(text).toContain("your focus");
    expect(host.querySelectorAll(".week-day")).toHaveLength(7);
    expect(host.querySelectorAll(".funnel li")).toHaveLength(5);
    expect(host.querySelector(".mascot")).not.toBeNull();
    await act(async () => { root.unmount(); });
  });

  test("encourages when nothing has been applied yet", async () => {
    const host = window.document.createElement("div");
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    const empty = { ...sampleStats, funnel: sampleStats.funnel.map((step) => ["Applied", "Replied"].includes(step.label) ? { ...step, n: 0 } : step) };
    await act(async () => { root.render(<OverviewScreen name="" initialStats={empty} />); });
    expect(host.textContent).toContain("No applications yet. Your first one is a click away");
    expect(host.textContent).toMatch(/, there/);
    await act(async () => { root.unmount(); });
  });

  test("labels stats in plain words", () => {
    expect(countryName("UK")).toBe("United Kingdom");
    expect(countryName("Remote")).toBe("Remote");
    expect(levelName("mid")).toBe("Mid-level");
    expect(levelName("unknown")).toBe("Not stated");
    expect(modeName("remote_apac")).toBe("Remote APAC");
    expect(motivation({ targets_fresh: 0, applied_week: 3, targets_open: 5, replied: 0 })).toBe("3 applications out this week. Keep the streak.");
  });
});
