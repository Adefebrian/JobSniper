import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import { Mascot } from "./Mascot.tsx";
import { agoPhrase, parseDate } from "../utils.ts";
import type { StatusStrip } from "../types.ts";

export const routes: { id: string; label: string; short: string; href: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", short: "Home", href: "#/overview", icon: "home" },
  { id: "targets", label: "Targets", short: "Targets", href: "#/targets", icon: "target" },
  { id: "outreach", label: "Outreach", short: "Outreach", href: "#/outreach", icon: "send" },
  { id: "companies", label: "Companies & Sources", short: "Sources", href: "#/companies", icon: "building" },
  { id: "settings", label: "Settings", short: "Settings", href: "#/settings", icon: "sliders" },
];

interface Props {
  route: string;
  status: StatusStrip;
  counts: Partial<Record<string, number>>;
  children: ReactNode;
}

/** The most recent crawl of any tier, said once, quietly, with Pip dozing when it is stale. */
export function LastCrawl({ status }: { status: StatusStrip }) {
  const latest = [status.lastRunT1, status.lastRunT2, status.lastRunT3]
    .map((value) => parseDate(value))
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const idle = !latest || Date.now() - latest.getTime() > 6 * 3_600_000;
  return (
    <p className="last-crawl">
      <Mascot size={24} blink={!idle} sleepy={idle} />
      <span>{latest ? `${idle ? "Dozing. " : ""}Crawled ${agoPhrase(latest.toISOString()).toLowerCase()}` : "No crawl yet"}</span>
    </p>
  );
}

export function AppShell({ route, status, counts, children }: Props) {
  const link = (item: (typeof routes)[number], label: string, withCount: boolean) => {
    const on = route === item.id;
    return (
      <a key={item.id} href={item.href} className={on ? "is-on" : undefined} aria-current={on ? "page" : undefined}>
        <Icon name={item.icon} />
        <span className="nav-label">{label}</span>
        {withCount && counts[item.id] ? <span className="nav-count tabular">{counts[item.id]}</span> : null}
      </a>
    );
  };
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Sidebar" data-tauri-drag-region>
        <a className="sidebar-brand" href="#/overview"><strong>JobSniper</strong></a>
        <nav className="side-nav" aria-label="Primary navigation">
          {routes.map((item) => link(item, item.label, true))}
        </nav>
        <LastCrawl status={status} />
        <a className="credit" href="https://adefebrian.com" target="_blank" rel="noreferrer">
          Developed by <strong>Brian</strong> · adefebrian.com
        </a>
      </aside>
      <header className="topbar" data-tauri-drag-region>
        <a className="brand" href="#/overview" aria-label="JobSniper home"><strong>JobSniper</strong></a>
        <nav className="top-nav" aria-label="Primary navigation">
          {routes.map((item) => link(item, item.short, false))}
        </nav>
      </header>
      <main className="main-content" id="main">{children}</main>
      <nav className="tab-bar" aria-label="Mobile navigation">
        {routes.map((item) => link(item, item.short, false))}
      </nav>
    </div>
  );
}
