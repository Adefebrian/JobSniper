import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as api from "../api.ts";
import type { ConnectionName, Connections, Profile } from "../types.ts";
import { Notice, PageHeader } from "../components/States.tsx";

interface Props {
  settings: Profile;
  onSave: (settings: Profile) => Promise<boolean>;
  onReloadSettings: () => Promise<Profile>;
}

const SECRETS: { name: ConnectionName; label: string; help: string }[] = [
  { name: "OPENAI_API_KEY", label: "OpenAI API key", help: "Used for judging and drafting." },
  { name: "JEV_API_KEY", label: "Jev API key", help: "Jev verifies jobs and contacts before anything is sent." },
  { name: "GMAIL_CLIENT_ID", label: "Gmail client ID", help: "From your Google Cloud OAuth client." },
  { name: "GMAIL_CLIENT_SECRET", label: "Gmail client secret", help: "From the same OAuth client." },
  { name: "SMTP_PASSWORD", label: "SMTP password", help: "Only needed when sending through SMTP instead of Gmail." },
];

const DEFAULT_CV_PATH = "~/Documents/CV_Ade_Febrian_AI_Engineer.docx";

const errorText = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

export function SettingsScreen({ settings, onSave, onReloadSettings }: Props) {
  const [form, setForm] = useState<Profile>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => { setForm((current) => ({ ...current, [key]: value })); setSaved(false); };
  const updateScore = (key: keyof Profile["scoreWeights"], value: number) => { setForm((current) => ({ ...current, scoreWeights: { ...current.scoreWeights, [key]: value } })); setSaved(false); };
  const updateCountry = (index: number, value: number) => { setForm((current) => ({ ...current, countries: current.countries.map((country, itemIndex) => itemIndex === index ? { ...country, weight: value } : country) })); setSaved(false); };

  const submit = async () => {
    setSaving(true);
    setSaved(await onSave(form));
    setSaving(false);
  };

  return (
    <div className="screen screen-settings">
      <PageHeader title="Settings" description="Connections first, then the profile every draft is built from." />

      <Connections onImported={async () => setForm(await onReloadSettings())} />

      <SettingsSection title="Candidate profile" description="Used to personalise every grounded draft.">
        <div className="form-grid">
          <label className="field"><span>Name</span><input value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
          <label className="field"><span>Primary email</span><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
          <label className="field"><span>Location</span><input value={form.location} onChange={(event) => update("location", event.target.value)} /></label>
          <label className="field"><span>Availability</span><input value={form.availability} onChange={(event) => update("availability", event.target.value)} /></label>
          <label className="field field-full"><span>Profile summary</span><textarea rows={4} value={form.summary} onChange={(event) => update("summary", event.target.value)} /></label>
          <label className="field field-full"><span>Skills, comma separated</span><input value={form.skills.join(", ")} onChange={(event) => update("skills", event.target.value.split(",").map((skill) => skill.trim()).filter(Boolean))} /></label>
        </div>
      </SettingsSection>

      <SettingsSection title="CV variants" description="The closest variant is picked per role type.">
        {form.cvVariants.length === 0 ? <p className="muted">No CV variants yet.</p> : (
          <ul className="rows">
            {form.cvVariants.map((variant) => (
              <li className="row" key={variant.id}>
                <div className="row-main"><strong>{variant.name}</strong><p className="muted">{variant.fileName || "No file attached"}</p></div>
                <span className="tag tag-plain">{variant.roleType}</span>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Country weights" description="Countries not listed use the Other weight.">
        <div className="weight-grid">
          {form.countries.map((country, index) => (
            <label className="field" key={country.code}>
              <span>{country.name}</span>
              <input type="number" min="0" step="any" value={country.weight} onChange={(event) => updateCountry(index, Number(event.target.value))} />
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Score weights" description="Normalised during scoring and shown on every target.">
        <div className="weight-grid">
          {Object.entries(form.scoreWeights).map(([key, value]) => (
            <label className="field" key={key}>
              <span>{SCORE_LABELS[key] ?? key}</span>
              <input type="number" min="0" step="any" value={value} onChange={(event) => updateScore(key as keyof Profile["scoreWeights"], Number(event.target.value))} />
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Outbound limits" description="Checked before a message can enter the send queue.">
        <div className="form-grid">
          <label className="field field-full"><span>Sender identity</span><input value={form.sender} onChange={(event) => update("sender", event.target.value)} placeholder="Name <you@example.com>" /></label>
          <label className="field"><span>Daily email cap</span><input type="number" min="1" max="100" value={form.dailyCap} onChange={(event) => update("dailyCap", Number(event.target.value))} /></label>
          <label className="field"><span>Monthly LLM budget, USD</span><input type="number" min="1" value={form.llmBudgetUsd} onChange={(event) => update("llmBudgetUsd", Number(event.target.value))} /></label>
        </div>
      </SettingsSection>

      <div className="save-bar">
        <button className="button button-primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Save profile and limits"}</button>
        {saved ? <span className="muted" role="status">Saved</span> : null}
      </div>
    </div>
  );
}

const SCORE_LABELS: Record<string, string> = {
  roleFit: "Role fit", seniority: "Seniority", modeVisa: "Mode and visa", freshness: "Freshness", skillOverlapCv: "Skill overlap with CV",
};

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-intro"><h2>{title}</h2><p className="muted">{description}</p></div>
      <div className="settings-body">{children}</div>
    </section>
  );
}

function Connections({ onImported }: { onImported: () => Promise<void> }) {
  const [status, setStatus] = useState<Connections | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [cvPath, setCvPath] = useState(DEFAULT_CV_PATH);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getConnections());
      setLoadError(null);
    } catch (caught) {
      setLoadError(errorText(caught, "Could not read connection status."));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveSecret = async (name: ConnectionName, label: string, value: string) => {
    try {
      await api.saveConnection(name, value);
      setMessage({ tone: "success", text: value ? `${label} saved to the Keychain.` : `${label} cleared.` });
      await refresh();
      return true;
    } catch (caught) {
      setMessage({ tone: "warning", text: errorText(caught, `${label} was not saved.`) });
      return false;
    }
  };

  const disconnect = async () => {
    try {
      await api.disconnectGmail();
      setMessage({ tone: "success", text: "Gmail disconnected." });
      await refresh();
    } catch (caught) {
      setMessage({ tone: "warning", text: errorText(caught, "Gmail was not disconnected.") });
    }
  };

  const importCv = async () => {
    if (!cvPath.trim()) return;
    setImporting(true);
    try {
      await api.importProfileFile(cvPath.trim());
      await onImported();
      setMessage({ tone: "success", text: "CV imported. The profile below was reloaded." });
    } catch (caught) {
      setMessage({ tone: "warning", text: errorText(caught, "The CV could not be imported.") });
    } finally {
      setImporting(false);
    }
  };

  const gmailReady = Boolean(status?.GMAIL_CLIENT_ID && status?.GMAIL_CLIENT_SECRET);

  return (
    <SettingsSection title="Connections" description="Keys are stored in the macOS Keychain. Stored values are never shown here.">
      {loadError ? <Notice tone="warning" title="Status unavailable">{loadError}</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ul className="rows">
        {SECRETS.map((secret) => (
          <SecretRow key={secret.name} {...secret} isSet={status ? status[secret.name] : null} onSave={(value) => saveSecret(secret.name, secret.label, value)} />
        ))}
        <li className="row connection-row">
          <div className="row-main">
            <div className="record-line"><strong>Gmail</strong><StatusTag value={status ? status.GMAIL_CONNECTED : null} on="Connected" off="Not connected" /></div>
            <p className="muted">{gmailReady ? "Sign in with Google to send from your Gmail account." : "Save the Gmail client ID and secret first."}</p>
          </div>
          <div className="row-actions">
            {status?.GMAIL_CONNECTED ? <button className="button button-secondary" onClick={disconnect}>Disconnect</button> : null}
            {gmailReady ? <a className="button button-primary" href={api.GMAIL_CONNECT_URL}>{status?.GMAIL_CONNECTED ? "Reconnect Gmail" : "Connect Gmail"}</a> : <button className="button button-primary" disabled>Connect Gmail</button>}
          </div>
        </li>
        <li className="row connection-row">
          <form className="row-main" onSubmit={(event) => { event.preventDefault(); void importCv(); }}>
            <label className="field">
              <span>Import CV from file</span>
              <div className="input-row">
                <input value={cvPath} onChange={(event) => setCvPath(event.target.value)} spellCheck={false} />
                <button className="button button-secondary" type="submit" disabled={importing || !cvPath.trim()}>{importing ? "Importing..." : "Import"}</button>
              </div>
            </label>
          </form>
        </li>
      </ul>
    </SettingsSection>
  );
}

function StatusTag({ value, on, off }: { value: boolean | null; on: string; off: string }) {
  if (value === null) return <span className="tag tag-plain">Checking</span>;
  return <span className={`tag ${value ? "tag-good" : "tag-plain"}`}>{value ? on : off}</span>;
}

function SecretRow({ name, label, help, isSet, onSave }: { name: ConnectionName; label: string; help: string; isSet: boolean | null; onSave: (value: string) => Promise<boolean> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (next: string) => {
    setBusy(true);
    if (await onSave(next)) setValue("");
    setBusy(false);
  };
  const id = `secret-${name}`;
  return (
    <li className="row connection-row">
      <form className="row-main" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void save(value.trim()); }}>
        <div className="record-line"><label htmlFor={id}><strong>{label}</strong></label><StatusTag value={isSet} on="Saved" off="Not set" /></div>
        <p className="muted">{help}</p>
        <div className="input-row">
          <input id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} placeholder={isSet ? "Enter a new value to replace it" : "Paste the value"} />
          <button className="button button-secondary" type="submit" disabled={busy || !value.trim()}>Save</button>
          {isSet ? <button className="button button-quiet" type="button" disabled={busy} onClick={() => save("")}>Clear</button> : null}
        </div>
      </form>
    </li>
  );
}
