import { useEffect, useMemo, useState } from "react";
import * as api from "../api.ts";
import type { Evidence, JobAction, JobTarget, TargetsQuery } from "../types.ts";
import {
  contactKindLabel, filterTargets, formatAge, formatDateTime, htmlToText, humanize, modeLabel, scoreColor, scoreLabel,
  shortLocation, sponsorshipLabel, toPercent, usableContacts,
} from "../utils.ts";
import { EmptyState } from "../components/States.tsx";

interface Props {
  targets: JobTarget[];
  selectedId: string | null;
  onAction: (job: JobTarget, action: JobAction) => Promise<boolean>;
  onExport: (format: "csv" | "xlsx") => void;
}

const emptyQuery: TargetsQuery = { age: "", country: "", workMode: "", sponsorship: "", hasEmail: false, status: "", search: "" };
const PAGE = 100;
const DESKTOP = "(min-width: 1024px)";

const useDesktop = () => {
  const [desktop, setDesktop] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP);
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
};

const goTo = (id: string | null) => {
  window.location.hash = id ? `#/targets/${encodeURIComponent(id)}` : "#/targets";
};

const activeFilterCount = (query: TargetsQuery) =>
  [query.age, query.country, query.workMode, query.sponsorship].filter(Boolean).length + (query.hasEmail ? 1 : 0);

export function TargetsScreen({ targets, selectedId, onAction, onExport }: Props) {
  const desktop = useDesktop();
  const [query, setQuery] = useState<TargetsQuery>(emptyQuery);
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtered = useMemo(() => filterTargets(targets, query), [targets, query]);
  const countries = useMemo(() => [...new Set(targets.map((job) => job.country).filter(Boolean))].sort(), [targets]);
  const visible = filtered.slice(0, limit);

  const fromHash = selectedId ? targets.find((job) => job.id === selectedId) ?? null : null;
  const selected = fromHash ?? (desktop ? filtered[0] ?? null : null);
  const showDetail = Boolean(selected) && (desktop || Boolean(fromHash));

  const updateQuery = (key: keyof TargetsQuery, value: string | boolean) => {
    setQuery((current) => ({ ...current, [key]: value }));
    setLimit(PAGE);
  };

  const runAction = async (job: JobTarget, action: JobAction) => {
    const index = filtered.findIndex((item) => item.id === job.id);
    const succeeded = await onAction(job, action);
    if (succeeded && (action === "skip" || action === "blacklist")) {
      const next = filtered.slice(index + 1).find((item) => action === "skip" ? item.id !== job.id : item.companyId !== job.companyId);
      goTo(desktop && next ? next.id : null);
    }
    return succeeded;
  };

  const filterCount = activeFilterCount(query);

  return (
    <div className={`targets ${showDetail && !desktop ? "is-detail" : ""}`}>
      <section className="targets-list" aria-label="Targets">
        <header className="list-head">
          <div className="list-title">
            <h1>Targets</h1>
            <span className="muted tabular">{filtered.length} of {targets.length}</span>
          </div>
          <div className="list-head-actions">
            <button className="button button-secondary" onClick={() => onExport("csv")}>CSV</button>
            <button className="button button-secondary" onClick={() => onExport("xlsx")}>XLSX</button>
          </div>
        </header>
        <div className="search-row">
          <label className="sr-only" htmlFor="target-search">Search targets</label>
          <input id="target-search" type="search" value={query.search ?? ""} onChange={(event) => updateQuery("search", event.target.value)} placeholder="Search company, role, location" />
          <button className="button button-secondary filter-toggle" aria-expanded={filtersOpen} aria-controls="target-filters" onClick={() => setFiltersOpen((open) => !open)}>
            {filterCount ? `Filters (${filterCount})` : "Filters"}
          </button>
        </div>
        <div id="target-filters" className={`filters ${filtersOpen ? "is-open" : ""}`}>
          <label className="field">
            <span>Posted</span>
            <select value={query.age ?? ""} onChange={(event) => updateQuery("age", event.target.value)}>
              <option value="">Any time</option>
              <option value="24h">Last 24 hours</option>
              <option value="72h">Last 72 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </label>
          <label className="field">
            <span>Country</span>
            <select value={query.country ?? ""} onChange={(event) => updateQuery("country", event.target.value)}>
              <option value="">All countries</option>
              {countries.map((country) => <option key={country} value={country}>{country}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Work mode</span>
            <select value={query.workMode ?? ""} onChange={(event) => updateQuery("workMode", event.target.value)}>
              <option value="">Any mode</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </label>
          <label className="field">
            <span>Sponsorship</span>
            <select value={query.sponsorship ?? ""} onChange={(event) => updateQuery("sponsorship", event.target.value)}>
              <option value="">Any</option>
              <option value="yes">Sponsors visa</option>
              <option value="registry_hit">Sponsor registry</option>
              <option value="unknown">Unknown</option>
              <option value="no">No sponsorship</option>
            </select>
          </label>
          <label className="check-field">
            <input type="checkbox" checked={Boolean(query.hasEmail)} onChange={(event) => updateQuery("hasEmail", event.target.checked)} />
            <span>Has contact email</span>
          </label>
          <button className="button button-quiet" disabled={!filterCount && !query.search} onClick={() => { setQuery(emptyQuery); setLimit(PAGE); }}>Reset</button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No targets match" description="Widen the filters or wait for the next crawl cycle." />
        ) : (
          <ul className="target-rows">
            {visible.map((job) => <TargetRow key={job.id} job={job} active={selected?.id === job.id} />)}
            {filtered.length > limit ? (
              <li className="more-row"><button className="button button-secondary" onClick={() => setLimit((current) => current + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</button></li>
            ) : null}
          </ul>
        )}
      </section>

      {showDetail && selected ? (
        <TargetDetail key={selected.id} job={selected} desktop={desktop} onAction={runAction} />
      ) : desktop ? (
        <section className="targets-detail"><EmptyState title="Nothing selected" description="Pick a target to see its evidence and contacts." /></section>
      ) : null}
    </div>
  );
}

function TargetRow({ job, active }: { job: JobTarget; active: boolean }) {
  const hasEmail = usableContacts(job).length > 0;
  return (
    <li>
      <a className={`target-row ${active ? "is-active" : ""}`} href={`#/targets/${encodeURIComponent(job.id)}`} aria-current={active ? "true" : undefined}>
        <span className="target-row-main">
          <span className="target-company">{job.companyName}</span>
          <span className="target-title">{job.title}</span>
          <span className="tags">
            <span className="tag">{modeLabel(job)}</span>
            {job.location ? <span className="tag tag-plain" title={job.location}>{shortLocation(job.location)}</span> : null}
            <span className={`tag ${job.sponsorship === "yes" || job.sponsorship === "registry_hit" ? "tag-good" : ""}`}>{sponsorshipLabel(job.sponsorship)}</span>
            <span className={`tag ${hasEmail ? "tag-good" : "tag-plain"}`}>{hasEmail ? "Email" : "No email"}</span>
            {job.jevVerified ? null : <span className="tag tag-warn">Unverified by Jev</span>}
          </span>
        </span>
        <span className="target-row-side">
          <span className={`score ${scoreColor(job.score)}`} aria-label={`Score ${job.score} of 100`}>{job.score}</span>
          <span className="score-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0, Math.min(100, job.score)) / 100})` }} /></span>
          <span className="muted tabular">{formatAge(job.postedAt || job.firstSeenAt)}</span>
        </span>
      </a>
    </li>
  );
}

const BREAKDOWN_LABELS: Record<string, string> = {
  roleFit: "Role fit", seniority: "Seniority", modeVisa: "Mode and visa", freshness: "Freshness", skillOverlapCv: "Skill overlap with CV",
};

function TargetDetail({ job: summary, desktop, onAction }: { job: JobTarget; desktop: boolean; onAction: (job: JobTarget, action: JobAction) => Promise<boolean> }) {
  const [full, setFull] = useState<JobTarget | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<JobAction | null>(null);

  useEffect(() => {
    let live = true;
    api.getTarget(summary.id)
      .then((record) => { if (live) setFull(record); })
      .catch((caught) => { if (live) setLoadError(caught instanceof Error ? caught.message : "Could not load the full record."); });
    return () => { live = false; };
  }, [summary.id]);

  const job: JobTarget = full ? { ...summary, ...full } : summary;
  const contacts = job.contacts ?? [];
  const jd = useMemo(() => htmlToText(job.jdText), [job.jdText]);

  const act = async (action: JobAction) => {
    setBusy(action);
    try { await onAction(job, action); } finally { setBusy(null); }
  };

  return (
    <section className="targets-detail" aria-label={`${job.companyName} details`}>
      {desktop ? null : <a className="button button-quiet back-link" href="#/targets">Back to targets</a>}
      <header className="detail-head">
        <p className="muted">{job.companyName}{job.location ? ` · ${job.location}` : ""}</p>
        <h2>{job.title}</h2>
        <div className="tags">
          <span className="tag">{modeLabel(job)}</span>
          <span className={`tag ${job.sponsorship === "yes" || job.sponsorship === "registry_hit" ? "tag-good" : ""}`}>{sponsorshipLabel(job.sponsorship)}</span>
          <span className="tag tag-plain">Posted {formatAge(job.postedAt || job.firstSeenAt)} ago</span>
          <span className="tag tag-plain">{humanize(job.status)}</span>
          {job.translated ? <span className="tag">Translated from original</span> : null}
          {job.jevVerified ? <span className="tag tag-good">Verified by Jev</span> : <span className="tag tag-warn">Unverified by Jev</span>}
        </div>
        {job.jevVerified ? null : (
          <div className="notice notice-warning" role="status">
            <strong>Unverified by Jev</strong>
            <span>You can prepare a draft, but nothing is sent until Jev confirms this job.</span>
          </div>
        )}
        {job.skipReason ? <p className="muted">Skip reason: {job.skipReason}</p> : null}
        <div className="detail-actions">
          <button className="button button-primary" disabled={busy !== null} onClick={() => act("draft")}>{busy === "draft" ? "Drafting..." : "Draft email"}</button>
          <a className="button button-secondary" href={job.applyUrl || job.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => { void onAction(job, "open"); }}>Open apply page</a>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => act("skip")}>{busy === "skip" ? "Skipping..." : "Skip"}</button>
          <button className="button button-danger" disabled={busy !== null} onClick={() => act("blacklist")}>{busy === "blacklist" ? "Blacklisting..." : "Blacklist company"}</button>
        </div>
      </header>

      <div className="detail-section">
        <div className="detail-section-head">
          <h3>Score</h3>
          <span className={`score ${scoreColor(job.score)}`}>{job.score}<span className="muted"> / 100 · {scoreLabel(job.score)}</span></span>
        </div>
        <dl className="breakdown">
          {Object.entries(job.scoreBreakdown ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{BREAKDOWN_LABELS[key] ?? humanize(key)}</dt>
              <dd>
                <span className="meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(100, toPercent(value)) / 100})` }} /></span>
                <span className="tabular">{toPercent(value)}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <QuoteSection title="Why it matched" quotes={job.aiEvidence} empty="No AI evidence recorded." />
      <QuoteSection title="Language evidence" quotes={job.languageEvidence} empty="No language evidence recorded." />

      <div className="detail-section">
        <h3>Contacts</h3>
        {contacts.length === 0 ? <p className="muted">No contact email found. Use the apply page.</p> : (
          <ul className="record-list">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <div className="record-line">
                  <a className="text-link" href={`mailto:${contact.email}`}>{contact.email}</a>
                  <span className={`tag ${contact.jevVerdict === "verified" ? "tag-good" : contact.jevVerdict === "invalid" ? "tag-bad" : "tag-warn"}`}>{humanize(contact.jevVerdict)}</span>
                  <span className="tag tag-plain">{contactKindLabel(contact.kind)}</span>
                </div>
                {contact.name || contact.role ? <p className="muted">{[contact.name, contact.role].filter(Boolean).join(", ")}</p> : null}
                {contact.sourceQuote ? <p className="quote-text">"{htmlToText(contact.sourceQuote)}"</p> : null}
                {contact.sourceUrl ? <a className="text-link small" href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Source page</a> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-section">
        <h3>Jev decisions</h3>
        {(job.decisions ?? []).length === 0 ? <p className="muted">{full ? "No Jev decisions recorded yet." : "Loading decisions."}</p> : (
          <ul className="record-list">
            {job.decisions.map((decision) => (
              <li key={decision.id}>
                <div className="record-line">
                  <strong>{humanize(decision.decisionId)}</strong>
                  <span className="tag tag-plain">{humanize(decision.verdict)}</span>
                  <span className="muted tabular">{Math.round(decision.confidence * 100)}%</span>
                </div>
                {decision.input ? <p className="muted clamp">{htmlToText(decision.input)}</p> : null}
                <p className="muted small">{formatDateTime(decision.createdAt, "")}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-section">
        <h3>Job description</h3>
        {loadError ? <p className="muted">{loadError}</p> : null}
        {jd ? (
          <details className="jd">
            <summary>Show full description</summary>
            <p className="jd-text">{jd}</p>
          </details>
        ) : <p className="muted">{full ? "No description captured." : "Loading description."}</p>}
        {job.sourceUrl ? <a className="text-link" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">Open source listing</a> : null}
      </div>
    </section>
  );
}

function QuoteSection({ title, quotes, empty }: { title: string; quotes: Evidence[] | undefined; empty: string }) {
  const list = quotes ?? [];
  return (
    <div className="detail-section">
      <h3>{title}</h3>
      {list.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="quote-list">
          {list.map((evidence, index) => (
            <li key={`${index}-${evidence.quote.slice(0, 24)}`}>
              <blockquote className="quote-text">"{htmlToText(evidence.quote)}"</blockquote>
              {evidence.context ? <p className="muted small">{evidence.context}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
