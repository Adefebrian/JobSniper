import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import * as api from "../api.ts";
import type { StatCount, Stats } from "../types.ts";
import { countryName, greeting, levelName, modeName, motivation } from "../utils.ts";
import { CountUp } from "../components/CountUp.tsx";
import { Mascot } from "../components/Mascot.tsx";
import { Monogram } from "../components/Monogram.tsx";

interface Props {
  name: string;
  /** Tests pass stats directly; the app fetches them. */
  initialStats?: Stats | null;
}

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short" });

export function OverviewScreen({ name, initialStats = null }: Props) {
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialStats) return;
    let live = true;
    const load = () => api.getStats()
      .then((data) => { if (live) { setStats(data); setError(null); } })
      .catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : "Stats are unavailable."); });
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [initialStats]);

  const firstName = name.trim().split(/\s+/)[0] || "there";

  if (!stats) {
    return (
      <div className="screen overview">
        <header className="overview-hero" data-tauri-drag-region>
          <Mascot size={72} follow label="Pip the scout" />
          <div className="overview-hello">
            <h1>{greeting()}, {firstName}</h1>
            <p className="muted">{error ? "Your numbers are not available right now. They will appear after the next refresh." : "Gathering your numbers."}</p>
          </div>
        </header>
      </div>
    );
  }

  const t = stats.totals;
  return (
    <div className="screen overview">
      <header className="overview-hero" data-tauri-drag-region>
        <Mascot size={72} follow label="Pip the scout" />
        <div className="overview-hello">
          <h1>{greeting()}, {firstName}</h1>
          <p className="overview-line">{motivation(t)}</p>
        </div>
      </header>

      <section className="stat-tiles" aria-label="Key numbers">
        <Tile label="Fresh targets" hint="posted in 72h" value={t.targets_fresh} href="#/targets" />
        <Tile label="Targets open" hint="ready to review" value={t.targets_open} href="#/targets" />
        <Tile label="Applied" hint={`${t.applied_week} this week`} value={t.applied} href="#/outreach" />
        <Tile label="Replies" hint={t.positive ? `${t.positive} positive` : "so far"} value={t.replied} href="#/outreach" />
      </section>

      <div className="overview-grid">
        <Block title="What landed this week?" wide>
          <WeekChart daily={stats.daily} />
        </Block>
        <Block title="Which roles?">
          <BarList items={stats.roles} empty="No targets this week yet." />
        </Block>
        <Block title="Where?">
          <BarList items={stats.countries.map((item) => ({ ...item, label: countryName(item.label) }))} empty="No targets this week yet." />
        </Block>
        <Block title="What level?">
          <BarList items={stats.levels.map((item) => ({ ...item, label: levelName(item.label), focus: item.label === "mid" }))} empty="No targets this week yet." />
        </Block>
        <Block title="Remote or on-site?">
          <BarList items={stats.modes.map((item) => ({ ...item, label: modeName(item.label) }))} empty="No targets this week yet." />
        </Block>
        <Block title="How far did they get?" wide>
          <Funnel steps={stats.funnel} />
        </Block>
        <Block title="Most active companies this week" wide>
          {stats.companies.length === 0 ? <Encourage text="No company has posted twice yet. The scout keeps watching." /> : (
            <ul className="company-list">
              {stats.companies.map((company) => (
                <li key={company.label}>
                  <Monogram name={company.label} size={28} />
                  <span className="company-name">{company.label}</span>
                  <span className="muted tabular">{company.n} {company.n === 1 ? "role" : "roles"}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}

function Tile({ label, hint, value, href }: { label: string; hint: string; value: number; href: string }) {
  return (
    <a className="stat-tile" href={href}>
      <span className="stat-label">{label}</span>
      <span className="stat-value"><CountUp value={value} /></span>
      <span className="stat-hint">{hint}</span>
    </a>
  );
}

function Block({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`overview-block ${wide ? "is-wide" : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Encourage({ text }: { text: string }) {
  return (
    <div className="encourage">
      <Mascot size={36} blink={false} reactive={false} />
      <p className="muted">{text}</p>
    </div>
  );
}

function BarList({ items, empty }: { items: (StatCount & { focus?: boolean })[]; empty: string }) {
  if (items.length === 0) return <Encourage text={empty} />;
  const max = Math.max(...items.map((item) => item.n), 1);
  return (
    <ul className="bar-list">
      {items.slice(0, 6).map((item, index) => (
        <li key={item.label} className={item.focus ? "is-focus" : undefined} style={{ "--i": index } as CSSProperties}>
          <span className="bar-label">{item.label}{item.focus ? <span className="focus-note">your focus</span> : null}</span>
          <span className="bar-value tabular">{item.n}</span>
          <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ transform: `scaleX(${item.n / max})` }} /></span>
        </li>
      ))}
    </ul>
  );
}

function WeekChart({ daily }: { daily: Stats["daily"] }) {
  const max = Math.max(...daily.map((day) => day.discovered), 1);
  const totalPosted = daily.reduce((sum, day) => sum + day.discovered, 0);
  const totalTargeted = daily.reduce((sum, day) => sum + day.targeted, 0);
  if (totalPosted === 0) return <Encourage text="Nothing posted in the last 7 days yet. New roles appear here as they land." />;
  return (
    <div className="week-chart">
      <p className="chart-legend">
        <span><span className="key key-posted" aria-hidden="true" />Posted <strong className="tabular">{totalPosted}</strong></span>
        <span><span className="key key-targeted" aria-hidden="true" />Targeted for you <strong className="tabular">{totalTargeted}</strong></span>
      </p>
      <div className="week-bars" role="img" aria-label={`Last 7 days: ${totalPosted} posted, ${totalTargeted} targeted.`}>
        {daily.map((day, index) => {
          const date = new Date(`${day.day}T12:00:00`);
          return (
            <div className="week-day" key={day.day} style={{ "--i": index } as CSSProperties} title={`${day.day}: ${day.discovered} posted, ${day.targeted} targeted`}>
              <div className="week-stack">
                <span className="week-bar bar-posted" style={{ height: `${(day.discovered / max) * 100}%` }} />
                <span className="week-bar bar-targeted" style={{ height: `${(day.targeted / max) * 100}%` }} />
              </div>
              <span className={`week-label ${index === daily.length - 1 ? "is-today" : ""}`}>{WEEKDAY.format(date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Funnel({ steps }: { steps: StatCount[] }) {
  const max = Math.max(...steps.map((step) => step.n), 1);
  const applied = steps.find((step) => step.label === "Applied")?.n ?? 0;
  return (
    <div className="funnel-wrap">
      <ol className="funnel">
        {steps.map((step, index) => {
          const previous = steps[index - 1]?.n ?? 0;
          const rate = index > 0 && previous > 0 ? Math.round((step.n / previous) * 100) : null;
          return (
            <li key={step.label} style={{ "--i": index } as CSSProperties}>
              <span className="bar-label">{step.label}</span>
              <span className="bar-value tabular">{step.n.toLocaleString("en")}{rate !== null ? <span className="muted funnel-rate"> {rate}%</span> : null}</span>
              <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ transform: `scaleX(${Math.max(step.n / max, step.n ? 0.02 : 0)})` }} /></span>
            </li>
          );
        })}
      </ol>
      {applied === 0 ? <Encourage text="No applications yet. Your first one is a click away: open a target and press Draft email." /> : null}
    </div>
  );
}
