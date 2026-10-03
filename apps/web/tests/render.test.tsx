import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppShell } from "../src/components/AppShell.tsx";
import { Badge, Button, Field, ListRow, Meta, Segmented, Stat, TextInput } from "../src/components/ui/index.ts";
import { sampleData } from "../src/sample-data.ts";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

afterEach(() => {
  window.document.body.innerHTML = "";
});

const mount = async (node: React.ReactNode) => {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => { root.render(node); });
  return { host, unmount: () => act(async () => { root.unmount(); }) };
};

describe("JobSniper shell", () => {
  test("renders five destinations once per nav, the current one marked", async () => {
    const { host, unmount } = await mount(<AppShell route="targets" status={sampleData.status} counts={{ targets: 3 }}><p>body</p></AppShell>);
    for (const nav of host.querySelectorAll("nav")) expect(nav.querySelectorAll("a")).toHaveLength(5);
    expect(host.querySelector('.side-nav a[aria-current="page"]')?.textContent).toContain("Targets");
    expect(host.querySelector(".last-crawl")?.textContent).toMatch(/Crawled .* ago/);
    expect(host.textContent).not.toContain("NaN");
    await unmount();
  });

  test("says no crawl yet when every tier is empty", async () => {
    const { host, unmount } = await mount(<AppShell route="overview" status={{ ...sampleData.status, lastRunT1: "", lastRunT2: "", lastRunT3: "" }} counts={{}}><p /></AppShell>);
    expect(host.querySelector(".last-crawl")?.textContent).toContain("No crawl yet");
    await unmount();
  });
});

describe("component set", () => {
  test("button variants, badge tones, and meta parts render with their classes", async () => {
    const { host, unmount } = await mount(<>
      <Button variant="primary">Go</Button>
      <Button variant="plain" href="#/x">Link</Button>
      <Badge tone="warning">Gap</Badge>
      <Meta parts={["Wayve", null, "London, UK", "", "16h"]} />
    </>);
    expect(host.querySelector(".ui-button--primary")?.tagName).toBe("BUTTON");
    expect(host.querySelector("a.ui-button--plain")?.getAttribute("href")).toBe("#/x");
    expect(host.querySelector(".ui-badge.is-warning")?.textContent).toBe("Gap");
    expect(host.querySelectorAll(".ui-meta-part")).toHaveLength(3);
    await unmount();
  });

  test("a row never carries a title tooltip", async () => {
    const { host, unmount } = await mount(<ListRow href="#/targets/1" title="Automotive Systems Engineer" subtitle={<Meta parts={["Wayve", "Sunnyvale, US"]} />} />);
    expect(host.querySelector("[title]")).toBeNull();
    await unmount();
  });

  test("segmented marks one option and field links its label", async () => {
    const { host, unmount } = await mount(<>
      <Segmented label="Sort" value="b" onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B", count: 2 }]} />
      <Field label="Nickname" htmlFor="nick"><TextInput id="nick" defaultValue="Brian" /></Field>
      <Stat value="19%" label="Sponsor a visa" />
    </>);
    expect(host.querySelector('[aria-checked="true"]')?.textContent).toBe("B2");
    expect(host.querySelector("label")?.getAttribute("for")).toBe("nick");
    expect(host.querySelector(".ui-stat-value")?.textContent).toBe("19%");
    await unmount();
  });
});
