import { useEffect, useState, type CSSProperties } from "react";
import * as api from "../api.ts";
import type { SniperStatus, StatCount, Stats } from "../types.ts";
import { agoPhrase, countryName, formatAge, greeting, levelName, motivation, percentOf, placeLabel, scoreLabel, seniorityLabel } from "../utils.ts";
import { Mascot } from "../components/Mascot.tsx";
import { Icon } from "../components/Icon.tsx";
import { Badge, Button, Card, EmptyState, GoalRing, LoadingRows, Meta, Meter, MeterRow, Monogram, ScoreRing, Section, Stat } from "../components/ui/index.ts";

interface Props {
  nickname: string;
  /** Tests pass the sniper status directly; the app fetches it. */
  initialSniper?: SniperStatus | null;
  /** Tests pass stats directly; the app fetches them. */
  initialStats?: Stats | null;
}

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short" });

export function OverviewScreen({ nickname, initialStats = null, initialSniper = null }: Props) {
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [error, setError] = useState<string | null>(null);
  const [sniper, setSniper] = useState<SniperStatus | null>(initialSniper);

  useEffect(() => {
    if (initialSniper) return;
    let live = true;
    const load = () => api.getSniper().then((data) => { if (live) setSniper(data); }).catch(() => { if (live) setSniper(null); });
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [initialSniper]);

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

  const name = (stats?.me?.nickname || nickname || "Brian").trim();

  return (
    <div className="pane overview">
      <header className="overview-hello" data-tauri-drag-region>
        <Mascot size={56} follow label="Pip the scout" />
        <div className="overview-hello-text" data-tauri-drag-region>
          <h1>{greeting()}, {name}</h1>
          <p>{stats ? motivation(stats.totals) : error ? "Your numbers are not available right now. They will appear after the next refresh." : "Gathering this week's numbers."}</p>
        </div>
      </header>
      {stats ? <Board stats={stats} sniper={sniper} /> : <LoadingRows rows={4} label="Loading your numbers" />}
    </div>
  );
}

function Board({ stats, sniper }: { stats: Stats; sniper: SniperStatus | null }) {
  const t = stats.totals;
  const me = stats.me ?? { nickname: "Brian", weeklyGoal: 10, appliedThisWeek: t.applied_week };
  const goal = me.weeklyGoal || 10;
  const left = Math.max(0, goal - me.appliedThisWeek);
  const share = stats.share ?? { total: 0, remote_open: 0, sponsor_yes: 0, mid: 0, agentic: 0 };
  const best = stats.best ?? [];
  const skills = stats.skills ?? [];
  const inCv = skills.filter((skill) => skill.inCv).length;
  const maxSkill = Math.max(...skills.map((skill) => skill.n), 1);

  const emailTargets = t.email_targets ?? 0;
  const emailToday = t.email_targets_24h ?? 0;
  const newCompanies = t.new_company_targets ?? 0;

  const openness = [
    { label: "Sponsor a visa", n: share.sponsor_yes },
    { label: "Mid-level", n: share.mid },
    { label: "Agentic work", n: share.agentic },
    { label: "Remote, open to you", n: share.remote_open },
  ];

  return (
    <div className="board">
      <div className="board-row row-hero">
        <Card className="email-card" title="Email sniper" action={emailToday > 0 ? <Badge tone="positive">+{emailToday.toLocaleString("en")} today</Badge> : undefined}>
          <div className="email-hero">
            <span className="email-hero-mark" aria-hidden="true"><Icon name="mail" size={24} /></span>
            <div className="email-hero-text">
              <strong className="tabular">{emailTargets.toLocaleString("en")}</strong>
              <span>{emailTargets === 1 ? "job you can apply to by email" : "jobs you can apply to by email"}</span>
            </div>
          </div>
          <p className="card-note">Every address was found in the listing itself, with the sentence that states it. None are guessed.</p>
          <div className="card-foot">
            <Button variant="primary" href="#/targets">Open email targets</Button>
            <span className="card-meta tabular">{(t.pages_read_24h ?? 0).toLocaleString("en")} pages read today</span>
          </div>
        </Card>
        <Card className="goal-card" title="Weekly goal">
          <div className="goal">
            <GoalRing value={me.appliedThisWeek} goal={goal} />
            <div className="goal-text">
              <strong>{left === 0 ? "Goal reached this week" : `${left} to go this week`}</strong>
              <p>{me.appliedThisWeek} of {goal} applications sent since Monday.</p>
            </div>
          </div>
          <div className="card-foot">
            <Button variant="primary" href="#/targets">Review targets</Button>
            <Button variant="plain" href="#/settings">Change goal</Button>
          </div>
        </Card>
      </div>

      <div className="board-row row-status">
        <SniperCard sniper={sniper} />
        <Card className="new-card" title="New companies">
          <Stat value={newCompanies} label="Targets at startups and early-stage teams" size="lg" delta={`${percentOf(newCompanies, t.targets_open)}% of open targets`} />
          <Meter value={newCompanies} max={Math.max(t.targets_open, 1)} />
          <p className="card-note">Each one comes with the line that says the company is new.</p>
        </Card>
        <Card className="open-card" title="How open the market is to you" action={<span className="card-meta tabular">{share.total.toLocaleString("en")} targets this week</span>}>
          <ul className="open-grid">
            {openness.map((item, index) => (
              <li key={item.label}>
                <Stat value={`${percentOf(item.n, share.total)}%`} label={item.label} delta={`${item.n.toLocaleString("en")} of ${share.total.toLocaleString("en")}`} size="lg" />
                <Meter value={item.n} max={share.total} index={index} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Section title="Best matches today" action={<Button variant="plain" icon="chevronRight" href="#/targets">All targets</Button>}>
        {best.length === 0 ? (
          <Card label="Best matches"><EmptyState compact title="No fresh matches yet" description="Pip checks every source a few times a day. New roles land here first." /></Card>
        ) : (
          <ul className="best-grid">
            {best.slice(0, 3).map((job) => (
              <li key={job.id}>
                <a className="ui-card best-card" href={`#/targets/${encodeURIComponent(job.id)}`}>
                  <span className="best-top">
                    <Monogram name={job.company} size={32} />
                    <ScoreRing score={job.score} size={40} animate />
                  </span>
                  <span className="best-title">{job.title}</span>
                  {job.apply_email ? <span className="row-email"><Icon name="mail" size={12} />{job.apply_email}</span> : null}
                  <span className="best-meta"><Meta parts={[job.company, placeLabel(job.location), seniorityLabel(job.seniority), `${formatAge(job.posted_at)} ago`]} /></span>
                  <span className="best-foot">{job.new_company ? <Badge tone="accent">New company</Badge> : null}{scoreLabel(job.score)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="board-row row-skills">
        <Card title="Skills the market wants this week" action={skills.length ? <span className="card-meta tabular">{inCv} of {skills.length} in your CV</span> : undefined}>
          {skills.length === 0 ? <EmptyState compact title="No skill data yet" description="Skills appear once this week's targets are judged." /> : (
            <>
              {inCv === 0 ? (
                <p className="card-note">Your CV is not matched yet, so every skill reads as a gap. <a className="text-link" href="#/settings">Import your CV</a></p>
              ) : null}
              <ul className="meter-list is-two">
                {skills.slice(0, 12).map((skill, index) => (
                  <MeterRow key={skill.label} index={index} label={skill.label} value={skill.n} max={maxSkill} tone={skill.inCv ? "positive" : "neutral"}
                    aside={skill.inCv ? <Badge tone="positive">In CV</Badge> : <Badge tone="warning">Gap</Badge>} />
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card className="trend-card" title="Last 7 days">
          <WeekChart daily={stats.daily} />
        </Card>
      </div>

      <div className="board-row row-three">
        <Card title="Roles"><Breakdown items={stats.roles} /></Card>
        <Card title="Countries"><Breakdown items={stats.countries.map((item) => ({ ...item, label: countryName(item.label) }))} /></Card>
        <Card title="Levels"><Breakdown items={stats.levels.map((item) => ({ ...item, label: levelName(item.label), focus: item.label === "mid" }))} /></Card>
      </div>

      <div className="board-row row-pipeline">
        <Card title="Pipeline"><Funnel steps={stats.funnel} /></Card>
        <Card title="Most active companies" flush={stats.companies.length > 0}>
          {stats.companies.length === 0 ? <p className="card-note">No company has posted twice this week yet.</p> : (
            <ul className="row-list">
              {stats.companies.slice(0, 5).map((company) => (
                <li key={company.label}>
                  <CompanyRow label={company.label} n={company.n} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function CompanyRow({ label, n }: { label: string; n: number }) {
  return (
    <div className="ui-row">
      <span className="ui-row-leading"><Monogram name={label} size={24} /></span>
      <span className="ui-row-text"><span className="ui-row-title">{label}</span></span>
      <span className="ui-row-trailing tabular row-value">{n} {n === 1 ? "role" : "roles"}</span>
    </div>
  );
}

function Breakdown({ items }: { items: (StatCount & { focus?: boolean })[] }) {
  if (items.length === 0) return <p className="card-note">Nothing this week yet.</p>;
  const max = Math.max(...items.map((item) => item.n), 1);
  return (
    <ul className="meter-list">
      {items.slice(0, 5).map((item, index) => (
        <MeterRow key={item.label} index={index} label={item.label} value={item.n} max={max} display={item.n.toLocaleString("en")}
          tone={item.focus ? "accent" : "neutral"} aside={item.focus ? <Badge tone="accent">Your level</Badge> : undefined} />
      ))}
    </ul>
  );
}

function WeekChart({ daily }: { daily: Stats["daily"] }) {
  const max = Math.max(...daily.map((day) => day.discovered), 1);
  const posted = daily.reduce((sum, day) => sum + day.discovered, 0);
  const targeted = daily.reduce((sum, day) => sum + day.targeted, 0);
  if (posted === 0) return <EmptyState compact title="Quiet week so far" description="New roles show here as they land." />;
  return (
    <div className="week">
      <div className="week-stats">
        <Stat value={posted} label="Posted" />
        <Stat value={targeted} label="Targeted for you" />
      </div>
      <div className="week-bars" role="img" aria-label={`Last 7 days: ${posted} posted, ${targeted} targeted for you.`}>
        {daily.map((day, index) => {
          const date = new Date(`${day.day}T12:00:00`);
          return (
            <div className="week-day" key={day.day} style={{ "--i": index } as CSSProperties}>
              <div className="week-stack">
                <span className="week-bar is-posted" style={{ transform: `scaleY(${day.discovered / max})` }} />
                <span className="week-bar is-targeted" style={{ transform: `scaleY(${day.targeted / max})` }} />
              </div>
              <span className={`week-label ${index === daily.length - 1 ? "is-today" : ""}`}>{index === daily.length - 1 ? "Today" : WEEKDAY.format(date)}</span>
            </div>
          );
        })}
      </div>
      <p className="week-key"><span className="key is-posted" aria-hidden="true" />Posted<span className="key is-targeted" aria-hidden="true" />Targeted for you</p>
    </div>
  );
}

function Funnel({ steps }: { steps: StatCount[] }) {
  const max = Math.max(...steps.map((step) => step.n), 1);
  const applied = steps.find((step) => step.label === "Applied")?.n ?? 0;
  return (
    <>
      <ol className="meter-list funnel">
        {steps.map((step, index) => {
          const previous = steps[index - 1]?.n ?? 0;
          const rate = index > 0 && previous > 0 ? `${Math.round((step.n / previous) * 100)}%` : null;
          return <MeterRow key={step.label} index={index} label={step.label} value={step.n} max={max} display={step.n.toLocaleString("en")}
            aside={rate ? <span className="meter-note tabular">{rate} of previous</span> : undefined} />;
        })}
      </ol>
      {applied === 0 ? <p className="card-note">No applications yet. Open a target and press Draft email to send your first.</p> : null}
    </>
  );
}

const SNIPER_STATE: Record<SniperStatus["state"], { label: string; tone: "positive" | "neutral" | "warning" }> = {
  running: { label: "Running", tone: "positive" },
  idle: { label: "Idle", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
};

/** What the web sniper is doing right now, or why it is not. */
function SniperCard({ sniper }: { sniper: SniperStatus | null }) {
  const state = sniper ? SNIPER_STATE[sniper.state] : null;
  return (
    <Card className="sniper-card" title="Sniper" action={state ? <Badge tone={state.tone}>{state.label}</Badge> : <Badge>Checking</Badge>}>
      {!sniper ? <p className="card-note">Reading the sniper status.</p> : sniper.state === "running" ? (
        <dl className="facts">
          <div><dt>Searching</dt><dd>{sniper.lastQuery || "Starting up"}</dd></div>
          <div><dt>Found</dt><dd className="tabular">{(sniper.lastFound ?? 0).toLocaleString("en")} {sniper.lastFound === 1 ? "listing" : "listings"}</dd></div>
          {sniper.provider ? <div><dt>Using</dt><dd>{sniper.provider}</dd></div> : null}
          {sniper.at ? <div><dt>Updated</dt><dd>{agoPhrase(sniper.at)}</dd></div> : null}
        </dl>
      ) : (
        <>
          <p className="card-note">{sniper.reason || (sniper.state === "paused" ? "Paused." : "Waiting for its next run.")}</p>
          {sniper.state === "idle" ? <div className="card-foot"><Button variant="plain" icon="chevronRight" href="#/settings/search">Add a search key</Button></div> : null}
        </>
      )}
    </Card>
  );
}
