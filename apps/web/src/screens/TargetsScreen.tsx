import { useEffect, useMemo, useState } from "react";
import * as api from "../api.ts";
import type { Evidence, Feedback, JobAction, JobTarget, TargetsQuery } from "../types.ts";
import {
  contactKindLabel, filterTargets, FIT_LABELS, fitWord, formatAge, formatDateTime, htmlToText, humanize,
  isNew, modeLabel, parseDate, seniorityLabel, shortLocation, sponsorshipLabel, toPercent,
} from "../utils.ts";
import { EmptyState } from "../components/States.tsx";
import { Icon, Spinner } from "../components/Icon.tsx";
import { Popover } from "../components/Popover.tsx";
import { Monogram } from "../components/Monogram.tsx";
import { ScoreRing } from "../components/ScoreRing.tsx";
import type { CSSProperties, ReactNode } from "react";

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

/** Rows fade in with a short stagger on the first list render of the session only. */
let introPlayed = false;

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

/** Short mode word for the quiet row line. */
const shortMode = (job: JobTarget) => job.workMode === "remote" ? "Remote" : job.workMode === "hybrid" ? "Hybrid" : "On-site";

export function TargetsScreen({ targets, selectedId, onAction, onFeedback, onTargetUpdate, onExport }: Props) {
  const desktop = useDesktop();
  const [query, setQuery] = useState<TargetsQuery>(emptyQuery);
  const [seniority, setSeniority] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [limit, setLimit] = useState(PAGE);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<JobTarget | null>(null);
  const [intro] = useState(() => !introPlayed);
  useEffect(() => { introPlayed = true; }, []);

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
  const filterCount = [query.age, query.country, query.workMode, query.sponsorship, seniority].filter(Boolean).length + (query.hasEmail ? 1 : 0) + (sort === "score" ? 0 : 1);
  const resetFilters = () => { setQuery({ ...emptyQuery, search: query.search ?? "" }); setSeniority(""); setSort("score"); setLimit(PAGE); };

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
        <input id="target-search" className="toolbar-search" type="search" value={query.search ?? ""} onChange={(event) => updateQuery("search", event.target.value)} placeholder="Search" />
        <Popover label="Filters" buttonClassName="button button-secondary" buttonContent={filterCount ? `Filters ${filterCount}` : "Filters"} panelClassName="filters-panel">
          {(close) => (
            <div className="filters">
              <div className="segmented segmented-full" role="radiogroup" aria-label="Work mode">
                {[["", "Any"], ["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]].map(([value, label]) => (
                  <button key={value} role="radio" aria-checked={(query.workMode ?? "") === value} className={(query.workMode ?? "") === value ? "active" : undefined} onClick={() => updateQuery("workMode", value ?? "")}>{label}</button>
                ))}
              </div>
              <label className="field">
                <span>Sort by</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                  <option value="score">Best match</option>
                  <option value="agentic">Agentic focus</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
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
              <label className="field field-full">
                <span>Sponsorship</span>
                <select value={query.sponsorship ?? ""} onChange={(event) => updateQuery("sponsorship", event.target.value)}>
                  <option value="">Any</option>
                  <option value="yes">Sponsors visa</option>
                  <option value="registry_hit">Sponsor registry</option>
                  <option value="unknown">Unknown</option>
                  <option value="no">No sponsorship</option>
                </select>
              </label>
              <label className="toggle-field field-full">
                <span>Has contact email</span>
                <input type="checkbox" role="switch" className="switch" checked={Boolean(query.hasEmail)} onChange={(event) => updateQuery("hasEmail", event.target.checked)} />
              </label>
              <div className="popover-foot field-full">
                <button className="button button-quiet" disabled={!filterCount} onClick={resetFilters}>Reset</button>
                <button className="button button-quiet" onClick={() => { onExport("csv"); close(); }}>Export CSV</button>
                <button className="button button-quiet" onClick={() => { onExport("xlsx"); close(); }}>Export XLSX</button>
              </div>
            </div>
          )}
        </Popover>
      </header>

      <section className="targets-list" aria-label="Targets">
        {hidden ? <HiddenNote job={hidden} onSave={(note) => onFeedback(hidden, "dislike", note)} onClose={() => setHidden(null)} /> : null}
        {filtered.length === 0 ? (
          <EmptyState title="No targets match" description="Widen the filters or wait for the next crawl." />
        ) : (
          <ul className={`target-rows ${intro ? "is-intro" : ""}`}>
            {visible.map((job, index) => <TargetRow key={job.id} job={job} index={index} active={selected?.id === job.id} leaving={leaving.has(job.id)} />)}
            {filtered.length > limit ? (
              <li className="more-row"><button className="button button-quiet" onClick={() => setLimit((current) => current + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</button></li>
            ) : null}
          </ul>
        )}
      </section>

      {showDetail && selected ? (
        <TargetDetail key={selected.id} job={selected} desktop={desktop} onAction={runAction} onFeedback={feedback} onTargetUpdate={onTargetUpdate} />
      ) : desktop ? (
        <section className="targets-detail"><p className="muted detail-empty">Select a target.</p></section>
      ) : null}
    </div>
  );
}

const ModeGlyph = ({ job }: { job: JobTarget }) => <Icon name={job.workMode === "remote" ? "globe" : "building"} size={12} />;

function TargetRow({ job, index, active, leaving }: { job: JobTarget; index: number; active: boolean; leaving: boolean }) {
  const fresh = isNew(job.postedAt || job.firstSeenAt);
  const where = job.location ? shortLocation(job.location) : "";
  return (
    <li className={`target-item ${leaving ? "is-leaving" : ""}`} aria-hidden={leaving || undefined} style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <div className="target-item-inner">
        <a className={`target-row ${active ? "is-active" : ""}`} href={`#/targets/${encodeURIComponent(job.id)}`} aria-current={active ? "true" : undefined}
          title={`${job.title}\n${[job.companyName, where, shortMode(job)].filter(Boolean).join(" · ")}`}>
          <Monogram name={job.companyName} size={28} />
          <span className="row-text">
            <span className="row-line1">
              <span className="target-title">{job.title}</span>
              {fresh ? <span className="tag-new">New</span> : null}
            </span>
            <span className="row-line2">
              <span>{job.companyName}</span>
              {where ? <span className="meta-bit"><Icon name="pin" size={12} />{where}</span> : null}
              <span className="meta-bit"><ModeGlyph job={job} />{shortMode(job)}</span>
              <span className="meta-bit"><Icon name="clock" size={12} />{formatAge(job.postedAt || job.firstSeenAt)}</span>
            </span>
          </span>
          <ScoreRing score={job.score} size={22} />
        </a>
      </div>
    </li>
  );
}

function HiddenNote({ job, onSave, onClose }: { job: JobTarget; onSave: (note: string) => Promise<boolean>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="hidden-note" onSubmit={async (event) => { event.preventDefault(); if (note.trim() && await onSave(note.trim())) setSaved(true); }}>
      <p className="muted">{saved ? "Thanks. Jev will learn from that." : `Hid ${job.title}. Why? Optional.`}</p>
      {saved ? null : (
        <div className="input-row">
          <label className="sr-only" htmlFor="dislike-note">Reason</label>
          <input id="dislike-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Too senior, not agentic..." />
          <button className="button button-secondary" type="submit" disabled={!note.trim()}>Save</button>
          <button className="button button-quiet" type="button" onClick={onClose}>Close</button>
        </div>
      )}
      {saved ? <button className="button button-quiet hidden-note-close" type="button" onClick={onClose}>Close</button> : null}
    </form>
  );
}

const TAILOR_ERRORS: Record<string, string> = {
  cv_missing: "Import your CV in Settings first.",
  llm_budget_cap: "The monthly LLM budget cap is reached. Raise it in Settings to tailor more CVs.",
  luna_credentials_missing: "The OpenAI API key is not set. Add it in Settings, Connections.",
};

/** At most five parts, strongest first, in plain words. */
const fitLines = (breakdown: Record<string, number | null | undefined>) =>
  Object.keys(FIT_LABELS)
    .filter((key) => typeof breakdown[key] === "number")
    .map((key) => ({ key, pct: toPercent(breakdown[key] as number), label: FIT_LABELS[key] ?? humanize(key) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

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
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);

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
  const lines = fitLines({ ...job.scoreBreakdown } as Record<string, number | null | undefined>);
  const liked = job.feedback === "like";
  const remoteGlobal = job.workMode === "remote" && job.remoteScope === "global";
  const sponsors = job.sponsorship === "yes" || job.sponsorship === "registry_hit";

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied");
    } catch {
      setToast("Copy failed");
    }
  };

  const act = async (action: JobAction) => {
    setBusy(action);
    try { await onAction(job, action); } finally { setBusy(null); }
  };

  const tailor = async () => {
    setTailoring(true);
    setTailorError(null);
    try {
      const record = await api.tailorCv(job.id);
      setFull(record);
      onTargetUpdate(record);
    } catch (caught) {
      const code = caught instanceof api.ApiError ? caught.code.toLowerCase() : "";
      setTailorError(TAILOR_ERRORS[code] ?? (caught instanceof Error ? caught.message : "The CV could not be tailored."));
    } finally {
      setTailoring(false);
    }
  };

  return (
    <section className="targets-detail" aria-label={`${job.companyName} details`}>
      <div className="detail-inner">
        {desktop ? null : <a className="button button-quiet back-link" href="#/targets">Back to targets</a>}

        <header className="detail-head">
          <div className="detail-identity">
            <Monogram name={job.companyName} size={44} />
            <div className="detail-titles">
              <p className="muted">{job.companyName}{job.location ? ` · ${job.location}` : ""}</p>
              <h2>{job.title}{isNew(job.postedAt || job.firstSeenAt) ? <span className="tag-new">New</span> : null}</h2>
            </div>
            <ScoreRing score={job.score} size={44} animate />
          </div>
          <p className="detail-meta">
            <span className={`meta-bit ${remoteGlobal ? "text-good" : ""}`}><ModeGlyph job={job} />{modeLabel(job)}</span>
            <span className="meta-bit"><Icon name="person" size={12} />{seniorityLabel(job.seniority)}</span>
            <span className={`meta-bit ${sponsors ? "text-good" : ""}`}><Icon name="doc" size={12} />{sponsorshipLabel(job.sponsorship)}</span>
            <span className="meta-bit"><Icon name="clock" size={12} />Posted {formatAge(job.postedAt || job.firstSeenAt)} ago</span>
            {job.translated ? <span className="meta-bit">Translated</span> : null}
          </p>
          {job.jevVerified ? null : <p className="muted small">Not yet verified by Jev. Sending waits until it is.</p>}
        </header>

        <div className="detail-toolbar">
          <button className="button button-primary" disabled={busy !== null} onClick={() => act("draft")}>{busy === "draft" ? <><Spinner /> Drafting</> : "Draft email"}</button>
          <a className="button button-secondary" href={job.applyUrl || job.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => { void onAction(job, "open"); }}>Apply</a>
          <button className={`icon-button like-button ${liked ? "is-on" : ""}`} aria-pressed={liked} aria-label={liked ? "Remove like" : "Like"} title={liked ? "Liked" : "Like"} onClick={() => onFeedback(job, liked ? "clear" : "like")}>
            <Icon name="thumb" filled={liked} />
          </button>
          <button className="icon-button" aria-label="Dislike and hide" title="Dislike and hide" onClick={() => onFeedback(job, "dislike")}>
            <Icon name="thumb" flip />
          </button>
          <Popover label="More actions" buttonClassName="icon-button" buttonContent={<Icon name="more" />} align="end" panelClassName="menu">
            {(close) => (
              <div role="menu" className="menu-items">
                <button role="menuitem" disabled={tailoring} onClick={() => { close(); void tailor(); }}>{job.tailoredCv ? "Tailor CV again" : "Tailor CV for this job"}</button>
                <button role="menuitem" disabled={busy !== null} onClick={() => { close(); void act("skip"); }}>Skip</button>
                <button role="menuitem" className="menu-danger" disabled={busy !== null} onClick={() => { close(); void act("blacklist"); }}>Blacklist company</button>
              </div>
            )}
          </Popover>
        </div>

        <section className="detail-section">
          <SectionTitle icon="spark" title="Why it fits" />
          {lines.length === 0 ? <p className="muted">No score breakdown yet.</p> : (
            <ul className="fit-lines">
              {lines.map((line, index) => (
                <li key={line.key} className={index === 0 ? "is-top" : undefined}>
                  <span className="fit-label">{fitWord(line.pct)} {line.label.charAt(0).toLowerCase() + line.label.slice(1)}</span>
                  <span className="pill-meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(100, line.pct) / 100})` }} /></span>
                  <span className="fit-num tabular">{line.pct}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {tailoring || tailorError || job.tailoredCv ? (
          <section className="detail-section">
            <SectionTitle icon="doc" title="Tailored CV" />
            {tailoring ? <p className="progress-line" role="status"><Spinner /> Tailoring your CV for this job, about 20 seconds.</p> : null}
            {tailorError ? <p className="text-bad" role="alert">{tailorError}</p> : null}
            {job.tailoredCv && !tailoring ? (
              <div className="cv-preview">
                {job.tailoredCv.content.summary ? <p>{job.tailoredCv.content.summary}</p> : null}
                {job.tailoredCv.content.skills?.length ? <p className="muted">{job.tailoredCv.content.skills.slice(0, 10).join(" · ")}</p> : null}
                {job.tailoredCv.content.changes?.length ? (
                  <ul className="plain-list">{job.tailoredCv.content.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                ) : null}
                <p className="cv-links">
                  <a className="text-link" href={api.tailoredCvUrl(job.id)} download={job.tailoredCv.fileName}>Download .docx</a>
                  <span className="muted small">{formatDateTime(job.tailoredCv.createdAt, "")}</span>
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <QuoteSection title="From the listing" icon quotes={job.aiEvidence} />

        <section className="detail-section">
          <SectionTitle icon="people" title="Contacts" />
          {contacts.length === 0 ? <p className="muted">No contact email found. Use Apply.</p> : (
            <ul className="contact-cards">
              {contacts.map((contact) => (
                <li key={contact.id} className="contact-card">
                  <span className="contact-initial" aria-hidden="true">{(contact.name || contact.email).charAt(0).toUpperCase()}</span>
                  <span className="contact-text">
                    <button className="contact-email" title="Copy email" onClick={() => copy(contact.email)}>{contact.email}</button>
                    <span className="muted">{[contact.name, contactKindLabel(contact.kind), humanize(contact.jevVerdict)].filter(Boolean).join(" · ")}</span>
                  </span>
                  {contact.sourceUrl ? <a className="text-link small" href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="detail-section">
          {loadError ? <p className="muted">{loadError}</p> : null}
          <details className="disclosure">
            <summary>Job description</summary>
            {jd ? <p className="jd-text">{jd}</p> : <p className="muted">{full ? "No description captured." : "Loading."}</p>}
            {job.sourceUrl ? <a className="text-link" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">Open the original listing</a> : null}
          </details>
          <details className="disclosure">
            <summary>Details</summary>
            <QuoteSection title="Language evidence" quotes={job.languageEvidence} />
            <div className="detail-section">
              <h3>Jev decisions</h3>
              {(job.decisions ?? []).length === 0 ? <p className="muted">{full ? "None recorded yet." : "Loading."}</p> : (
                <ul className="record-list">
                  {job.decisions.map((decision) => (
                    <li key={decision.id}>
                      <p>{humanize(decision.decisionId)}: {humanize(decision.verdict)} <span className="muted tabular">{Math.round(decision.confidence * 100)}%</span></p>
                      {decision.input ? <p className="muted clamp">{htmlToText(decision.input)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {contacts.some((contact) => contact.sourceQuote) ? (
              <div className="detail-section">
                <h3>Contact sources</h3>
                {contacts.filter((contact) => contact.sourceQuote).map((contact) => <p className="quote" key={contact.id}>{htmlToText(contact.sourceQuote)}</p>)}
              </div>
            ) : null}
          </details>
        </section>
      </div>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </section>
  );
}

function SectionTitle({ icon, title, extra }: { icon: "spark" | "doc" | "people" | "quote"; title: string; extra?: ReactNode }) {
  return <h3 className="section-title"><Icon name={icon} size={15} />{title}{extra}</h3>;
}

function QuoteSection({ title, quotes, icon = false }: { title: string; quotes: Evidence[] | undefined; icon?: boolean }) {
  const list = quotes ?? [];
  if (list.length === 0) return null;
  return (
    <section className="detail-section">
      {icon ? <SectionTitle icon="quote" title={title} /> : <h3>{title}</h3>}
      <ul className="quote-list">
        {list.map((evidence, index) => (
          <li key={`${index}-${evidence.quote.slice(0, 24)}`}>
            <span className="quote-mark" aria-hidden="true">{"\u201C"}</span>
            <blockquote className="quote">{htmlToText(evidence.quote)}</blockquote>
            {evidence.context ? <p className="muted small">{evidence.context}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
