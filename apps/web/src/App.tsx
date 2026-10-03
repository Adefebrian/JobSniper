import { useCallback, useEffect, useState } from "react";
import * as api from "./api.ts";
import { AppShell } from "./components/AppShell.tsx";
import { LoadingState, Notice } from "./components/States.tsx";
import { CompaniesSourcesScreen } from "./screens/CompaniesSourcesScreen.tsx";
import { OutreachScreen } from "./screens/OutreachScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { TargetsScreen } from "./screens/TargetsScreen.tsx";
import { downloadBlob, filterTargets } from "./utils.ts";
import type { DashboardData, Feedback, JobAction, JobTarget, Outreach, OutboxAction, Profile, Source } from "./types.ts";

type AppRoute = "targets" | "outreach" | "companies" | "settings";

const EMPTY: DashboardData = {
  targets: [], outreach: [], companies: [], sources: [],
  settings: { name: "", email: "", location: "", summary: "", skills: [], availability: "", cvVariants: [], countries: [],
    scoreWeights: { roleFit: 1, seniority: 1, modeVisa: 1, freshness: 1, skillOverlapCv: 1 }, sender: "", dailyCap: 20, llmBudgetUsd: 30 },
  status: { lastRunT1: "", lastRunT2: "", lastRunT3: "", queueDepth: 0, llmSpendUsd: 0, blockedSources: 0 },
};

const ROUTES: AppRoute[] = ["targets", "outreach", "companies", "settings"];

/** Reads "#/targets/<id>", "#targets", or "?route=settings". */
const readLocation = (): { route: AppRoute; id: string | null } => {
  const queryRoute = new URLSearchParams(window.location.search).get("route") ?? "";
  const parts = window.location.hash.replace(/^#\/?/, "").split("/");
  const route = (queryRoute || parts[0] || "") as AppRoute;
  if (!ROUTES.includes(route)) return { route: "targets", id: null };
  return { route, id: route === "targets" && parts[1] ? decodeURIComponent(parts[1]) : null };
};

const message = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

export function App() {
  const [location, setLocation] = useState(readLocation);
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setData(await api.getDashboard());
      setError(null);
    } catch (caught) {
      setError(message(caught, "The local API is unavailable."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadData();
    const refresh = window.setInterval(loadData, 60_000);
    const handleHash = () => setLocation(readLocation());
    window.addEventListener("hashchange", handleHash);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("hashchange", handleHash);
    };
  }, [loadData]);

  const run = async (task: () => Promise<void>, fallback: string) => {
    try {
      await task();
      setError(null);
      return true;
    } catch (caught) {
      setError(message(caught, fallback));
      return false;
    }
  };

  const onJobAction = (job: JobTarget, action: JobAction) => run(async () => {
    const updated = await api.actOnTarget(job.id, action);
    setData((current) => ({
      ...current,
      targets: action === "blacklist"
        ? current.targets.filter((item) => item.companyId !== job.companyId)
        : current.targets.map((item) => item.id === job.id ? { ...item, ...updated, contacts: updated.contacts ?? item.contacts } : item),
    }));
    if (action === "draft") void loadData();
  }, "Target action failed.");

  const mergeTarget = (updated: JobTarget) => setData((current) => ({
    ...current,
    targets: current.targets.map((item) => item.id === updated.id ? { ...item, ...updated, contacts: updated.contacts ?? item.contacts } : item),
  }));

  const onFeedback = (job: JobTarget, verdict: Feedback | "clear", note?: string) => run(async () => {
    mergeTarget(await api.sendFeedback(job.id, verdict, note));
    // Feedback re-scores the top targets on the server; pick the new order up quietly.
    void loadData();
  }, "Feedback was not saved.");

  const onOutreachAction = (item: Outreach, action: OutboxAction) => run(async () => {
    const updated = await api.updateOutreach(item.id, action);
    setData((current) => ({ ...current, outreach: current.outreach.map((entry) => entry.id === updated.id ? updated : entry) }));
  }, "Outreach action failed.");

  const onCompanyAction = (company: { id: string }, action: "force_crawl" | "pause" | "resume") => run(async () => {
    await api.actOnCompany(company.id, action);
  }, "Company action failed.");

  const onSourceAction = (source: Source, action: "approve" | "reject" | "pause" | "resume") => run(async () => {
    const updated = await api.actOnSource(source.id, action);
    setData((current) => ({ ...current, sources: current.sources.map((entry) => entry.id === updated.id ? { ...entry, ...updated } : entry) }));
  }, "Source action failed.");

  const onAddCompany = (domain: string) => run(async () => {
    await api.addCompanyDomain(domain);
    await loadData();
  }, "Company add failed.");

  const onAddSource = (input: { name: string; url: string; method: string }) => run(async () => {
    await api.addSource(input);
    await loadData();
  }, "Source add failed.");

  const onSaveSettings = (settings: Profile) => run(async () => {
    const saved = await api.saveSettings(settings);
    setData((current) => ({ ...current, settings: saved }));
  }, "Settings save failed.");

  const onReloadSettings = async () => {
    const fresh = await api.getSettings();
    setData((current) => ({ ...current, settings: fresh }));
    return fresh;
  };

  const onExport = async (kind: "targets" | "outreach", format: "csv" | "xlsx") => {
    await run(async () => {
      const blob = await api.exportData(kind, format);
      downloadBlob(blob, `jobsniper-${kind}-${new Date().toISOString().slice(0, 10)}.${format}`);
    }, "Export failed.");
  };

  const { route, id } = location;
  let screen;
  if (!loaded) screen = <LoadingState />;
  else if (route === "targets") screen = <TargetsScreen targets={data.targets} selectedId={id} onAction={onJobAction} onFeedback={onFeedback} onTargetUpdate={mergeTarget} onExport={(format) => onExport("targets", format)} />;
  else if (route === "outreach") screen = <OutreachScreen outreach={data.outreach} dailyCap={data.settings.dailyCap} onAction={onOutreachAction} onExport={(format) => onExport("outreach", format)} />;
  else if (route === "companies") screen = <CompaniesSourcesScreen companies={data.companies} sources={data.sources} onCompanyAction={onCompanyAction} onSourceAction={onSourceAction} onAddCompany={onAddCompany} onAddSource={onAddSource} />;
  else screen = <SettingsScreen settings={data.settings} onSave={onSaveSettings} onReloadSettings={onReloadSettings} />;

  return (
    <AppShell route={route} status={data.status} counts={{
      targets: filterTargets(data.targets, {}).length,
      outreach: data.outreach.filter((item) => item.status === "draft" || item.status === "followup_due").length,
      companies: data.companies.length,
    }}>
      <div className={route === "targets" ? "page page-split" : "page"}>
        {error ? <Notice tone="warning" title="API problem">{error}</Notice> : null}
        {screen}
      </div>
    </AppShell>
  );
}
