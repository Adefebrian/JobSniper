import type { ReactNode } from "react";
import { StatusStrip } from "./StatusStrip.tsx";
import type { StatusStrip as StatusData } from "../types.ts";

const routes = [
  { id: "targets", label: "Targets", href: "#/targets", note: "Ranked job matches" },
  { id: "outreach", label: "Outreach", href: "#/outreach", note: "Drafts and send queue" },
  { id: "companies", label: "Companies & Sources", href: "#/companies", note: "Coverage and health" },
  { id: "settings", label: "Settings", href: "#/settings", note: "Profile and controls" },
];

interface Props {
  route: string;
  status: StatusData;
  children: ReactNode;
}

export function AppShell({ route, status, children }: Props) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/targets" aria-label="JobSniper home">
          <span className="brand-mark">JS</span>
          <span>
            <strong>JobSniper</strong>
            <small>Local job command center</small>
          </span>
        </a>
        <div className="topbar-actions">
          <span className="local-label">Local workspace</span>
          <a className="button button-quiet" href="#/settings">Settings</a>
        </div>
      </header>
      <div className="app-body">
        <nav className="side-nav" aria-label="Primary navigation">
          <div className="nav-heading">Workspace</div>
          {routes.map((item) => (
            <a key={item.id} href={item.href} className={`nav-item ${route === item.id ? "active" : ""}`} aria-current={route === item.id ? "page" : undefined}>
              <span className="nav-label">{item.label}</span>
              <span className="nav-note">{item.note}</span>
            </a>
          ))}
          <div className="nav-footer">
            <span>API refresh</span>
            <strong>60 seconds</strong>
          </div>
        </nav>
        <main className="main-content">
          <StatusStrip status={status} />
          <div className="page-wrap">{children}</div>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {routes.slice(0, 4).map((item) => (
          <a key={item.id} href={item.href} className={route === item.id ? "active" : ""} aria-current={route === item.id ? "page" : undefined}>
            <span>{item.label === "Companies & Sources" ? "Sources" : item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
