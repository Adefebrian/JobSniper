import { useEffect, useMemo, useState } from "react";
import * as api from "../api.ts";
import type { Evidence, Feedback, JobAction, JobTarget, TargetsQuery } from "../types.ts";
import {
  agenticLabel, contactKindLabel, filterTargets, FIT_LABELS, fitSummary, fitWord, formatAge, formatDateTime, htmlToText, humanize,
  modeLabel, parseDate, scoreColor, scoreLabel, seniorityLabel, shortLocation, sponsorshipLabel, toPercent, usableContacts,
} from "../utils.ts";
import { EmptyState } from "../components/States.tsx";
import { Icon, Spinner } from "../components/Icon.tsx";

type FeedbackFn = (job: JobTarget, verdict: Feedback | "clear", note?: string) => Promise<boolean>;

interface Props {
  targets: JobTarget[];
  selectedId: string | null;
  onAction: (job: JobTarget, action: JobAction) => Promise<boolean>;
  onFeedback: FeedbackFn;
  onTargetUpdate: (job: JobTarget) => void;
  onExport: (format: "csv" | "xlsx") => void;
}

type Sort = "score" | "agentic" | "newest";

const emptyQuery: TargetsQuery = { age: "", country: "", workMode: "", sponsorship: "", hasEmail: false, status: "", search: "" };
const PAGE = 100;
const DESKTOP = "(min-width: 1024px)";
const COLLAPSE_MS = 200;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const postedTime = (job: JobTarget) => (parseDate(job.postedAt) ?? parseDate(job.firstSeenAt))?.getTime() ?? 0;

const sorters: Record<Sort, (a: JobTarget, b: JobTarget) => number> = {
  score: (a, b) => b.score - a.score,
  agentic: (a, b) => (b.scoreBreakdown?.agenticFocus ?? -1) - (a.scoreBreakdown?.agenticFocus ?? -1) || b.score - a.score,
  newest: (a, b) => postedTime(b) - postedTime(a),
};

export function TargetsScreen({ targets, selectedId, onAction, onFeedback, onTargetUpdate, onExport }: Props) {
  const desktop = useDesktop();
  const [query, setQuery] = useState<TargetsQuery>(emptyQuery);
  const [seniority, setSeniority] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<JobTarget | null>(null);

  const filtered = useMemo(() => {
    const list = filterTargets(targets, query).filter((job) => !seniority || job.seniority === seniority);
    return sort === "score" ? list : [...list].sort(sorters[sort]);
  }, [targets, query, seniority, sort]);
  const countries = useMemo(() => [...new Set(targets.map((job) => job.country).filter(Boolean))].sort(), [targets]);
  const visible = filtered.slice(0, limit);

  const fromHash = selectedId ? targets.find((job) => job.id === selectedId) ?? null : null;
  const selected = fromHash ?? (desktop ? filtered[0] ?? null : null);
  const showDetail = Boolean(selected) && (desktop || Boolean(fromHash));

  const updateQuery = (key: keyof TargetsQuery, value: string | boolean) => {
    setQuery((current) => ({ ...current, [key]: value }));
    setLimit(PAGE);
  };
  const filterCount = [query.age, query.country, query.workMode, query.sponsorship, seniority].filter(Boolean).length + (query.hasEmail ? 1 : 0);
  const resetFilters = () => { setQuery(emptyQuery); setSeniority(""); setSort("score"); setLimit(PAGE); };

  /** Collapses the row first, then runs the request; the row comes back if it fails. */
  const removeWith = async (job: JobTarget, task: () => Promise<boolean>, sameCompany = false) => {
    const index = filtered.findIndex((item) => item.id === job.id);
    const next = filtered.slice(index + 1).find((item) => sameCompany ? item.companyId !== job.companyId : item.id !== job.id)
      ?? filtered.slice(0, Math.max(0, index)).reverse().find((item) => sameCompany ? item.companyId !== job.companyId : true);
    const ids = sameCompany ? filtered.filter((item) => item.companyId === job.companyId).map((item) => item.id) : [job.id];
    setLeaving((current) => new Set([...current, ...ids]));
    await wait(COLLAPSE_MS);
    const succeeded = await task();
    setLeaving((current) => {
      const copy = new Set(current);
      ids.forEach((id) => copy.delete(id));
      return copy;
    });
    if (succeeded && selected && ids.includes(selected.id)) goTo(desktop && next ? next.id : null);
    return succeeded;
  };

  const runAction = async (job: JobTarget, action: JobAction) => {
    if (action === "skip") return removeWith(job, () => onAction(job, action));
    if (action === "blacklist") return removeWith(job, () => onAction(job, action), true);
    return onAction(job, action);
  };

  const feedback: FeedbackFn = async (job, verdict, note) => {
    if (verdict !== "dislike") return onFeedback(job, verdict, note);
    const succeeded = await removeWith(job, () => onFeedback(job, "dislike"));
    if (succeeded) setHidden(job);
    return succeeded;
  };

  return (
    <div className={`targets ${showDetail && !desktop ? "is-detail" : ""}`}>
      <header className="targets-toolbar" data-tauri-drag-region>
        <div className="list-title" data-tauri-drag-region>
          <h1>Targets</h1>
          <span className="muted tabular">{filtered.length}</span>
        </div>
        <label className="sr-only" htmlFor="target-search">Search targets</label>
        <input id="target-search" className="toolbar-search" type="search" value={query.search ?? ""} onChange={(event) => updateQuery("search", event.target.value)} placeholder="Search role, company, location" />
        <button className={`button button-secondary filter-toggle ${filtersOpen ? "is-on" : ""}`} aria-expanded={filtersOpen} aria-controls="target-filters" onClick={() => setFiltersOpen((open) => !open)}>
          {filterCount ? `Filters ${filterCount}` : "Filters"}
        </button>
        <div className="toolbar-end">
          <button className="button button-quiet button-small" onClick={() => onExport("csv")}>CSV</button>
          <button className="button button-quiet button-small" onClick={() => onExport("xlsx")}>XLSX</button>
        </div>
      </header>
      <section className="targets-list" aria-label="Targets">
        <div id="target-filters" className={`filters ${filtersOpen ? "is-open" : ""}`}>
          <div className="segmented segmented-full" role="radiogroup" aria-label="Work mode">
            {[["", "Any"], ["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]].map(([value, label]) => (
              <button key={value} role="radio" aria-checked={(query.workMode ?? "") === value} className={(query.workMode ?? "") === value ? "active" : undefined} onClick={() => updateQuery("workMode", value ?? "")}>{label}</button>
            ))}
          </div>
          <label className="field">
            <span>Level</span>
            <select value={seniority} onChange={(event) => { setSeniority(event.target.value); setLimit(PAGE); }}>
              <option value="">Any level</option>
              <option value="mid">Mid-level</option>
              <option value="early">Junior</option>
              <option value="senior">Senior</option>
              <option value="lead">Lead</option>
            </select>
          </label>
          <label className="field">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="score">Best match</option>
              <option value="agentic">Agentic focus</option>
              <option value="newest">Newest</option>
            </select>
          </label>
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
            <span>Sponsorship</span>
            <select value={query.sponsorship ?? ""} onChange={(event) => updateQuery("sponsorship", event.target.value)}>
              <option value="">Any</option>
              <option value="yes">Sponsors visa</option>
              <option value="registry_hit">Sponsor registry</option>
              <option value="unknown">Unknown</option>
              <option value="no">No sponsorship</option>
            </select>
          </label>
          <label className="toggle-field">
            <span>Has contact email</span>
            <input type="checkbox" role="switch" className="switch" checked={Boolean(query.hasEmail)} onChange={(event) => updateQuery("hasEmail", event.target.checked)} />
          </label>
          <button className="button button-quiet" disabled={!filterCount && !query.search && sort === "score"} onClick={resetFilters}>Reset</button>
        </div>
        {hidden ? <HiddenNote job={hidden} onSave={(note) => onFeedback(hidden, "dislike", note)} onClose={() => setHidden(null)} /> : null}

        {filtered.length === 0 ? (
          <EmptyState title="No targets match" description="Widen the filters or wait for the next crawl cycle." />
        ) : (
          <ul className="target-rows">
            {visible.map((job) => (
              <TargetRow key={job.id} job={job} active={selected?.id === job.id} leaving={leaving.has(job.id)} onFeedback={feedback} />
            ))}
            {filtered.length > limit ? (
              <li className="more-row"><button className="button button-secondary" onClick={() => setLimit((current) => current + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</button></li>
            ) : null}
          </ul>
        )}
      </section>

      {showDetail && selected ? (
        <TargetDetail key={selected.id} job={selected} desktop={desktop} onAction={runAction} onFeedback={feedback} onTargetUpdate={onTargetUpdate} />
      ) : desktop ? (
        <section className="targets-detail"><EmptyState title="Nothing selected" description="Pick a target to see why it fits and who to contact." /></section>
      ) : null}
    </div>
  );
}

function FeedbackButtons({ job, onFeedback }: { job: JobTarget; onFeedback: FeedbackFn }) {
  const liked = job.feedback === "like";
  return (
    <div className="feedback-buttons">
      <button className={`icon-button ${liked ? "is-on" : ""}`} aria-pressed={liked} aria-label={liked ? `Remove like from ${job.title}` : `Like ${job.title}`} title={liked ? "Liked" : "Like"}
        onClick={() => onFeedback(job, liked ? "clear" : "like")}>
        <Icon name="thumb" filled={liked} />
      </button>
      <button className="icon-button" aria-label={`Dislike and hide ${job.title}`} title="Dislike and hide" onClick={() => onFeedback(job, "dislike")}>
        <Icon name="thumb" flip />
      </button>
    </div>
  );
}

function TargetRow({ job, active, leaving, onFeedback }: { job: JobTarget; active: boolean; leaving: boolean; onFeedback: FeedbackFn }) {
  const hasEmail = usableContacts(job).length > 0;
  const agentic = agenticLabel(job.scoreBreakdown?.agenticFocus);
  const agenticHigh = toPercent(job.scoreBreakdown?.agenticFocus ?? 0) >= 70;
  const remote = job.workMode === "remote";
  const sponsors = job.sponsorship === "yes" || job.sponsorship === "registry_hit";
  return (
    <li className={`target-item ${leaving ? "is-leaving" : ""}`} aria-hidden={leaving || undefined}>
      <div className="target-item-inner">
        <div className={`target-row-wrap ${active ? "is-active" : ""}`}>
          <a className="target-row" href={`#/targets/${encodeURIComponent(job.id)}`} aria-current={active ? "true" : undefined}>
            <span className="row-line1">
              <span className="target-title">{job.title}</span>
              <span className={`score ${scoreColor(job.score)}`} aria-label={`Score ${job.score} of 100`}>{job.score}</span>
            </span>
            <span className="row-line2">
              <span className="row-meta">{[job.companyName, job.location ? shortLocation(job.location) : "", formatAge(job.postedAt || job.firstSeenAt)].filter(Boolean).join(" · ")}</span>
              {hasEmail ? <span className="mail-state" title="Has contact email" aria-label="Has contact email"><Icon name="mail" size={14} /></span> : null}
              {job.jevVerified ? null : <span className="text-warn">Unverified</span>}
            </span>
            <span className="tags">
              <span className={`tag ${remote ? "tag-good" : ""}`}>{modeLabel(job)}</span>
              <span className="tag">{seniorityLabel(job.seniority)}</span>
              {sponsors ? <span className="tag tag-good">{sponsorshipLabel(job.sponsorship)}</span>
                : agentic ? <span className={`tag ${agenticHigh ? "tag-good" : ""}`}>{agentic}</span> : null}
            </span>
          </a>
          <FeedbackButtons job={job} onFeedback={onFeedback} />
        </div>
      </div>
    </li>
  );
}

function HiddenNote({ job, onSave, onClose }: { job: JobTarget; onSave: (note: string) => Promise<boolean>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="hidden-note" onSubmit={async (event) => { event.preventDefault(); if (note.trim() && await onSave(note.trim())) setSaved(true); }}>
      <p><strong>Hidden.</strong> <span className="muted">{saved ? "Thanks, Jev will use that reason." : `Why not ${job.title}? Optional.`}</span></p>
      {saved ? null : (
        <div className="input-row">
          <label className="sr-only" htmlFor="dislike-note">Reason</label>
          <input id="dislike-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Too senior, not agentic, on-site..." />
          <button className="button button-secondary" type="submit" disabled={!note.trim()}>Save</button>
        </div>
      )}
      <button className="button button-quiet hidden-note-close" type="button" onClick={onClose}>Dismiss</button>
    </form>
  );
}

const TAILOR_ERRORS: Record<string, string> = {
  cv_missing: "Import your CV in Settings first.",
  llm_budget_cap: "The monthly LLM budget cap is reached. Raise it in Settings to tailor more CVs.",
  luna_credentials_missing: "The OpenAI API key is not set. Add it in Settings, Connections.",
};

function TargetDetail({ job: summary, desktop, onAction, onFeedback, onTargetUpdate }: {
  job: JobTarget;
  desktop: boolean;
  onAction: (job: JobTarget, action: JobAction) => Promise<boolean>;
  onFeedback: FeedbackFn;
  onTargetUpdate: (job: JobTarget) => void;
}) {
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

  const job: JobTarget = full ? { ...full, ...summary, jdText: full.jdText, contacts: full.contacts, decisions: full.decisions, tailoredCv: full.tailoredCv ?? null, aiEvidence: full.aiEvidence, languageEvidence: full.languageEvidence } : summary;
  const contacts = job.contacts ?? [];
  const jd = useMemo(() => htmlToText(job.jdText), [job.jdText]);
  const breakdown = { ...job.scoreBreakdown } as Record<string, number | null | undefined>;

  const act = async (action: JobAction) => {
    setBusy(action);
    try { await onAction(job, action); } finally { setBusy(null); }
  };

  return (
    <section className="targets-detail" aria-label={`${job.companyName} details`}>
      <div className="detail-inner">
        {desktop ? null : <a className="button button-quiet back-link" href="#/targets">Back to targets</a>}
        <header className="detail-head">
          <div className="detail-title-row">
            <div className="detail-title">
              <p className="muted">{job.companyName}{job.location ? ` · ${job.location}` : ""}</p>
              <h2>{job.title}</h2>
              {job.jevVerified ? null : <p className="text-warn" title="Nothing is sent until Jev confirms this job.">Unverified by Jev. You can draft, sending waits for Jev.</p>}
            </div>
            <FeedbackButtons job={job} onFeedback={onFeedback} />
          </div>
          <div className="tags">
            <span className={`tag ${job.workMode === "remote" ? "tag-good" : ""}`}>{modeLabel(job)}</span>
            <span className="tag">{seniorityLabel(job.seniority)}</span>
            <span className={`tag ${job.sponsorship === "yes" || job.sponsorship === "registry_hit" ? "tag-good" : ""}`}>{sponsorshipLabel(job.sponsorship)}</span>
            <span className="tag tag-plain">Posted {formatAge(job.postedAt || job.firstSeenAt)} ago</span>
            {job.translated ? <span className="tag">Translated from original</span> : null}
            {job.feedback === "like" ? <span className="tag tag-accent">Liked</span> : null}
            {job.jevVerified ? <span className="tag tag-good">Verified by Jev</span> : null}
          </div>
        </header>

        <div className="detail-section fit">
          <h3>Why this fits you</h3>
          <p className="fit-score"><span className={`score ${scoreColor(job.score)}`}>{job.score}</span><span className="muted"> / 100, {scoreLabel(job.score).toLowerCase()}</span></p>
          <p className="fit-summary">{fitSummary(breakdown)}</p>
          <dl className="breakdown">
            {Object.keys(FIT_LABELS).filter((key) => key in breakdown).map((key) => {
              const value = breakdown[key];
              const pct = typeof value === "number" ? toPercent(value) : null;
              return (
                <div key={key}>
                  <dt>{FIT_LABELS[key]}</dt>
                  <dd>
                    <span className="meter" aria-hidden="true"><span style={{ transform: `scaleX(${pct === null ? 0 : Math.min(100, pct) / 100})` }} /></span>
                    <span className="fit-value">{pct === null ? <span className="muted">Not measured yet</span> : <>{fitWord(pct)} <span className="tabular muted">{pct}</span></>}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        {job.skipReason ? <p className="muted">Skip reason: {job.skipReason}</p> : null}

        <div className="detail-actions">
          <button className="button button-primary" disabled={busy !== null} onClick={() => act("draft")}>{busy === "draft" ? <><Spinner /> Drafting</> : "Draft email"}</button>
          <a className="button button-secondary" href={job.applyUrl || job.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => { void onAction(job, "open"); }}>Open apply page</a>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => act("skip")}>Skip</button>
          <button className="button button-danger" disabled={busy !== null} onClick={() => act("blacklist")}>Blacklist company</button>
        </div>

        <QuoteSection title="Evidence from the listing" quotes={job.aiEvidence} empty="No AI evidence recorded." />
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
                  {contact.sourceUrl ? <a className="text-link" href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Source page</a> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <TailorCv job={job} onUpdated={(record) => { setFull(record); onTargetUpdate(record); }} />

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
      </div>
    </section>
  );
}

function TailorCv({ job, onUpdated }: { job: JobTarget; onUpdated: (job: JobTarget) => void }) {
  const [state, setState] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const cv = job.tailoredCv;

  useEffect(() => {
    if (state !== "working") return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const run = async () => {
    setState("working");
    setError(null);
    try {
      onUpdated(await api.tailorCv(job.id));
    } catch (caught) {
      const code = caught instanceof api.ApiError ? caught.code.toLowerCase() : "";
      setError(TAILOR_ERRORS[code] ?? (caught instanceof Error ? caught.message : "The CV could not be tailored."));
    } finally {
      setState("idle");
    }
  };

  return (
    <div className="detail-section">
      <h3>Tailored CV</h3>
      {error ? <div className="notice notice-warning" role="alert"><strong>CV not tailored</strong><span>{error}</span></div> : null}
      {state === "working" ? (
        <div className="progress-line" role="status"><Spinner /><span>Tailoring your CV for this job. Usually about 20 seconds{seconds ? `, ${seconds}s so far` : ""}.</span></div>
      ) : cv ? (
        <div className="cv-preview">
          <div className="cv-head">
            <strong>{cv.content.headline || cv.content.name}</strong>
            <span className="muted small">{cv.fileName} · {formatDateTime(cv.createdAt, "")}</span>
          </div>
          {cv.content.summary ? <p>{cv.content.summary}</p> : null}
          {cv.content.skills?.length ? <div className="tags">{cv.content.skills.slice(0, 12).map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div> : null}
          {cv.content.changes?.length ? (
            <div className="cv-changes">
              <p className="muted">What was emphasised</p>
              <ul className="plain-list">{cv.content.changes.map((change) => <li key={change}>{change}</li>)}</ul>
            </div>
          ) : null}
          <div className="detail-actions">
            <a className="button button-primary" href={api.tailoredCvUrl(job.id)} download={cv.fileName}>Download .docx</a>
            <button className="button button-secondary" onClick={run}>Tailor again</button>
          </div>
        </div>
      ) : (
        <div className="tailor-empty">
          <p className="muted">Rewrites your imported CV to lead with what this job asks for. Uses one LLM call and takes about 20 seconds.</p>
          <button className="button button-secondary" onClick={run}>Tailor CV for this job</button>
        </div>
      )}
    </div>
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
