import { useMemo, useState } from "react";
import type { Company, Source, StatusStrip } from "../types.ts";
import { agoPhrase, countryShort, formatAgo, formatDateTime, humanize } from "../utils.ts";
import { useMedia } from "./TargetsScreen.tsx";
import {
  Badge, Button, Card, EmptyState, Field, ListRow, Meta, Monogram, Notice, PageHeader, Popover, SearchField, Segmented, Select, Stat, TextInput,
  type BadgeTone,
} from "../components/ui/index.ts";

interface Props {
  status: StatusStrip;
  companies: Company[];
  sources: Source[];
  onCompanyAction: (company: Company, action: "force_crawl" | "pause" | "resume") => Promise<boolean>;
  onSourceAction: (source: Source, action: "approve" | "reject" | "pause" | "resume") => Promise<boolean>;
  onAddCompany: (domain: string) => Promise<boolean>;
  onAddSource: (input: { name: string; url: string; method: string }) => Promise<boolean>;
}

const PAGE = 100;

const HEALTH: Record<Company["health"], { label: string; tone: BadgeTone }> = {
  ok: { label: "Healthy", tone: "positive" },
  failing: { label: "Failing", tone: "warning" },
  blocked: { label: "Blocked", tone: "negative" },
};

const SOURCE_STATUS: Record<Source["status"], { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  candidate: { label: "Candidate", tone: "accent" },
  paused: { label: "Paused", tone: "neutral" },
  blocked: { label: "Blocked", tone: "negative" },
  retired: { label: "Retired", tone: "neutral" },
};

const METHODS = [["json_api", "JSON API"], ["rss", "RSS"], ["sitemap", "Sitemap"], ["json_ld", "JSON-LD"], ["html_selector", "HTML selector"], ["headless", "Headless"], ["csv_download", "CSV download"], ["custom_adapter", "Custom adapter"]];

export function CompaniesSourcesScreen({ status, companies, sources, onCompanyAction, onSourceAction, onAddCompany, onAddSource }: Props) {
  const wide = useMedia("(min-width: 1024px)");
  const [tab, setTab] = useState<"companies" | "sources">("companies");
  const [health, setHealth] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState<string | null>(null);

  const needle = search.trim().toLowerCase();
  const shownCompanies = useMemo(() => companies.filter((company) =>
    (health === "all" || company.health === health)
    && (!needle || `${company.name} ${company.domain ?? ""} ${company.country}`.toLowerCase().includes(needle))), [companies, needle, health]);
  const shownSources = useMemo(() => sources.filter((source) =>
    (health === "all" || source.status === health)
    && (!needle || `${source.name} ${source.kind} ${source.configUrl}`.toLowerCase().includes(needle))), [sources, needle, health]);

  const switchTab = (next: "companies" | "sources") => { setTab(next); setHealth("all"); setLimit(PAGE); setNotice(null); };
  const crawl = async (company: Company) => { if (await onCompanyAction(company, "force_crawl")) setNotice(`Crawl queued for ${company.name}.`); };
  const liveSources = sources.filter((source) => source.status === "active").length;
  const failing = companies.filter((company) => company.health !== "ok").length;

  const healthOptions = tab === "companies"
    ? [{ value: "all", label: "All" }, { value: "ok", label: "Healthy" }, { value: "failing", label: "Failing" }, { value: "blocked", label: "Blocked" }]
    : [{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "candidate", label: "Candidates" }, { value: "paused", label: "Paused" }, { value: "blocked", label: "Blocked" }];
  const count = tab === "companies" ? shownCompanies.length : shownSources.length;
  const hasCountry = companies.some((company) => company.country && company.country !== "unknown");

  return (
    <div className="pane registry">
      <PageHeader title="Companies & Sources" meta={`${companies.length.toLocaleString("en")} companies, ${sources.length} sources`} actions={
        <AddMenu onAddCompany={async (domain) => { const ok = await onAddCompany(domain); if (ok) setNotice(`${domain} added to discovery.`); return ok; }}
          onAddSource={async (input) => { const ok = await onAddSource(input); if (ok) setNotice(`${input.name} added as a candidate for review.`); return ok; }} />
      } />
      <div className="pane-body">
        <Card label="Crawler status" className="crawler">
          <div className="stat-band">
            <Stat value={agoPhrase(status.lastRunT1)} label="Tier 1 crawl" />
            <Stat value={agoPhrase(status.lastRunT2)} label="Tier 2 crawl" />
            <Stat value={agoPhrase(status.lastRunT3)} label="Tier 3 crawl" />
            <Stat value={status.queueDepth} label="In the queue" />
            <Stat value={liveSources} label="Live sources" delta={`of ${sources.length}`} />
            <Stat value={status.blockedSources + failing} label="Need attention" tone={status.blockedSources + failing > 0 ? "warning" : undefined} delta="blocked or failing" />
          </div>
        </Card>

        <div className="registry-tools">
          <Segmented label="Registry view" value={tab} onChange={switchTab} tabs
            options={[{ value: "companies", label: "Companies", count: companies.length }, { value: "sources", label: "Sources", count: sources.length }]} />
          <SearchField label={`Search ${tab}`} value={search} onChange={(value) => { setSearch(value); setLimit(PAGE); }} placeholder={`Search ${tab}`} />
          <Segmented label="Filter by health" value={health} onChange={(value) => { setHealth(value); setLimit(PAGE); }} options={healthOptions} />
        </div>

        {notice ? <Notice tone="positive" title={notice} onClose={() => setNotice(null)} /> : null}

        {count === 0 ? (
          <Card label="Results"><EmptyState compact title={`No ${tab} here`} description={needle || health !== "all" ? "Nothing matches this search and filter." : tab === "companies" ? "Add a public company domain to start discovery." : "Add a public job source to start the registry."} /></Card>
        ) : tab === "companies" ? (
          <Card flush label="Companies" className="table-card">
            {wide ? (
              <table className="ui-table">
                <thead><tr><th scope="col">Company</th>{hasCountry ? <th scope="col">Country</th> : null}<th scope="col">Tier</th><th scope="col">Health</th><th scope="col" className="num">Sources</th><th scope="col">Last run</th><th scope="col">Next due</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {shownCompanies.slice(0, limit).map((company) => (
                    <tr key={company.id}>
                      <td><span className="cell-id"><Monogram name={company.name} size={24} /><span><strong>{company.name}</strong>{company.domain ? <span className="cell-sub">{company.domain}</span> : null}</span></span></td>
                      {hasCountry ? <td>{company.country === "unknown" ? <span className="cell-quiet">Unknown</span> : countryShort(company.country)}</td> : null}
                      <td className="tabular">{company.tier}</td>
                      <td><Badge tone={HEALTH[company.health].tone}>{HEALTH[company.health].label}</Badge></td>
                      <td className="num tabular">{company.sourceCount}</td>
                      <td className="tabular">{formatAgo(company.lastRunAt)}</td>
                      <td className="tabular">{formatDateTime(company.nextDueAt, "Not scheduled")}</td>
                      <td className="cell-action"><Button variant="plain" icon="refresh" onClick={() => crawl(company)}>Crawl</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="row-list">
                {shownCompanies.slice(0, limit).map((company) => (
                  <li key={company.id}>
                    <ListRow leading={<Monogram name={company.name} size={32} />} title={company.name}
                      subtitle={<Meta parts={[company.domain, company.country === "unknown" ? null : countryShort(company.country), company.tier, `Ran ${formatAgo(company.lastRunAt)}`]} />}
                      trailing={<Badge tone={HEALTH[company.health].tone}>{HEALTH[company.health].label}</Badge>} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card flush label="Sources" className="table-card">
            {wide ? (
              <table className="ui-table">
                <thead><tr><th scope="col">Source</th><th scope="col">Kind</th><th scope="col">Countries</th><th scope="col">Status</th><th scope="col" className="num">Relevant per 100</th><th scope="col" className="num">Duplicates</th><th scope="col" className="num">Failures</th><th scope="col">Last found</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shownSources.slice(0, limit).map((source) => (
                    <tr key={source.id}>
                      <td><span className="cell-id"><Monogram name={source.name} size={24} /><span><strong>{source.name}</strong><span className="cell-sub">{humanize(source.method)}, {humanize(source.trust).toLowerCase()}</span></span></span></td>
                      <td>{humanize(source.kind)}</td>
                      <td>{source.countries.map((code) => code === "global" ? "Global" : code).join(", ")}</td>
                      <td><Badge tone={SOURCE_STATUS[source.status].tone}>{SOURCE_STATUS[source.status].label}</Badge></td>
                      <td className="num tabular">{source.yieldStats.relevantPer100}</td>
                      <td className="num tabular">{source.yieldStats.duplicateRatio}%</td>
                      <td className="num tabular">{source.yieldStats.failureRate}%</td>
                      <td className="tabular">{formatAgo(source.yieldStats.lastFoundAt)}</td>
                      <td className="cell-action"><SourceActions source={source} onAction={onSourceAction} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="row-list">
                {shownSources.slice(0, limit).map((source) => (
                  <li key={source.id}>
                    <ListRow leading={<Monogram name={source.name} size={32} />} title={source.name}
                      subtitle={<Meta parts={[humanize(source.kind), `${source.yieldStats.relevantPer100} relevant per 100`, `Found ${formatAgo(source.yieldStats.lastFoundAt)}`]} />}
                      trailing={<Badge tone={SOURCE_STATUS[source.status].tone}>{SOURCE_STATUS[source.status].label}</Badge>} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {count > limit ? <div className="list-more"><Button onClick={() => setLimit((current) => current + PAGE)}>Show {Math.min(PAGE, count - limit)} more</Button></div> : null}
      </div>
    </div>
  );
}

function SourceActions({ source, onAction }: { source: Source; onAction: Props["onSourceAction"] }) {
  if (source.status === "candidate") return <span className="cell-buttons"><Button variant="plain" onClick={() => onAction(source, "approve")}>Approve</Button><Button variant="plain" onClick={() => onAction(source, "reject")}>Reject</Button></span>;
  if (source.status === "active") return <Button variant="plain" onClick={() => onAction(source, "pause")}>Pause</Button>;
  if (source.status === "paused" || source.status === "blocked") return <Button variant="plain" onClick={() => onAction(source, "resume")}>Resume</Button>;
  return null;
}

function AddMenu({ onAddCompany, onAddSource }: { onAddCompany: (domain: string) => Promise<boolean>; onAddSource: (input: { name: string; url: string; method: string }) => Promise<boolean> }) {
  const [kind, setKind] = useState<"company" | "source">("company");
  const [domain, setDomain] = useState("");
  const [form, setForm] = useState({ name: "", url: "", method: "json_api" });
  return (
    <Popover label="Add a company or source" align="end" panelClassName="add-panel" trigger={(props) => (
      <button type="button" className="ui-button ui-button--primary" {...props}><span className="ui-button-label">Add</span></button>
    )}>
      {(close) => (
        <form className="add-form" onSubmit={async (event) => {
          event.preventDefault();
          const ok = kind === "company" ? domain.trim() && await onAddCompany(domain.trim()) : form.name.trim() && form.url.trim() && await onAddSource(form);
          if (ok) { setDomain(""); setForm({ name: "", url: "", method: "json_api" }); close(); }
        }}>
          <Segmented label="What to add" full value={kind} onChange={setKind} options={[{ value: "company", label: "Company" }, { value: "source", label: "Source" }]} />
          {kind === "company" ? (
            <Field label="Company domain" htmlFor="add-domain" hint="Pip finds its careers page and job board."><TextInput id="add-domain" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="company.com" /></Field>
          ) : (
            <>
              <Field label="Name" htmlFor="add-name"><TextInput id="add-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Board name" /></Field>
              <Field label="URL" htmlFor="add-url"><TextInput id="add-url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://" /></Field>
              <Field label="Method" htmlFor="add-method">
                <Select id="add-method" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
                  {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
            </>
          )}
          <div className="add-foot">
            <Button variant="plain" onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit">{kind === "company" ? "Add company" : "Add source"}</Button>
          </div>
        </form>
      )}
    </Popover>
  );
}
