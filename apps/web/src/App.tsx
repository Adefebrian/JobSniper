import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.ts";
import { AppShell } from "./components/AppShell.tsx";
import { ErrorState, LoadingState, Notice } from "./components/States.tsx";
import { CompaniesSourcesScreen } from "./screens/CompaniesSourcesScreen.tsx";
import { OutreachScreen } from "./screens/OutreachScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { TargetsScreen } from "./screens/TargetsScreen.tsx";
import { sampleData } from "./sample-data.ts";
import { downloadBlob } from "./utils.ts";
import type { DashboardData, JobAction, JobTarget, Outreach, OutboxAction, Profile, Source } from "./types.ts";

type AppRoute = "targets" | "outreach" | "companies" | "settings";

const getRoute = (): AppRoute => {
  const queryRoute = new URLSearchParams(window.location.search).get("route") ?? "";
  const route = queryRoute || (window.location.hash.replace("#/", "").split("/")[0] ?? "");
  return ["targets", "outreach", "companies", "settings"].includes(route) ? route as AppRoute : "targets";
};

export function App() {
  const [route, setRoute] = useState(getRoute);
  const [data, setData] = useState<DashboardData>(sampleData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSnapshot, setUsingSnapshot] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await api.getDashboard();
      setData(fresh);
      setError(null);
      setUsingSnapshot(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The local API is unavailable.");
      setUsingSnapshot(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const refresh = window.setInterval(loadData, 60_000);
    const handleHash = () => setRoute(getRoute());
    window.addEventListener("hashchange", handleHash);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("hashchange", handleHash);
    };
  }, [loadData]);

  const onJobAction = async (job: JobTarget, action: JobAction) => {
    try {
      const updated = await api.actOnTarget(job.id, action);
      setData((current) => ({ ...current, targets: current.targets.map((item) => item.id === updated.id ? updated : item) }));
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Target action failed.");
      return false;
    }
  };
  const onOutreachAction = async (item: Outreach, action: OutboxAction) => {
    try {
      const updated = await api.updateOutreach(item.id, action);
      setData((current) => ({ ...current, outreach: current.outreach.map((entry) => entry.id === updated.id ? updated : entry) }));
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Outreach action failed.");
      return false;
    }
  };
  const onCompanyAction = async (company: { id: string }, action: "force_crawl" | "pause" | "resume") => {
    try {
      await api.actOnCompany(company.id, action);
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Company action failed.");
      return false;
    }
  };
  const onSourceAction = async (source: Source, action: "approve" | "reject" | "pause" | "resume") => {
    try {
      const updated = await api.actOnSource(source.id, action);
      setData((current) => ({ ...current, sources: current.sources.map((entry) => entry.id === updated.id ? updated : entry) }));
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Source action failed.");
      return false;
    }
  };
  const onAddCompany = async (domain: string) => {
    try {
      await api.addCompanyDomain(domain);
      await loadData();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Company add failed.");
      return false;
    }
  };
  const onAddSource = async (input: { name: string; url: string; method: string }) => {
    try {
      await api.addSource(input);
      await loadData();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Source add failed.");
      return false;
    }
  };
  const onSaveSettings = async (settings: Profile) => {
    try {
      const saved = await api.saveSettings(settings);
      setData((current) => ({ ...current, settings: saved }));
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings save failed.");
      return false;
    }
  };
  const onExport = async (kind: "targets" | "outreach", format: "csv" | "xlsx") => {
    try {
      const blob = await api.exportData(kind, format);
      downloadBlob(blob, `jobsniper-${kind}-${new Date().toISOString().slice(0, 10)}.${format}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    }
  };

  const status = data.status;
  const screen = useMemo(() => {
    if (loading && !usingSnapshot) return <LoadingState />;
    if (route === "targets") return <TargetsScreen targets={data.targets} loading={loading} error={usingSnapshot ? error : null} onAction={onJobAction} onExport={(format) => onExport("targets", format)} />;
    if (route === "outreach") return <OutreachScreen outreach={data.outreach} loading={loading} error={usingSnapshot ? error : null} onAction={onOutreachAction} onExport={(format) => onExport("outreach", format)} />;
    if (route === "companies") return <CompaniesSourcesScreen companies={data.companies} sources={data.sources} loading={loading} error={usingSnapshot ? error : null} onCompanyAction={onCompanyAction} onSourceAction={onSourceAction} onAddCompany={onAddCompany} onAddSource={onAddSource} />;
    return <SettingsScreen settings={data.settings} loading={loading} error={usingSnapshot ? error : null} onSave={onSaveSettings} />;
  }, [data, error, loading, route, usingSnapshot]);

  return <AppShell route={route} status={status}>{error && !usingSnapshot ? <Notice tone="warning">{error}</Notice> : null}{screen}</AppShell>;
}
