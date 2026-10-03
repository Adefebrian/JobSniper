import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as api from "../api.ts";
import type { ConnectionName, Connections, Profile, StatusStrip } from "../types.ts";
import { FIT_LABELS, tidyName } from "../utils.ts";
import { Badge, Button, Card, Field, Meter, Notice, PageHeader, Section, TextArea, TextInput } from "../components/ui/index.ts";

interface Props {
  status: StatusStrip;
  settings: Profile;
  onSave: (settings: Profile) => Promise<boolean>;
  onReloadSettings: () => Promise<Profile>;
}

const SECRETS: { name: ConnectionName; label: string; help: string }[] = [
  { name: "OPENAI_API_KEY", label: "OpenAI API key", help: "Judging, drafting, and CV tailoring." },
  { name: "JEV_API_KEY", label: "Jev API key", help: "Verifies jobs and contacts before anything is sent." },
  { name: "GMAIL_CLIENT_ID", label: "Gmail client ID", help: "From your Google Cloud OAuth client." },
  { name: "GMAIL_CLIENT_SECRET", label: "Gmail client secret", help: "From the same OAuth client." },
  { name: "SMTP_PASSWORD", label: "SMTP password", help: "Only when sending through SMTP instead of Gmail." },
];

const DEFAULT_CV_PATH = "~/Documents/CV_Ade_Febrian_AI_Engineer.docx";

const errorText = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

/** A titled group of field rows on one card, like a System Settings pane. */
function Group({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Section title={title} description={description} action={action}>
      <Card flush className="field-group">{children}</Card>
    </Section>
  );
}

export function SettingsScreen({ status, settings, onSave, onReloadSettings }: Props) {
  const [form, setForm] = useState<Profile>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setForm(settings); }, [settings, dirty]);
  const touch = () => { setSaved(false); setDirty(true); };
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => { setForm((current) => ({ ...current, [key]: value })); touch(); };
  const updateScore = (key: keyof Profile["scoreWeights"], value: number) => { setForm((current) => ({ ...current, scoreWeights: { ...current.scoreWeights, [key]: value } })); touch(); };
  const updateCountry = (index: number, value: number) => { setForm((current) => ({ ...current, countries: current.countries.map((country, itemIndex) => itemIndex === index ? { ...country, weight: value } : country) })); touch(); };

  const submit = async () => {
    setSaving(true);
    const ok = await onSave(form);
    setSaving(false);
    if (ok) { setSaved(true); setDirty(false); }
  };

  const budget = form.llmBudgetUsd || 0;
  const spend = status.llmSpendUsd ?? 0;

  return (
    <div className="pane settings">
      <PageHeader title="Settings" actions={
        <>
          {saved ? <span className="saved-note" role="status">Saved</span> : null}
          <Button variant="primary" busy={saving} disabled={!dirty || saving} onClick={submit}>{saving ? "Saving" : "Save changes"}</Button>
        </>
      } />
      <div className="pane-body settings-columns">
        <div className="settings-column">
          <Group title="Profile" description="Every draft and greeting is built from this.">
            <Field layout="row" label="Name" htmlFor="set-name"><TextInput id="set-name" value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
            <Field layout="row" label="Nickname" hint="What JobSniper calls you." htmlFor="set-nick"><TextInput id="set-nick" value={form.nickname ?? ""} onChange={(event) => update("nickname", event.target.value)} placeholder="Brian" /></Field>
            <Field layout="row" label="Weekly goal" hint="Applications per week." htmlFor="set-goal"><TextInput id="set-goal" type="number" min={1} max={100} value={form.weeklyGoal ?? 10} onChange={(event) => update("weeklyGoal", Number(event.target.value))} /></Field>
            <Field layout="row" label="Email" htmlFor="set-email"><TextInput id="set-email" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
            <Field layout="row" label="Location" htmlFor="set-location"><TextInput id="set-location" value={form.location} onChange={(event) => update("location", event.target.value)} /></Field>
            <Field layout="row" label="Availability" htmlFor="set-availability"><TextInput id="set-availability" value={form.availability} onChange={(event) => update("availability", event.target.value)} placeholder="30 days notice" /></Field>
            <Field layout="row" label="Skills" hint="Comma separated." htmlFor="set-skills"><TextInput id="set-skills" value={form.skills.join(", ")} onChange={(event) => update("skills", event.target.value.split(",").map((skill) => skill.trim()).filter(Boolean))} /></Field>
            <Field layout="stack" label="Summary" htmlFor="set-summary"><TextArea id="set-summary" rows={4} value={form.summary} onChange={(event) => update("summary", event.target.value)} /></Field>
          </Group>

          <CvImport variants={form.cvVariants} onImported={async () => { setForm(await onReloadSettings()); setDirty(false); }} />

          <Group title="Sending" description="Checked before a message can enter the send queue.">
            <Field layout="row" label="Sender" hint="Name and address." htmlFor="set-sender"><TextInput id="set-sender" value={form.sender} onChange={(event) => update("sender", event.target.value)} placeholder="Brian <you@example.com>" /></Field>
            <Field layout="row" label="Daily cap" hint="Emails per day, at most." htmlFor="set-cap"><TextInput id="set-cap" type="number" min={1} max={100} value={form.dailyCap} onChange={(event) => update("dailyCap", Number(event.target.value))} /></Field>
          </Group>

        </div>

        <div className="settings-column">
          <ConnectionsGroup />
          <Group title="Budget" description="Tailoring and drafting stop when the month's cap is reached.">
            <Field layout="row" label="Monthly LLM budget" hint="In US dollars." htmlFor="set-budget"><TextInput id="set-budget" type="number" min={1} value={form.llmBudgetUsd} onChange={(event) => update("llmBudgetUsd", Number(event.target.value))} /></Field>
            <div className="ui-field ui-field--row">
              <div className="ui-field-text"><span className="ui-field-label">Spent this month</span><span className="ui-field-hint tabular">${spend.toFixed(2)} of ${budget.toFixed(0)}</span></div>
              <div className="ui-field-control"><Meter value={spend} max={budget || 1} tone={budget && spend / budget > 0.8 ? "warning" : "accent"} label={`$${spend.toFixed(2)} of $${budget} spent`} /></div>
            </div>
          </Group>


          <Group title="Countries and weights" description="How much each country and each score part counts. Unlisted countries use Other.">
            <div className="weight-grid">
              {form.countries.map((country, index) => (
                <Field key={country.code} label={country.name} htmlFor={`w-${country.code}`}>
                  <TextInput id={`w-${country.code}`} type="number" min={0} step="any" value={country.weight} onChange={(event) => updateCountry(index, Number(event.target.value))} />
                </Field>
              ))}
            </div>
            <div className="weight-grid">
              {Object.entries(form.scoreWeights).map(([key, value]) => (
                <Field key={key} label={FIT_LABELS[key] ?? key} htmlFor={`s-${key}`}>
                  <TextInput id={`s-${key}`} type="number" min={0} step="any" value={value} onChange={(event) => updateScore(key as keyof Profile["scoreWeights"], Number(event.target.value))} />
                </Field>
              ))}
            </div>
          </Group>
        </div>
      </div>
    </div>
  );
}

function CvImport({ variants, onImported }: { variants: Profile["cvVariants"]; onImported: () => Promise<void> }) {
  const [cvPath, setCvPath] = useState(DEFAULT_CV_PATH);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ tone: "positive" | "warning"; text: string } | null>(null);
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(null);
  const run = async () => {
    if (!cvPath.trim()) return;
    setImporting(true);
    try {
      const result = await api.importCv(cvPath.trim());
      setExtracted(result?.profile ?? null);
      await onImported();
      setMessage({ tone: "positive", text: "CV imported. The profile was filled from it." });
    } catch (caught) {
      setMessage({ tone: "warning", text: errorText(caught, "The CV could not be imported.") });
    } finally {
      setImporting(false);
    }
  };
  return (
    <Group title="CV" description="Imported once, then tailored per role. Skills on Overview are matched against it.">
      {message ? <div className="group-notice"><Notice tone={message.tone} title={message.text} onClose={() => setMessage(null)} /></div> : null}
      <form onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <Field layout="row" label="Import from file" hint=".docx or .pdf path on this Mac." htmlFor="cv-path">
          <div className="control-with-button">
            <TextInput id="cv-path" value={cvPath} onChange={(event) => setCvPath(event.target.value)} spellCheck={false} />
            <Button type="submit" busy={importing} disabled={importing || !cvPath.trim()}>{importing ? "Importing" : "Import"}</Button>
          </div>
        </Field>
      </form>
      {variants.map((variant) => (
        <div className="ui-field ui-field--row" key={variant.id}>
          <div className="ui-field-text"><span className="ui-field-label">{tidyName(variant.name)}</span><span className="ui-field-hint">Used for {tidyName(variant.roleType)} roles.</span></div>
          <div className="ui-field-control is-text">{variant.fileName ? variant.fileName : <Badge>No file yet</Badge>}</div>
        </div>
      ))}
      {extracted ? <ExtractedProfile profile={extracted} /> : null}
    </Group>
  );
}

function ConnectionsGroup() {
  const [status, setStatus] = useState<Connections | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "positive" | "warning"; text: string } | null>(null);

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
      setMessage({ tone: "positive", text: value ? `${label} saved to the Keychain.` : `${label} cleared.` });
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
      setMessage({ tone: "positive", text: "Gmail disconnected." });
      await refresh();
    } catch (caught) {
      setMessage({ tone: "warning", text: errorText(caught, "Gmail was not disconnected.") });
    }
  };
  const gmailReady = Boolean(status?.GMAIL_CLIENT_ID && status?.GMAIL_CLIENT_SECRET);

  return (
    <Group title="Connections" description="Keys live in the macOS Keychain. Saved values are never shown.">
      {loadError ? <div className="group-notice"><Notice tone="warning" title="Status unavailable">{loadError}</Notice></div> : null}
      {message ? <div className="group-notice"><Notice tone={message.tone} title={message.text} onClose={() => setMessage(null)} /></div> : null}
      <div className="ui-field ui-field--row">
        <div className="ui-field-text">
          <span className="ui-field-label">Gmail <StatusBadge value={status ? status.GMAIL_CONNECTED : null} on="Connected" off="Not connected" /></span>
          <span className="ui-field-hint">{gmailReady ? "Send from your own Gmail account." : "Save the Gmail client ID and secret first."}</span>
        </div>
        <div className="ui-field-control is-buttons">
          {status?.GMAIL_CONNECTED ? <Button variant="plain" onClick={disconnect}>Disconnect</Button> : null}
          {gmailReady ? <Button variant="primary" href={api.GMAIL_CONNECT_URL}>{status?.GMAIL_CONNECTED ? "Reconnect" : "Connect Gmail"}</Button> : <Button variant="primary" disabled>Connect Gmail</Button>}
        </div>
      </div>
      {SECRETS.map((secret) => (
        <SecretRow key={secret.name} {...secret} isSet={status ? status[secret.name] : null} onSave={(value) => saveSecret(secret.name, secret.label, value)} />
      ))}
    </Group>
  );
}

function StatusBadge({ value, on, off }: { value: boolean | null; on: string; off: string }) {
  if (value === null) return <Badge>Checking</Badge>;
  return <Badge tone={value ? "positive" : "neutral"}>{value ? on : off}</Badge>;
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
    <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) void save(value.trim()); }}>
      <Field layout="row" htmlFor={id} label={<>{label} <StatusBadge value={isSet} on="Saved" off="Not set" /></>} hint={help}>
        <div className="control-with-button">
          <TextInput id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} placeholder={isSet ? "Replace the saved value" : "Paste the value"} />
          <Button type="submit" busy={busy} disabled={busy || !value.trim()}>Save</Button>
          {isSet ? <Button variant="plain" disabled={busy} onClick={() => save("")}>Clear</Button> : null}
        </div>
      </Field>
    </form>
  );
}

const isText = (value: unknown): value is string | number => typeof value === "string" || typeof value === "number";
const labelFor = (key: string) => {
  const text = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};
const describe = (value: unknown): string => {
  if (isText(value)) return String(value);
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join(", ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(describe).filter(Boolean).join(", ");
  return "";
};

/** What the parser pulled out of the CV, one field row per key. */
function ExtractedProfile({ profile }: { profile: Record<string, unknown> }) {
  const entries = Object.entries(profile).filter(([, value]) => value !== null && value !== "" && !(Array.isArray(value) && value.length === 0));
  if (entries.length === 0) return <p className="card-note">Nothing could be extracted.</p>;
  return (
    <>
      {entries.map(([key, value]) => (
        <div className="ui-field ui-field--row" key={key}>
          <div className="ui-field-text"><span className="ui-field-label">{labelFor(key)}</span></div>
          <div className="ui-field-control is-text">
            {Array.isArray(value) && value.every(isText) && value.every((item) => String(item).length <= 40)
              ? <span className="badge-cloud">{value.map((item) => <Badge key={String(item)}>{String(item)}</Badge>)}</span>
              : describe(value)}
          </div>
        </div>
      ))}
    </>
  );
}
