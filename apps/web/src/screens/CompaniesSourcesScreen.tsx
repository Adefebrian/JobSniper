import { useMemo, useState } from "react";
import type { Company, Source } from "../types.ts";
import { formatAgo, formatDateTime, humanize } from "../utils.ts";
import { EmptyState, Notice, PageHeader } from "../components/States.tsx";

interface Props {
  companies: Company[];
  sources: Source[];
  onCompanyAction: (company: Company, action: "force_crawl" | "pause" | "resume") => Promise<boolean>;
  onSourceAction: (source: Source, action: "approve" | "reject" | "pause" | "resume") => Promise<boolean>;
  onAddCompany: (domain: string) => Promise<boolean>;
  onAddSource: (input: { name: string; url: string; method: string }) => Promise<boolean>;
}

const PAGE = 100;

export function CompaniesSourcesScreen({ companies, sources, onCompanyAction, onSourceAction, onAddCompany, onAddSource }: Props) {
  const [tab, setTab] = useState<"companies" | "sources">("companies");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [domain, setDomain] = useState("");
  const [sourceForm, setSourceForm] = useState({ name: "", url: "", method: "json_api" });
  const [notice, setNotice] = useState<string | null>(null);

  const needle = search.trim().toLowerCase();
  const shownCompanies = useMemo(() => companies.filter((company) => !needle || `${company.name} ${company.domain ?? ""} ${company.country}`.toLowerCase().includes(needle)), [companies, needle]);
  const shownSources = useMemo(() => sources.filter((source) => !needle || `${source.name} ${source.kind} ${source.configUrl}`.toLowerCase().includes(needle)), [sources, needle]);

  const switchTab = (next: "companies" | "sources") => {
    setTab(next);
    setLimit(PAGE);
    setNotice(null);
  };
  const submitCompany = async () => {
    if (!domain.trim()) return;
    if (await onAddCompany(domain.trim())) {
      setDomain("");
      setNotice("Company domain added to discovery.");
    }
  };
  const submitSource = async () => {
    if (!sourceForm.url.trim() || !sourceForm.name.trim()) return;
    if (await onAddSource(sourceForm)) {
      setSourceForm({ name: "", url: "", method: "json_api" });
      setNotice("Source added as a candidate for review.");
    }
  };
  const runCompany = async (company: Company) => {
    if (await onCompanyAction(company, "force_crawl")) setNotice(`Crawl queued for ${company.name}.`);
  };

  return (
    <div className="screen">
      <PageHeader title="Companies & Sources" description="Where jobs come from, and whether each source is still earning its place." />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Registry view">
          <button role="tab" aria-selected={tab === "companies"} className={tab === "companies" ? "active" : undefined} onClick={() => switchTab("companies")}>Companies <span className="tabular">{companies.length}</span></button>
          <button role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "active" : undefined} onClick={() => switchTab("sources")}>Sources <span className="tabular">{sources.length}</span></button>
        </div>
        <label className="sr-only" htmlFor="registry-search">Search {tab}</label>
        <input id="registry-search" className="toolbar-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE); }} placeholder={`Search ${tab}`} />
      </div>

      {tab === "companies" ? (
        <>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void submitCompany(); }}>
            <label className="field"><span>Add a company domain</span><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="company.com" /></label>
            <button className="button button-primary" type="submit">Add domain</button>
          </form>
          {shownCompanies.length === 0 ? <EmptyState title="No companies" description={needle ? "Nothing matches this search." : "Add a public domain to begin discovery."} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Company</th><th scope="col">Country</th><th scope="col">Tier</th><th scope="col">Health</th><th scope="col" className="num">Sources</th><th scope="col">Last run</th><th scope="col">Next due</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {shownCompanies.slice(0, limit).map((company) => (
                    <tr key={company.id}>
                      <td><strong>{company.name}</strong>{company.domain ? <span className="cell-sub">{company.domain}</span> : null}</td>
                      <td>{company.country === "unknown" ? <span className="muted">Unknown</span> : company.country}</td>
                      <td>{company.tier}</td>
                      <td><span className={`tag ${company.health === "ok" ? "tag-good" : "tag-bad"}`}>{company.health === "ok" ? "OK" : humanize(company.health)}</span></td>
                      <td className="num tabular">{company.sourceCount}</td>
                      <td className="tabular">{formatAgo(company.lastRunAt)}</td>
                      <td className="tabular">{formatDateTime(company.nextDueAt, "Not scheduled")}</td>
                      <td><button className="button button-quiet" onClick={() => runCompany(company)}>Crawl now</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shownCompanies.length > limit ? <ShowMore remaining={shownCompanies.length - limit} onClick={() => setLimit((current) => current + PAGE)} /> : null}
        </>
      ) : (
        <>
          <form className="inline-form inline-form-wide" onSubmit={(event) => { event.preventDefault(); void submitSource(); }}>
            <label className="field"><span>Source name</span><input value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} placeholder="Board name" /></label>
            <label className="field"><span>URL</span><input value={sourceForm.url} onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })} placeholder="https://" /></label>
            <label className="field"><span>Method</span>
              <select value={sourceForm.method} onChange={(event) => setSourceForm({ ...sourceForm, method: event.target.value })}>
                <option value="json_api">JSON API</option><option value="rss">RSS</option><option value="sitemap">Sitemap</option><option value="json_ld">JSON-LD</option>
                <option value="html_selector">HTML selector</option><option value="headless">Headless</option><option value="csv_download">CSV download</option><option value="custom_adapter">Custom adapter</option>
              </select>
            </label>
            <button className="button button-primary" type="submit">Add source</button>
          </form>
          {shownSources.length === 0 ? <EmptyState title="No sources" description={needle ? "Nothing matches this search." : "Add a public source to start the registry."} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Source</th><th scope="col">Kind</th><th scope="col">Countries</th><th scope="col">Status</th><th scope="col" className="num">Relevant / 100</th><th scope="col" className="num">Duplicates</th><th scope="col" className="num">Failures</th><th scope="col">Last found</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shownSources.slice(0, limit).map((source) => (
                    <tr key={source.id}>
                      <td><strong>{source.name}</strong><span className="cell-sub">{humanize(source.method)} · {humanize(source.trust)}</span></td>
                      <td>{humanize(source.kind)}</td>
                      <td>{source.countries.join(", ")}</td>
                      <td><span className={`tag ${source.status === "active" ? "tag-good" : source.status === "blocked" ? "tag-bad" : "tag-plain"}`}>{humanize(source.status)}</span></td>
                      <td className="num tabular">{source.yieldStats.relevantPer100}</td>
                      <td className="num tabular">{source.yieldStats.duplicateRatio}%</td>
                      <td className="num tabular">{source.yieldStats.failureRate}%</td>
                      <td className="tabular">{formatAgo(source.yieldStats.lastFoundAt)}</td>
                      <td>
                        <div className="cell-actions">
                          {source.status === "candidate" ? <>
                            <button className="button button-secondary" onClick={() => onSourceAction(source, "approve")}>Approve</button>
                            <button className="button button-quiet" onClick={() => onSourceAction(source, "reject")}>Reject</button>
                          </> : source.status === "active" ? (
                            <button className="button button-quiet" onClick={() => onSourceAction(source, "pause")}>Pause</button>
                          ) : (
                            <button className="button button-quiet" onClick={() => onSourceAction(source, "resume")}>Resume</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shownSources.length > limit ? <ShowMore remaining={shownSources.length - limit} onClick={() => setLimit((current) => current + PAGE)} /> : null}
        </>
      )}
    </div>
  );
}

function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return <div className="more-row"><button className="button button-secondary" onClick={onClick}>Show {Math.min(PAGE, remaining)} more</button></div>;
}
