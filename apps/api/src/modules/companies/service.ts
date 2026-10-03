import { ApiError } from "../../core/http";
import type { Settings } from "../../core/domain";
import type { Clock, CrawlEnqueuer, DashboardDependencies, IdGenerator, JevPort } from "./ports";
import { sourceYieldAction, updateYieldStats, type YieldStats } from "./policy";
import { CompaniesRepository } from "./repo";

const GENERIC_METHODS = new Set(["json_api", "rss", "sitemap", "json_ld", "html_selector", "csv_download"]);
const SOURCE_KINDS = new Set(["ats", "career_page", "portal", "gov_portal", "community", "aggregator_feed", "search_dork", "sponsor_registry", "curated_list"]);
const SOURCE_METHODS = new Set(["json_api", "rss", "sitemap", "json_ld", "html_selector", "headless", "csv_download", "custom_adapter"]);
const SOURCE_ROLES = new Set(["discovery", "job_record", "contact"]);
const SOURCE_TRUST = new Set(["official", "public_listing", "derived"]);
const SOURCE_STATUSES = new Set(["candidate", "active", "paused", "blocked", "retired"]);

export type SourceInput = {
  name: string;
  url?: string;
  kind?: string;
  countries?: string[];
  roles?: string[];
  method?: string;
  config?: Record<string, unknown>;
  trust?: string;
  autoAdmit?: boolean;
};

function requireEnum(value: string, field: string, allowed: Set<string>): string {
  if (!allowed.has(value)) throw new ApiError(400, "validation_error", `${field} is invalid.`, { field });
  return value;
}

function publicUrl(value: string, field = "url"): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "validation_error", `${field} must be an absolute URL.`, { field });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiError(400, "validation_error", `${field} must use HTTP or HTTPS.`, { field });
  }
  if (/(login|signin|sign-in|account)/i.test(url.pathname)) {
    throw new ApiError(400, "login_source", "JobSniper only accepts public sources without login.");
  }
  return url;
}

function companyDomain(value: string): string {
  const normalized = value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) {
    throw new ApiError(400, "validation_error", "domain must be a valid company hostname.");
  }
  return normalized;
}

function companyView(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    tier: `T${row.tier}`,
    tierLevel: row.tier,
    sourceCount: Number(row.source_count ?? 0),
    health: row.health ?? "ok",
    lastRunAt: row.last_run_at ?? null,
    nextDueAt: row.next_due_at ?? null,
  };
}

function sourceView(row: Record<string, unknown>): Record<string, unknown> {
  const raw = (row.yield_stats ?? {}) as Record<string, unknown>;
  const itemsSeen = Number(raw.itemsSeen ?? 0);
  const relevantJobs = Number(raw.relevantJobs ?? 0);
  const duplicateJobs = Number(raw.duplicateJobs ?? 0);
  const failures = Number(raw.failures ?? 0);
  const config = (row.config ?? {}) as Record<string, unknown>;
  const trialUntil = row.trial_until ?? row.trialUntil;
  return {
    ...row,
    trialUntil: trialUntil instanceof Date ? trialUntil.toISOString() : trialUntil,
    configUrl: typeof config.url === "string" ? config.url : "",
    yieldStats: {
      itemsSeen,
      relevantJobs,
      duplicateJobs,
      failures,
      relevantPer100: itemsSeen === 0 ? 0 : Number(((relevantJobs / itemsSeen) * 100).toFixed(2)),
      duplicateRatio: itemsSeen === 0 ? 0 : Number(((duplicateJobs / itemsSeen) * 100).toFixed(2)),
      failureRate: itemsSeen === 0 ? 0 : Number(((failures / itemsSeen) * 100).toFixed(2)),
      lastFoundAt: raw.lastYieldAt ?? null,
      firstYieldAt: raw.firstYieldAt ?? null,
    },
  };
}

export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly crawl: CrawlEnqueuer,
    private readonly jev: JevPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly dashboard: DashboardDependencies,
    private readonly getSettings: () => Promise<Settings>,
  ) {}

  async listCompanies(): Promise<Array<Record<string, unknown>>> {
    return (await this.repository.listCompanies()).map(companyView);
  }

  async getCompany(id: string): Promise<Record<string, unknown>> {
    const row = await this.repository.getCompany(id);
    if (!row) throw new ApiError(404, "company_not_found", "Company was not found.");
    return companyView(row);
  }

  async addCompany(input: {
    domain: string;
    name?: string;
    country?: string;
    industry?: string;
    tier?: number;
  }): Promise<Record<string, unknown>> {
    const domain = companyDomain(input.domain);
    return companyView(await this.repository.insertCompany({
      id: this.ids.newId(),
      name: input.name?.trim() || domain.split(".")[0]!.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      domain,
      country: (input.country ?? "GLOBAL").toUpperCase(),
      industry: input.industry ?? null,
      tier: input.tier ?? 3,
      discoveredVia: "manual",
      sponsorRegistryHit: false,
    }));
  }

  async crawlCompany(id: string): Promise<Record<string, unknown>> {
    const company = await this.repository.getCompany(id);
    if (!company) throw new ApiError(404, "company_not_found", "Company was not found.");
    const now = this.clock.now();
    const payload = { kind: "crawl", company_id: String(company.id), url: `https://${String(company.domain)}` };
    const enqueued = this.crawl.enqueueCrawl
      ? await this.crawl.enqueueCrawl({ sourceId: null, payload, dedupeKey: `manual-crawl:${company.id}:${now.toISOString()}` })
      : await this.crawl.enqueueDiscovery({ sourceId: null, payload, dedupeKey: `manual-crawl:${company.id}:${now.toISOString()}` });
    return { id, enqueued, kind: "crawl" };
  }

  async companyAction(id: string, action: "force_crawl" | "pause" | "resume"): Promise<Record<string, unknown>> {
    if (action === "force_crawl") return this.crawlCompany(id);
    const company = await this.repository.getCompany(id);
    if (!company) throw new ApiError(404, "company_not_found", "Company was not found.");
    if (action === "pause") await this.repository.pauseCompany(id, new Date("9999-12-31T00:00:00Z"));
    else await this.repository.resumeCompany(id, this.clock.now());
    return { id, action };
  }

  async listSources(filters: { status?: string; country?: string }): Promise<Array<Record<string, unknown>>> {
    return (await this.repository.listSources(filters)).map(sourceView);
  }

  async getSource(id: string): Promise<Record<string, unknown>> {
    const row = await this.repository.getSource(id);
    if (!row) throw new ApiError(404, "source_not_found", "Source was not found.");
    return sourceView(row);
  }

  async addSource(input: SourceInput): Promise<Record<string, unknown>> {
    const url = input.url ? publicUrl(input.url) : publicUrl(String(input.config?.url ?? ""), "config.url");
    const config = { ...(input.config ?? {}), url: url.toString() };
    const kind = requireEnum(input.kind ?? (/(greenhouse|lever|ashby|workday|bamboohr|workable|teamtailor)/i.test(url.hostname) ? "ats" : "portal"), "kind", SOURCE_KINDS);
    const method = requireEnum(input.method ?? "html_selector", "method", SOURCE_METHODS);
    const trust = requireEnum(input.trust ?? (kind === "ats" || kind === "career_page" ? "official" : "public_listing"), "trust", SOURCE_TRUST);
    const roles = input.roles ?? ["discovery", "job_record"];
    if (roles.length === 0 || roles.some((role) => !SOURCE_ROLES.has(role))) throw new ApiError(400, "validation_error", "roles must contain discovery, job_record, or contact.");
    const countries = input.countries ?? ["global"];
    if (countries.length === 0 || countries.some((country) => typeof country !== "string" || country.trim().length === 0)) {
      throw new ApiError(400, "validation_error", "countries must contain at least one country code.");
    }
    const id = this.ids.newId();
    const decision = await this.jev.decide({
      decisionId: "source_admit",
      subjectType: "source",
      subjectId: id,
      input: {
        name: input.name,
        kind,
        countries,
        method,
        config,
        publicAccess: true,
        evidence: [{ quote: url.toString(), source: url.toString(), reason: "Candidate public source URL." }],
      },
    });
    const highConfidence = decision.confidence >= 0.75 && decision.verdict.value === true;
    const autoActive = input.autoAdmit !== false && highConfidence && GENERIC_METHODS.has(method);
    return sourceView(await this.repository.insertSource({
      id,
      name: input.name,
      kind,
      countries: countries.map((country) => country.toUpperCase() === "GLOBAL" ? "global" : country.toUpperCase()),
      roles,
      method,
      config,
      trust,
      status: autoActive ? "active" : "candidate",
      admittedBy: autoActive ? "jev" : null,
      trialUntil: autoActive ? new Date(this.clock.now().getTime() + 7 * 86_400_000) : null,
    }));
  }

  async patchSource(id: string, patch: {
    status?: string;
    config?: Record<string, unknown>;
    countries?: string[];
    roles?: string[];
    trialUntil?: string | null;
    lastError?: string | null;
    admittedBy?: string | null;
  }): Promise<Record<string, unknown>> {
    if (patch.status) requireEnum(patch.status, "status", SOURCE_STATUSES);
    if (patch.roles?.some((role) => !SOURCE_ROLES.has(role))) throw new ApiError(400, "validation_error", "roles is invalid.");
    let trialUntil: Date | null | undefined;
    if (patch.trialUntil !== undefined) {
      if (patch.trialUntil === null) trialUntil = null;
      else {
        const date = new Date(patch.trialUntil);
        if (Number.isNaN(date.getTime())) throw new ApiError(400, "validation_error", "trialUntil must be an ISO date.");
        trialUntil = date;
      }
    }
    const source = await this.repository.patchSource(id, {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.countries === undefined ? {} : { countries: patch.countries.map((country) => country.toUpperCase()) }),
      ...(patch.roles === undefined ? {} : { roles: patch.roles }),
      ...(trialUntil === undefined ? {} : { trialUntil }),
      ...(patch.lastError === undefined ? {} : { lastError: patch.lastError }),
      ...(patch.admittedBy === undefined ? {} : { admittedBy: patch.admittedBy }),
    });
    if (!source) throw new ApiError(404, "source_not_found", "Source was not found.");
    return sourceView(source);
  }

  async sourceAction(id: string, action: "approve" | "reject" | "pause" | "resume"): Promise<Record<string, unknown>> {
    const source = await this.repository.getSource(id);
    if (!source) throw new ApiError(404, "source_not_found", "Source was not found.");
    const patch = action === "approve"
      ? { status: "active", admittedBy: "brian", trialUntil: new Date(this.clock.now().getTime() + 7 * 86_400_000).toISOString() }
      : action === "reject"
        ? { status: "retired", lastError: null }
        : action === "pause"
          ? { status: "paused", lastError: "Paused by Brian." }
          : { status: "active", lastError: null, trialUntil: new Date(this.clock.now().getTime() + 7 * 86_400_000).toISOString() };
    return this.patchSource(id, patch);
  }

  async recordYield(input: {
    sourceId: string;
    items?: number;
    relevant?: number;
    duplicate?: boolean;
    failed?: boolean;
  }): Promise<Record<string, unknown>> {
    const source = await this.repository.getSource(input.sourceId);
    if (!source) throw new ApiError(404, "source_not_found", "Source was not found.");
    const settings = await this.getSettings();
    const raw = (source.yield_stats ?? {}) as Record<string, unknown>;
    const current: YieldStats = {
      itemsSeen: Number(raw.itemsSeen ?? 0),
      relevantJobs: Number(raw.relevantJobs ?? 0),
      duplicateJobs: Number(raw.duplicateJobs ?? 0),
      failures: Number(raw.failures ?? 0),
      firstYieldAt: typeof raw.firstYieldAt === "string" ? raw.firstYieldAt : null,
      lastYieldAt: typeof raw.lastYieldAt === "string" ? raw.lastYieldAt : null,
    };
    const now = this.clock.now();
    const next = updateYieldStats(current, { ...input, at: now });
    const startedAt = source.created_at ? new Date(String(source.created_at)) : now;
    const suggested = sourceYieldAction(next, settings.sourceYield, now, startedAt);
    const status = source.status === "active" && suggested === "paused" ? "paused" : undefined;
    await this.repository.updateYield(input.sourceId, next, status);
    return sourceView({ ...source, yield_stats: next, ...(status ? { status } : {}) });
  }

  async dashboardStatus(): Promise<Record<string, unknown>> {
    const [scheduler, brain, outreach, monthlyLlmSpend, blockedSources] = await Promise.all([
      this.dashboard.schedulerStatus(),
      this.dashboard.brainStatus(),
      this.dashboard.outreachStatus(),
      this.dashboard.monthlyLlmSpend(),
      this.repository.blockedCount(),
    ]);
    return { scheduler, brain, outreach, monthlyLlmSpendUsd: monthlyLlmSpend, blockedSources, refreshedAt: this.clock.now().toISOString(), realtime: false };
  }
}
