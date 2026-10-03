import { useMemo, useState } from "react";
import type { JobAction, JobTarget, TargetsQuery } from "../types.ts";
import { filterTargets, formatAge, formatDateTime, scoreColor, scoreLabel } from "../utils.ts";
import { EmptyState, ErrorState, Notice, PageHeader } from "../components/States.tsx";

interface Props {
  targets: JobTarget[];
  loading: boolean;
  error: string | null;
  onAction: (job: JobTarget, action: JobAction) => Promise<boolean>;
  onExport: (format: "csv" | "xlsx") => void;
}

const emptyQuery: TargetsQuery = { age: "", country: "", workMode: "", sponsorship: "", hasEmail: false, status: "", search: "" };

export function TargetsScreen({ targets, loading, error, onAction, onExport }: Props) {
  const [query, setQuery] = useState<TargetsQuery>(emptyQuery);
  const [selected, setSelected] = useState<JobTarget | null>(null);
  const filtered = useMemo(() => filterTargets(targets, query), [targets, query]);
  const countries = useMemo(() => [...new Set(targets.map((job) => job.country))].sort(), [targets]);

  const updateQuery = (key: keyof TargetsQuery, value: string | boolean) => setQuery((current) => ({ ...current, [key]: value }));
  const runAction = async (job: JobTarget, action: JobAction) => {
    const succeeded = await onAction(job, action);
    if (action !== "open" && succeeded) setSelected(null);
    return succeeded;
  };

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Ranked work ledger"
        title="Targets"
        description="Inspect evidence, confirm fit, and move the strongest opportunity into outreach."
        actions={<>
          <button className="button button-secondary" onClick={() => onExport("csv")}>Export CSV</button>
          <button className="button button-secondary" onClick={() => onExport("xlsx")}>Export XLSX</button>
        </>}
      />
      {error ? <Notice tone="warning">The local API is not responding. Start JobSniper and refresh.</Notice> : null}
      <section className="filter-bar" aria-label="Target filters">
        <div className="field field-search">
          <label htmlFor="target-search">Search</label>
          <input id="target-search" value={query.search ?? ""} onChange={(event) => updateQuery("search", event.target.value)} placeholder="Company, role, location" />
        </div>
        <div className="field">
          <label htmlFor="target-age">Age</label>
          <select id="target-age" value={query.age ?? ""} onChange={(event) => updateQuery("age", event.target.value)}>
            <option value="">Any age</option>
            <option value="24h">Under 24 hours</option>
            <option value="72h">Under 72 hours</option>
            <option value="7d">Under 7 days</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="target-country">Country</label>
          <select id="target-country" value={query.country ?? ""} onChange={(event) => updateQuery("country", event.target.value)}>
            <option value="">All countries</option>
            {countries.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="target-mode">Work mode</label>
          <select id="target-mode" value={query.workMode ?? ""} onChange={(event) => updateQuery("workMode", event.target.value)}>
            <option value="">Any mode</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="target-sponsorship">Sponsorship</label>
          <select id="target-sponsorship" value={query.sponsorship ?? ""} onChange={(event) => updateQuery("sponsorship", event.target.value)}>
            <option value="">Any label</option>
            <option value="yes">Available</option>
            <option value="unknown">Unknown</option>
            <option value="no">Not available</option>
          </select>
        </div>
        <label className="check-field">
          <span className="checkbox-wrap">
            <input type="checkbox" checked={Boolean(query.hasEmail)} onChange={(event) => updateQuery("hasEmail", event.target.checked)} />
            <span className="checkbox-visual" aria-hidden="true" />
          </span>
          <span>Has verified email</span>
        </label>
        <button className="button button-quiet" onClick={() => setQuery(emptyQuery)}>Reset</button>
      </section>

      <div className="ledger-toolbar">
        <div><strong>{filtered.length}</strong> ranked targets</div>
        <span className="muted">Sorted by match score</span>
      </div>

      {loading ? <div className="ledger-loading"><span className="loader" aria-hidden="true" /> Loading targets</div> : null}
      {!loading && filtered.length === 0 ? <EmptyState title="No targets match these filters" description="Widen the filters or wait for the next crawl cycle." /> : null}
      {!loading && filtered.length > 0 ? (
        <div className="ledger-table-wrap scroll-x">
          <table className="ledger-table">
            <thead>
              <tr>
                <th scope="col">Company / role</th>
                <th scope="col">Location</th>
                <th scope="col">Sponsorship</th>
                <th scope="col">Score</th>
                <th scope="col">Age</th>
                <th scope="col">Contact</th>
                <th scope="col">Inspect</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id} className="ledger-row" onClick={() => setSelected(job)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(job); }}>
                  <td>
                    <div className="record-primary">
                      <strong>{job.companyName}</strong>
                      <span>{job.title}</span>
                      <code>{job.externalId}</code>
                    </div>
                  </td>
                  <td><span className="record-secondary">{job.location}</span><span className={`work-tag work-${job.workMode}`}>{job.workMode}</span></td>
                  <td><span className={`status-chip status-${job.sponsorship}`}>{job.sponsorship === "yes" ? "Sponsorship" : job.sponsorship === "no" ? "No sponsorship" : "Unknown"}</span></td>
                  <td><div className={`score-cell ${scoreColor(job.score)}`}><strong>{job.score}</strong><span>{scoreLabel(job.score)}</span></div></td>
                  <td><span className="mono">{formatAge(job.firstSeenAt)}</span></td>
                  <td>{job.contacts.some((contact) => contact.jevVerdict === "verified") ? <span className="contact-yes">Verified</span> : <span className="muted">No email</span>}</td>
                  <td><button className="button button-quiet table-action" onClick={(event) => { event.stopPropagation(); setSelected(job); }}>Inspect</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? <TargetDrawer job={selected} onClose={() => setSelected(null)} onAction={runAction} /> : null}
    </div>
  );
}

function TargetDrawer({ job, onClose, onAction }: { job: JobTarget; onClose: () => void; onAction: (job: JobTarget, action: JobAction) => Promise<boolean> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: JobAction) => {
    setBusy(action);
    try {
      if (action === "open") window.open(job.applyUrl, "_blank", "noopener,noreferrer");
      else await onAction(job, action);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`${job.companyName} target details`}>
      <button className="drawer-backdrop" aria-label="Close target details" onClick={onClose} />
      <aside className="detail-drawer">
        <header className="drawer-header">
          <div>
            <p className="mono">{job.externalId}</p>
            <h2>{job.title}</h2>
            <p>{job.companyName} · {job.location}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close target details">×</button>
        </header>
        <div className="drawer-scroll">
          <section className="drawer-section">
            <div className="drawer-section-heading"><h3>Match score</h3><strong className={`score-number ${scoreColor(job.score)}`}>{job.score}/100</strong></div>
            <div className="breakdown-list">
              {Object.entries(job.scoreBreakdown).map(([key, value]) => <div key={key}><span>{key === "skillOverlapCv" ? "Skill overlap CV" : key === "modeVisa" ? "Mode / visa" : key}</span><strong>{value}</strong></div>)}
            </div>
          </section>
          <section className="drawer-section">
            <h3>AI evidence</h3>
            {job.aiEvidence.map((evidence) => <blockquote key={evidence.quote}><p>“{evidence.quote}”</p><cite>{evidence.context ?? "source"}</cite></blockquote>)}
          </section>
          <section className="drawer-section">
            <h3>Job description</h3>
            <p className="jd-text">{job.jdText}</p>
            <a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer">Open source record</a>
          </section>
          <section className="drawer-section">
            <h3>Contact provenance</h3>
            {job.contacts.length === 0 ? <p className="muted">No public email found. Apply link and recruiter search remain available.</p> : job.contacts.map((contact) => (
              <div className="contact-record" key={contact.id}>
                <div><strong>{contact.name}</strong><span>{contact.role}</span></div>
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
                <p>“{contact.sourceQuote}”</p>
                <a className="text-link" href={contact.sourceUrl} target="_blank" rel="noreferrer">Source URL</a>
              </div>
            ))}
          </section>
          <section className="drawer-section">
            <h3>Jev decisions</h3>
            <div className="decision-list">{job.decisions.map((decision) => <div key={decision.id}><div><strong>{decision.decisionId}</strong><span className="mono">{Math.round(decision.confidence * 100)}%</span></div><p>{decision.verdict}</p><small>{decision.input}</small></div>)}</div>
          </section>
        </div>
        <footer className="drawer-actions">
          <button className="button button-secondary" disabled={busy !== null} onClick={() => act("skip")}>{busy === "skip" ? "Skipping..." : "Skip"}</button>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => act("blacklist")}>{busy === "blacklist" ? "Blacklisting..." : "Blacklist"}</button>
          <button className="button button-primary" disabled={busy !== null} onClick={() => act("draft")}>{busy === "draft" ? "Creating..." : "Create draft"}</button>
          <button className="button button-secondary" onClick={() => act("open")}>Open apply link</button>
        </footer>
      </aside>
    </div>
  );
}
