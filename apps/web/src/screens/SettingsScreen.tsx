import { useState } from "react";
import type { Profile } from "../types.ts";
import { Notice, PageHeader } from "../components/States.tsx";

interface Props {
  settings: Profile;
  loading: boolean;
  error: string | null;
  onSave: (settings: Profile) => Promise<boolean>;
}

export function SettingsScreen({ settings, loading, error, onSave }: Props) {
  const [form, setForm] = useState<Profile>(settings);
  const [saved, setSaved] = useState(false);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateScore = (key: keyof Profile["scoreWeights"], value: number) => setForm((current) => ({ ...current, scoreWeights: { ...current.scoreWeights, [key]: value } }));
  const updateCountry = (index: number, value: number) => setForm((current) => ({ ...current, countries: current.countries.map((country, itemIndex) => itemIndex === index ? { ...country, weight: value } : country) }));
  const submit = async () => {
    const succeeded = await onSave(form);
    setSaved(succeeded);
  };
  return (
    <div className="screen">
      <PageHeader eyebrow="Workspace controls" title="Settings" description="Keep the profile grounded, the crawl policy explicit, and every outbound limit visible." actions={<button className="button button-primary" onClick={submit} disabled={loading}>{loading ? "Saving..." : "Save settings"}</button>} />
      {error ? <Notice tone="warning">{error}</Notice> : null}
      {saved ? <Notice tone="success">Settings saved to the local API.</Notice> : null}
      <div className="settings-layout">
        <section className="settings-section">
          <div className="section-intro"><h2>Candidate profile</h2><p>Used to personalize every grounded draft.</p></div>
          <div className="form-grid">
            <label className="field"><span>Name</span><input value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
            <label className="field"><span>Primary email</span><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
            <label className="field"><span>Location</span><input value={form.location} onChange={(event) => update("location", event.target.value)} /></label>
            <label className="field"><span>Availability</span><input value={form.availability} onChange={(event) => update("availability", event.target.value)} /></label>
            <label className="field field-full"><span>Profile summary</span><textarea rows={4} value={form.summary} onChange={(event) => update("summary", event.target.value)} /></label>
            <label className="field field-full"><span>Skills</span><input value={form.skills.join(", ")} onChange={(event) => update("skills", event.target.value.split(",").map((skill) => skill.trim()).filter(Boolean))} /></label>
          </div>
        </section>
        <section className="settings-section">
          <div className="section-intro"><h2>CV variants</h2><p>Choose the closest variant automatically per role type.</p></div>
          <div className="settings-list">{form.cvVariants.map((variant) => <div className="settings-row" key={variant.id}><div><strong>{variant.name}</strong><span>{variant.fileName}</span></div><span className="status-chip status-active">{variant.roleType}</span></div>)}</div>
        </section>
        <section className="settings-section">
          <div className="section-intro"><h2>Country weights</h2><p>Neutral weights are used when a country is not listed.</p></div>
          <div className="country-grid">{form.countries.map((country, index) => <label className="country-row" key={country.code}><span><strong>{country.name}</strong><code>{country.code}</code></span><input type="number" min="0" max="100" value={country.weight} onChange={(event) => updateCountry(index, Number(event.target.value))} /></label>)}</div>
        </section>
        <section className="settings-section">
          <div className="section-intro"><h2>Score weights</h2><p>Weights are normalized during scoring and remain visible in every target.</p></div>
          <div className="weight-grid">{Object.entries(form.scoreWeights).map(([key, value]) => <label className="field" key={key}><span>{key === "skillOverlapCv" ? "Skill overlap CV" : key === "modeVisa" ? "Mode / visa" : key}</span><input type="number" min="0" max="100" value={value} onChange={(event) => updateScore(key as keyof Profile["scoreWeights"], Number(event.target.value))} /></label>)}</div>
        </section>
        <section className="settings-section">
          <div className="section-intro"><h2>Outbound limits</h2><p>These limits apply before a message can enter the send queue.</p></div>
          <div className="form-grid">
            <label className="field field-full"><span>Sender identity</span><input value={form.sender} onChange={(event) => update("sender", event.target.value)} /></label>
            <label className="field"><span>Daily email cap</span><input type="number" min="1" max="100" value={form.dailyCap} onChange={(event) => update("dailyCap", Number(event.target.value))} /></label>
            <label className="field"><span>Monthly LLM budget (USD)</span><input type="number" min="1" value={form.llmBudgetUsd} onChange={(event) => update("llmBudgetUsd", Number(event.target.value))} /></label>
          </div>
        </section>
      </div>
    </div>
  );
}
