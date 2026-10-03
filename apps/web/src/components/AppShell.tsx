import type { ReactNode } from "react";
import { StatusStrip } from "./StatusStrip.tsx";
import type { StatusStrip as StatusData } from "../types.ts";

export const routes = [
  { id: "targets", label: "Targets", short: "Targets", href: "#/targets" },
  { id: "outreach", label: "Outreach", short: "Outreach", href: "#/outreach" },
  { id: "companies", label: "Companies & Sources", short: "Sources", href: "#/companies" },
  { id: "settings", label: "Settings", short: "Settings", href: "#/settings" },
];

interface Props {
  route: string;
  status: StatusData;
  counts: Partial<Record<string, number>>;
  children: ReactNode;
}

export function AppShell({ route, status, counts, children }: Props) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Sidebar" data-tauri-drag-region>
        <div className="sidebar-top" data-tauri-drag-region>
          <a className="brand" href="#/targets" aria-label="JobSniper home"><strong>JobSniper</strong></a>
        </div>
        <nav className="side-nav" aria-label="Primary navigation">
          {routes.map((item) => (
            <a key={item.id} href={item.href} className={route === item.id ? "active" : undefined} aria-current={route === item.id ? "page" : undefined}>
              <span className="side-nav-label">{item.label}</span>
              {counts[item.id] !== undefined ? <span className="side-nav-count tabular">{counts[item.id]}</span> : null}
            </a>
          ))}
        </nav>
        <StatusStrip status={status} variant="stack" />
      </aside>
      <header className="topbar" data-tauri-drag-region>
        <a className="brand" href="#/targets" aria-label="JobSniper home"><strong>JobSniper</strong></a>
        <nav className="top-nav" aria-label="Primary navigation" data-tauri-drag-region>
          {routes.map((item) => (
            <a key={item.id} href={item.href} className={route === item.id ? "active" : undefined} aria-current={route === item.id ? "page" : undefined}>{item.label}</a>
          ))}
        </nav>
      </header>
      <StatusStrip status={status} />
      <main className="main-content" id="main">{children}</main>
      <nav className="tab-bar" aria-label="Mobile navigation">
        {routes.map((item) => (
          <a key={item.id} href={item.href} className={route === item.id ? "active" : undefined} aria-current={route === item.id ? "page" : undefined}>{item.short}</a>
        ))}
      </nav>
    </div>
  );
}
