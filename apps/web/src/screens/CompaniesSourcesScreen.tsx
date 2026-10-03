import { useState } from "react";
import type { Company, Source } from "../types.ts";
import { formatAge, formatDateTime } from "../utils.ts";
import { EmptyState, ErrorState, Notice, PageHeader } from "../components/States.tsx";

interface Props {
  companies: Company[];
  sources: Source[];
  loading: boolean;
  error: string | null;
  onCompanyAction: (company: Company, action: "force_crawl" | "pause" | "resume") => Promise<boolean>;
  onSourceAction: (source: Source, action: "approve" | "reject" | "pause" | "resume") => Promise<boolean>;
  onAddCompany: (domain: string) => Promise<boolean>;
  onAddSource: (input: { name: string; url: string; method: string }) => Promise<boolean>;
}

export function CompaniesSourcesScreen({ companies, sources, loading, error, onCompanyAction, onSourceAction, onAddCompany, onAddSource }: Props) {
  const [tab, setTab] = useState<"companies" | "sources">("companies");
  const [domain, setDomain] = useState("");
  const [sourceForm, setSourceForm] = useState({ name: "", url: "", method: "json_api" });
  const [notice, setNotice] = useState<string | null>(null);
  const submitCompany = async () => {
    if (!domain.trim()) return;
    const succeeded = await onAddCompany(domain.trim());
    if (succeeded) {
      setDomain("");
      setNotice("Company domain added to discovery.");
    }
  };
  const submitSource = async () => {
    if (!sourceForm.url.trim() || !sourceForm.name.trim()) return;
    const succeeded = await onAddSource(sourceForm);
    if (succeeded) {
      setSourceForm({ name: "", url: "", method: "json_api" });
      setNotice("Source added as a candidate for review.");
    }
  };
  return (
    <div className="screen">
      <PageHeader eyebrow="Coverage registry" title="Companies & Sources" description="Keep discovery broad, keep provenance visible, and pause sources that stop earning their place." />
      {error ? <Notice tone="warning">The local API is not responding. Start JobSniper and refresh.</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="tab-list" role="tablist" aria-label="Registry view">
        <button role="tab" aria-selected={tab === "companies"} className={tab === "companies" ? "active" : ""} onClick={() => setTab("companies")}>Companies <span>{companies.length}</span></button>
        <button role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}>Sources <span>{sources.length}</span></button>
      </div>
      {tab === "companies" ? (
        <>
          <section className="form-band">
            <div><h2>Add a company domain</h2><p>Submit a public domain to create a discovery task.</p></div>
            <div className="inline-form"><label className="field"><span>Domain</span><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="company.example" /></label><button className="button button-primary" onClick={submitCompany}>Add domain</button></div>
          </section>
          {loading ? <div className="ledger-loading"><span className="loader" aria-hidden="true" /> Loading companies</div> : null}
          {!loading && companies.length === 0 ? <EmptyState title="No companies yet" description="Add a public domain to begin discovery." /> : null}
          {!loading && companies.length > 0 ? <div className="ledger-table-wrap scroll-x"><table className="ledger-table"><thead><tr><th>Company</th><th>Country / tier</th><th>Health</th><th>Last run</th><th>Next due</th><th>Inspect</th></tr></thead><tbody>{companies.map((company) => <tr key={company.id}><td><div className="record-primary"><strong>{company.name}</strong><code>{company.domain}</code></div></td><td><span className="record-secondary">{company.country}</span><span className="work-tag">{company.tier}</span></td><td><span className={`status-chip status-${company.health}`}>{company.health}</span></td><td className="mono">{formatAge(company.lastRunAt)} ago</td><td className="mono">{formatDateTime(company.nextDueAt)}</td><td><button className="button button-quiet table-action" onClick={() => onCompanyAction(company, "force_crawl")}>Force crawl</button></td></tr>)}</tbody></table></div> : null}
        </>
      ) : (
        <>
          <section className="form-band">
            <div><h2>Add a source</h2><p>New public sources enter as candidates until their yield is proven.</p></div>
            <div className="inline-form source-form"><label className="field"><span>Name</span><input value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} placeholder="Source name" /></label><label className="field"><span>URL</span><input value={sourceForm.url} onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })} placeholder="https://..." /></label><label className="field"><span>Method</span><select value={sourceForm.method} onChange={(event) => setSourceForm({ ...sourceForm, method: event.target.value })}><option value="json_api">JSON API</option><option value="rss">RSS</option><option value="sitemap">Sitemap</option><option value="json_ld">JSON-LD</option><option value="html_selector">HTML selector</option><option value="headless">Headless</option><option value="csv_download">CSV download</option><option value="custom_adapter">Custom adapter</option></select></label><button className="button button-primary" onClick={submitSource}>Add source</button></div>
          </section>
          {loading ? <div className="ledger-loading"><span className="loader" aria-hidden="true" /> Loading sources</div> : null}
          {!loading && sources.length === 0 ? <EmptyState title="No sources registered" description="Add a public source to start filling the registry." /> : null}
          {!loading && sources.length > 0 ? <div className="source-grid">{sources.map((source) => <article className="source-card" key={source.id}><div className="source-card-head"><div><span className={`status-chip status-${source.status}`}>{source.status}</span><h2>{source.name}</h2></div><span className="mono">{source.kind}</span></div><p className="source-url">{source.configUrl}</p><div className="source-stats"><div><span>Relevant / 100</span><strong>{source.yieldStats.relevantPer100}</strong></div><div><span>Duplicates</span><strong>{source.yieldStats.duplicateRatio}%</strong></div><div><span>Failure</span><strong>{source.yieldStats.failureRate}%</strong></div><div><span>Last found</span><strong>{formatAge(source.yieldStats.lastFoundAt)}</strong></div></div><div className="source-card-foot"><span>{source.countries.join(", ")} · {source.trust}</span><div>{source.status === "candidate" ? <><button className="button button-primary" onClick={() => onSourceAction(source, "approve")}>Approve</button><button className="button button-secondary" onClick={() => onSourceAction(source, "reject")}>Reject</button></> : source.status === "active" ? <button className="button button-secondary" onClick={() => onSourceAction(source, "pause")}>Pause</button> : <button className="button button-secondary" onClick={() => onSourceAction(source, "resume")}>Resume</button>}</div></div></article>)}</div> : null}
        </>
      )}
    </div>
  );
}
