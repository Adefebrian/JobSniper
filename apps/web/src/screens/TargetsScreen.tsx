import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import * as api from "../api.ts";
import type { Feedback, JobAction, JobTarget, TargetsQuery } from "../types.ts";
import {
  ageGroup, contactKindLabel, filterTargets, FIT_LABELS, fitSummary, formatAge, formatDateTime, hostOf, htmlToText, humanize,
  modeLabel, modeShort, parseDate, placeLabel, scoreLabel, seniorityLabel, sponsorshipLabel, toPercent,
} from "../utils.ts";
import {
  Badge, Button, Card, EmptyState, Field, IconButton, ListRow, MenuItem, Meta, MeterRow, Monogram, PageHeader, Popover,
  ScoreRing, SearchField, Section, Segmented, Select, TextInput, Toggle,
} from "../components/ui/index.ts";

type FeedbackFn = (job: JobTarget, verdict: Feedback | "clear", note?: string) => Promise<boolean>;

interface Props {
  targets: JobTarget[];
  selectedId: string | null;
  onAction: (job: JobTarget, action: JobAction) => Promise<boolean>;
  onFeedback: FeedbackFn;
  onTargetUpdate: (job: JobTarget) => void;
  onExport: (format: "csv" | "xlsx") => void;
}

type Sort = "score" | "newest" | "agentic";

const emptyQuery: TargetsQuery = { age: "", country: "", workMode: "", sponsorship: "", hasEmail: false, status: "", search: "" };
const PAGE = 100;
const DESKTOP = "(min-width: 1024px)";
const COLLAPSE_MS = 200;
const GROUPS = ["Today", "This week", "Older"] as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useMedia = (query: string) => {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
};

const goTo = (id: string | null) => {
  window.location.hash = id ? `#/targets/${encodeURIComponent(id)}` : "#/targets";
};

const postedIso = (job: JobTarget) => job.postedAt || job.firstSeenAt;
const postedTime = (job: JobTarget) => parseDate(postedIso(job))?.getTime() ?? 0;

const sorters: Record<Sort, (a: JobTarget, b: JobTarget) => number> = {
  score: (a, b) => b.score - a.score,
  newest: (a, b) => postedTime(b) - postedTime(a),
  agentic: (a, b) => (b.scoreBreakdown?.agenticFocus ?? -1) - (a.scoreBreakdown?.agenticFocus ?? -1) || b.score - a.score,
};

export function TargetsScreen({ targets, selectedId, onAction, onFeedback, onTargetUpdate, onExport }: Props) {
  const desktop = useMedia(DESKTOP);
  const [query, setQuery] = useState<TargetsQuery>(emptyQuery);
  const [seniority, setSeniority] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [limit, setLimit] = useState(PAGE);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<JobTarget | null>(null);

  const filtered = useMemo(() => {
    const list = filterTargets(targets, query).filter((job) => !seniority || job.seniority === seniority);
    return sort === "score" ? list : [...list].sort(sorters[sort]);
  }, [targets, query, seniority, sort]);
  const countries = useMemo(() => [...new Set(targets.map((job) => job.country).filter(Boolean))].sort(), [targets]);
  const visible = filtered.slice(0, limit);
  const grouped = GROUPS.map((group) => ({ group, jobs: visible.filter((job) => ageGroup(postedIso(job)) === group) })).filter((entry) => entry.jobs.length > 0);

  const fromHash = selectedId ? targets.find((job) => job.id === selectedId) ?? null : null;
  const selected = fromHash ?? (desktop ? grouped[0]?.jobs[0] ?? null : null);
  const showDetail = Boolean(selected) && (desktop || Boolean(fromHash));

  const updateQuery = (key: keyof TargetsQuery, value: string | boolean) => {
    setQuery((current) => ({ ...current, [key]: value }));
    setLimit(PAGE);
  };
  const filterCount = [query.age, query.country, query.workMode, query.sponsorship, seniority].filter(Boolean).length + (query.hasEmail ? 1 : 0);
  const resetFilters = () => { setQuery({ ...emptyQuery, search: query.search ?? "" }); setSeniority(""); setLimit(PAGE); };

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

  let rowIndex = 0;
  return (
    <div className={`targets split ${showDetail && !desktop ? "is-detail" : ""}`}>
      <section className="split-list targets-list" aria-label="Targets">
        <PageHeader title="Targets" meta={filtered.length.toLocaleString("en")} actions={
          <Popover label={filterCount ? `Filters, ${filterCount} on` : "Filters"} align="end" panelClassName="filters-panel" trigger={(props) => (
            <button type="button" className={`ui-icon-button ${filterCount ? "is-on" : ""}`} {...props}>
              <Icon name="filter" />
            </button>
          )}>
            {(close) => (
              <div className="filters">
                <Field label="Work mode">
                  <Segmented label="Work mode" full value={(query.workMode ?? "") as string} onChange={(value) => updateQuery("workMode", value)}
                    options={[{ value: "", label: "Any" }, { value: "remote", label: "Remote" }, { value: "hybrid", label: "Hybrid" }, { value: "onsite", label: "On-site" }]} />
                </Field>
                <div className="filters-grid">
                  <Field label="Level" htmlFor="filter-level">
                    <Select id="filter-level" value={seniority} onChange={(event) => { setSeniority(event.target.value); setLimit(PAGE); }}>
                      <option value="">Any level</option><option value="mid">Mid-level</option><option value="early">Junior</option><option value="senior">Senior</option><option value="lead">Lead</option>
                    </Select>
                  </Field>
                  <Field label="Posted" htmlFor="filter-age">
                    <Select id="filter-age" value={query.age ?? ""} onChange={(event) => updateQuery("age", event.target.value)}>
                      <option value="">Any time</option><option value="24h">Last 24 hours</option><option value="72h">Last 72 hours</option><option value="7d">Last 7 days</option>
                    </Select>
                  </Field>
                  <Field label="Country" htmlFor="filter-country">
                    <Select id="filter-country" value={query.country ?? ""} onChange={(event) => updateQuery("country", event.target.value)}>
                      <option value="">All countries</option>
                      {countries.map((country) => <option key={country} value={country}>{country}</option>)}
                    </Select>
                  </Field>
                  <Field label="Visa" htmlFor="filter-visa">
                    <Select id="filter-visa" value={query.sponsorship ?? ""} onChange={(event) => updateQuery("sponsorship", event.target.value)}>
                      <option value="">Any</option><option value="yes">Sponsors visa</option><option value="registry_hit">Sponsor registry</option><option value="unknown">Unknown</option><option value="no">No sponsorship</option>
                    </Select>
                  </Field>
                </div>
                <Toggle label="Has a contact email" checked={Boolean(query.hasEmail)} onChange={(value) => updateQuery("hasEmail", value)} />
                <div className="filters-foot">
                  <Button variant="plain" disabled={!filterCount} onClick={resetFilters}>Reset</Button>
                  <Button variant="plain" icon="download" onClick={() => { onExport("csv"); close(); }}>CSV</Button>
                  <Button variant="plain" icon="download" onClick={() => { onExport("xlsx"); close(); }}>XLSX</Button>
                </div>
              </div>
            )}
          </Popover>
        } />
        <div className="split-tools">
          <SearchField label="Search targets" value={query.search ?? ""} onChange={(value) => updateQuery("search", value)} placeholder="Search title, company, place" />
          <Segmented label="Sort targets" full value={sort} onChange={setSort}
            options={[{ value: "score", label: "Best match" }, { value: "newest", label: "Newest" }, { value: "agentic", label: "Agentic" }]} />
        </div>
        <div className="split-scroll">
          {hidden ? <HiddenNote job={hidden} onSave={(note) => onFeedback(hidden, "dislike", note)} onClose={() => setHidden(null)} /> : null}
          {filtered.length === 0 ? (
            <EmptyState compact title="No targets match" description="Widen the filters, or wait for the next crawl." action={filterCount ? <Button onClick={resetFilters}>Reset filters</Button> : undefined} />
          ) : (
            <div className="target-groups">
              {grouped.map(({ group, jobs }) => (
                <section key={group} className="target-group" aria-label={group}>
                  <h3 className="list-group-title">{group}<span className="tabular">{jobs.length}</span></h3>
                  <ul className="target-rows">
                    {jobs.map((job) => <TargetRow key={job.id} job={job} index={rowIndex++} active={selected?.id === job.id} leaving={leaving.has(job.id)} />)}
                  </ul>
                </section>
              ))}
              {filtered.length > limit ? (
                <div className="list-more"><Button variant="plain" onClick={() => setLimit((current) => current + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Button></div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {showDetail && selected ? (
        <TargetDetail key={selected.id} job={selected} desktop={desktop} onAction={runAction} onFeedback={feedback} onTargetUpdate={onTargetUpdate} />
      ) : desktop ? (
        <section className="split-detail targets-detail" aria-label="Target details">
          <EmptyState title="No target selected" description="Pick a role on the left to see why it fits." />
        </section>
      ) : null}
    </div>
  );
}

function TargetRow({ job, index, active, leaving }: { job: JobTarget; index: number; active: boolean; leaving: boolean }) {
  return (
    <li className={`target-item ${leaving ? "is-leaving" : ""}`} aria-hidden={leaving || undefined} style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <div className="target-item-inner">
        <ListRow className="target-row" href={`#/targets/${encodeURIComponent(job.id)}`} active={active}
          leading={<Monogram name={job.companyName} size={32} />}
          title={job.title}
          subtitle={<Meta parts={[job.companyName, placeLabel(job.location, job.country), modeShort(job), formatAge(postedIso(job))]} />}
          trailing={<ScoreRing score={job.score} size={28} />} />
      </div>
    </li>
  );
}

function HiddenNote({ job, onSave, onClose }: { job: JobTarget; onSave: (note: string) => Promise<boolean>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="hidden-note" onSubmit={async (event) => { event.preventDefault(); if (note.trim() && await onSave(note.trim())) setSaved(true); }}>
      <p>{saved ? "Thanks. Jev will learn from that." : <>Hid <strong>{job.title}</strong>. Tell Jev why, if you like.</>}</p>
      {saved ? <Button variant="plain" onClick={onClose}>Close</Button> : (
        <div className="hidden-note-row">
          <label className="sr-only" htmlFor="dislike-note">Reason</label>
          <TextInput id="dislike-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Too senior, not agentic" />
          <Button type="submit" disabled={!note.trim()}>Save</Button>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
      )}
    </form>
  );
}

const TAILOR_ERRORS: Record<string, string> = {
  cv_missing: "Import your CV in Settings first.",
  llm_budget_cap: "The monthly LLM budget cap is reached. Raise it in Settings to tailor more CVs.",
  luna_credentials_missing: "The OpenAI API key is not set. Add it in Settings, Connections.",
};

/** Every score part that has a value, strongest first. */
const fitLines = (breakdown: Record<string, number | null | undefined>) =>
  Object.keys(FIT_LABELS)
    .filter((key) => typeof breakdown[key] === "number")
    .map((key) => ({ key, pct: toPercent(breakdown[key] as number), label: FIT_LABELS[key] ?? humanize(key) }))
    .sort((a, b) => b.pct - a.pct);

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
  const [jdOpen, setJdOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getTarget(summary.id)
      .then((record) => { if (live) setFull(record); })
      .catch((caught) => { if (live) setLoadError(caught instanceof Error ? caught.message : "Could not load the full record."); });
    return () => { live = false; };
  }, [summary.id]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const job: JobTarget = full ? { ...full, ...summary, jdText: full.jdText, contacts: full.contacts, decisions: full.decisions, tailoredCv: full.tailoredCv ?? null, aiEvidence: full.aiEvidence, languageEvidence: full.languageEvidence } : summary;
  const contacts = job.contacts ?? [];
  const jd = useMemo(() => htmlToText(job.jdText), [job.jdText]);
  const breakdown = { ...job.scoreBreakdown } as Record<string, number | null | undefined>;
  const lines = fitLines(breakdown);
  const liked = job.feedback === "like";
  const sponsors = job.sponsorship === "yes" || job.sponsorship === "registry_hit";
  const decisions = job.decisions ?? [];
  const evidence = (job.aiEvidence ?? []).filter((item) => item.quote && item.quote !== job.title);

  const act = async (action: JobAction) => {
    setBusy(action);
    try { await onAction(job, action); } finally { setBusy(null); }
  };
  const copy = async (email: string) => {
    try { await navigator.clipboard.writeText(email); setCopied(email); } catch { setCopied(null); }
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

  const facts: [string, ReactNode][] = [
    ["Level", seniorityLabel(job.seniority)],
    ["Work mode", modeLabel(job)],
    ["Visa", sponsors ? <Badge tone="positive">{sponsorshipLabel(job.sponsorship)}</Badge> : sponsorshipLabel(job.sponsorship)],
    ["Posted", `${formatAge(postedIso(job))} ago`],
    ["Location", job.location || "Not stated"],
    ...(job.salary ? [["Salary", job.salary] as [string, ReactNode]] : []),
    ["Source", hostOf(job.sourceUrl) || "Unknown"],
    ["Verified", job.jevVerified ? "By Jev" : "Not yet. Sending waits for it."],
  ];

  return (
    <section className="split-detail targets-detail" aria-label={`${job.title} at ${job.companyName}`}>
      <div className="detail-scroll">
        <div className="detail-inner">
          {desktop ? null : <Button variant="plain" icon="chevronLeft" href="#/targets" className="back-link">Targets</Button>}

          <header className="detail-head">
            <Monogram name={job.companyName} size={40} />
            <div className="detail-titles">
              <h2>{job.title}</h2>
              <p><Meta parts={[job.companyName, placeLabel(job.location, job.country), modeShort(job), `${formatAge(postedIso(job))} ago`]} /></p>
            </div>
            <div className="detail-actions">
              <Button variant="primary" icon="mail" busy={busy === "draft"} disabled={busy !== null} onClick={() => act("draft")}>{busy === "draft" ? "Drafting" : "Draft email"}</Button>
              <Button icon="external" href={job.applyUrl || job.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => { void onAction(job, "open"); }}>Apply</Button>
              <IconButton icon="thumb" filled={liked} pressed={liked} label={liked ? "Remove like" : "Like, show more like this"} onClick={() => onFeedback(job, liked ? "clear" : "like")} />
              <IconButton icon="thumb" flip label="Dislike and hide" onClick={() => onFeedback(job, "dislike")} />
              <Popover label="More actions" align="end" panelClassName="ui-menu" trigger={(props) => (
                <button type="button" className="ui-icon-button" {...props}><Icon name="more" /></button>
              )}>
                {(close) => (
                  <div role="menu">
                    <MenuItem disabled={tailoring} onClick={() => { close(); void tailor(); }}>{job.tailoredCv ? "Tailor CV again" : "Tailor CV for this job"}</MenuItem>
                    <MenuItem disabled={busy !== null} onClick={() => { close(); void act("skip"); }}>Skip this role</MenuItem>
                    <MenuItem danger disabled={busy !== null} onClick={() => { close(); void act("blacklist"); }}>Blacklist {job.companyName}</MenuItem>
                  </div>
                )}
              </Popover>
            </div>
          </header>

          <div className="detail-body">
            <aside className="detail-rail" aria-label="Match summary">
              <Card title="Match">
                <div className="match-head">
                  <ScoreRing score={job.score} size={64} animate />
                  <div className="match-text">
                    <strong>{scoreLabel(job.score)}</strong>
                    <p>{fitSummary(breakdown)}</p>
                  </div>
                </div>
                {lines.length ? (
                  <ul className="meter-list">
                    {lines.map((line, index) => <MeterRow key={line.key} index={index} label={line.label} value={line.pct} />)}
                  </ul>
                ) : null}
              </Card>
              <Card title="Quick facts">
                <dl className="facts">
                  {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </Card>
              <Card title="Contacts" flush={contacts.length > 0}>
                {contacts.length === 0 ? <p className="card-note">No contact email found yet. Apply through the listing.</p> : (
                  <ul className="row-list">
                    {contacts.map((contact) => (
                      <li key={contact.id}>
                        <ListRow
                          leading={<Monogram name={contact.name || contact.email} size={32} />}
                          title={<span className="break-all">{contact.email}</span>}
                          subtitle={<Meta parts={[contact.name, contactKindLabel(contact.kind), contact.jevVerdict === "verified" ? "Verified" : humanize(contact.jevVerdict)]} />}
                          trailing={<IconButton icon={copied === contact.email ? "check" : "copy"} label={copied === contact.email ? "Copied" : `Copy ${contact.email}`} onClick={() => copy(contact.email)} />} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </aside>

            <div className="detail-main">
              {tailoring || tailorError || job.tailoredCv ? (
                <Section title="Tailored CV" action={job.tailoredCv && !tailoring ? <Button variant="plain" icon="download" href={api.tailoredCvUrl(job.id)} download={job.tailoredCv.fileName}>Download .docx</Button> : undefined}>
                  {tailoring ? <p className="section-note" role="status">Tailoring your CV for this role. About 20 seconds.</p> : null}
                  {tailorError ? <p className="section-note is-negative" role="alert">{tailorError}</p> : null}
                  {job.tailoredCv && !tailoring ? (
                    <div className="prose">
                      {job.tailoredCv.content.summary ? <p>{job.tailoredCv.content.summary}</p> : null}
                      {job.tailoredCv.content.changes?.length ? <ul>{job.tailoredCv.content.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}
                      <p className="section-note">Made {formatDateTime(job.tailoredCv.createdAt, "recently")}</p>
                    </div>
                  ) : null}
                </Section>
              ) : null}

              <Section title="From the listing" description="Lines Jev used to judge this role.">
                {evidence.length === 0 ? <p className="section-note">{full ? "No quotes were captured for this role." : "Loading the full record."}</p> : (
                  <ul className="quote-list">
                    {evidence.map((item, index) => (
                      <li key={`${index}-${item.quote.slice(0, 24)}`}>
                        <blockquote>{htmlToText(item.quote)}</blockquote>
                        {item.context ? <span>{item.context}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Job description" action={jd ? <Button variant="plain" icon={jdOpen ? "chevronDown" : "chevronRight"} onClick={() => setJdOpen((value) => !value)} aria-expanded={jdOpen}>{jdOpen ? "Show less" : "Show all"}</Button> : undefined}>
                {loadError ? <p className="section-note">{loadError}</p> : null}
                {jd ? <p className={`jd-text ${jdOpen ? "is-open" : ""}`}>{jd}</p> : <p className="section-note">{full ? "No description captured." : "Loading the description."}</p>}
                {job.sourceUrl ? <Button variant="plain" icon="external" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">Open the original listing</Button> : null}
              </Section>

              <Section title="Jev checks" description={decisions.length ? `${decisions.length} decisions on this role.` : undefined}>
                {decisions.length === 0 ? <p className="section-note">{full ? "None recorded yet." : "Loading."}</p> : (
                  <ul className="row-list is-boxed">
                    {decisions.map((decision) => (
                      <li key={decision.id}>
                        <ListRow title={humanize(decision.decisionId)} subtitle={humanize(decision.verdict)}
                          trailing={<span className="tabular row-value">{Math.round(decision.confidence * 100)}%</span>} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
