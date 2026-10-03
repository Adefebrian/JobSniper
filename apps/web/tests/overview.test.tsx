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
  MutationObserver: window.MutationObserver,
  navigator: window.navigator,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

afterEach(() => {
  window.document.body.innerHTML = "";
});

const render = async (stats: typeof sampleStats, nickname = "Brian") => {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => { root.render(<OverviewScreen nickname={nickname} initialStats={stats} />); });
  return { host, unmount: () => act(async () => { root.unmount(); }) };
};

describe("Overview", () => {
  test("greets Brian by nickname and shows his goal, matches, skills, and market", async () => {
    const { host, unmount } = await render(sampleStats);
    const text = host.textContent ?? "";
    expect(text).toMatch(/(Good morning|Good afternoon|Good evening|Working late), Brian/);
    expect(text).not.toContain("Ade");
    expect(text).toContain("7 to go this week");
    expect(text).toContain("3 of 10 applications sent since Monday.");
    for (const title of ["Weekly goal", "How open the market is to you", "Best matches today", "Skills the market wants this week", "Last 7 days", "Roles", "Countries", "Levels", "Pipeline", "Most active companies"]) expect(text).toContain(title);
    expect(host.querySelectorAll(".best-card")).toHaveLength(1);
    expect(host.querySelector(".best-card")?.getAttribute("href")).toBe("#/targets/job-northstar");
    expect(text).toContain("3 of 6 in your CV");
    expect(host.querySelectorAll(".ui-badge.is-warning")).toHaveLength(3);
    expect(text).toContain("29%");
    expect(text).toContain("Your level");
    expect(host.querySelectorAll(".week-day")).toHaveLength(7);
    expect(host.querySelectorAll(".funnel li")).toHaveLength(5);
    expect(host.querySelector(".mascot")).not.toBeNull();
    await unmount();
  });

  test("nudges toward the first application and the CV import when there is nothing yet", async () => {
    const empty = {
      ...sampleStats,
      funnel: sampleStats.funnel.map((step) => ["Applied", "Replied"].includes(step.label) ? { ...step, n: 0 } : step),
      skills: sampleStats.skills.map((skill) => ({ ...skill, inCv: false })),
      best: [],
    };
    const { host, unmount } = await render(empty);
    const text = host.textContent ?? "";
    expect(text).toContain("No applications yet. Open a target and press Draft email");
    expect(text).toContain("Import your CV");
    expect(text).toContain("No fresh matches yet");
    await unmount();
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
