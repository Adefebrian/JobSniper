import { useEffect, useMemo, useState } from "react";
import * as api from "../api.ts";
import type { Connections, Outreach, OutboxAction, Profile } from "../types.ts";
import { filterOutreach, formatDateTime, parseDate, tidyName } from "../utils.ts";
import { useMedia } from "./TargetsScreen.tsx";
import { Icon } from "../components/Icon.tsx";
import {
  Badge, Button, Card, EmptyState, Field, ListRow, MenuItem, Meta, Monogram, Notice, PageHeader, Popover, Segmented, Select, TextArea, TextInput,
  type BadgeTone,
} from "../components/ui/index.ts";

interface Props {
  settings: Profile;
  outreach: Outreach[];
  dailyCap: number;
  onAction: (item: Outreach, action: OutboxAction) => Promise<boolean>;
  onExport: (format: "csv" | "xlsx") => void;
}

type Tab = "draft" | "scheduled" | "sent" | "replied" | "followup_due";

const TABS: { value: Tab; label: string }[] = [
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "followup_due", label: "Follow-up" },
];

const STATUS: Record<Outreach["status"], { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "accent" },
  sent: { label: "Sent", tone: "neutral" },
  replied: { label: "Replied", tone: "positive" },
  followup_due: { label: "Follow-up due", tone: "warning" },
};

const EMPTY_COPY: Record<Tab, string> = {
  draft: "Open a target and press Draft email. Every draft waits here for your approval.",
  scheduled: "Approved emails wait here until their send slot.",
  sent: "Emails you approved and sent show here.",
  replied: "Replies from companies land here.",
  followup_due: "Pip lines up a follow-up when a sent email goes quiet.",
};

const whenOf = (item: Outreach) => formatDateTime(item.sentAt ?? item.scheduledFor, "Not scheduled");

export function OutreachScreen({ settings, outreach, dailyCap, onAction, onExport }: Props) {
  const desktop = useMedia("(min-width: 1024px)");
  const [tab, setTab] = useState<Tab>("draft");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const items = useMemo(() => filterOutreach(outreach, tab), [outreach, tab]);
  const cap = dailyCap || 20;
  const today = new Date().toDateString();
  const sentToday = outreach.filter((item) => parseDate(item.sentAt)?.toDateString() === today).length;
  const selected = items.find((item) => item.id === selectedId) ?? (desktop ? items[0] ?? null : null);
  const showDetail = Boolean(selected) && (desktop || Boolean(selectedId));

  useEffect(() => { setSelectedId(null); }, [tab]);

  const handle = async (item: Outreach, action: OutboxAction) => {
    const succeeded = await onAction(item, action);
    if (succeeded) setNotice(action.action === "approve" ? "Approved. It joins the send queue." : "Saved.");
    return succeeded;
  };

  return (
    <div className="pane outreach">
      <PageHeader title="Outreach" meta={`${sentToday} of ${cap} sent today`} actions={
        <>
          <Popover label="Export outreach" align="end" panelClassName="ui-menu" trigger={(props) => <button type="button" className="ui-icon-button" {...props}><Icon name="download" /></button>}>
            {(close) => (
              <div role="menu">
                <MenuItem onClick={() => { onExport("csv"); close(); }}>Export CSV</MenuItem>
                <MenuItem onClick={() => { onExport("xlsx"); close(); }}>Export XLSX</MenuItem>
              </div>
            )}
          </Popover>
        </>
      } />
      <div className="pane-tools">
        <Segmented tabs label="Outreach status" value={tab} onChange={setTab}
          options={TABS.map((option) => ({ ...option, count: filterOutreach(outreach, option.value).length }))} />
      </div>
      {notice ? <div className="page-notice"><Notice tone="positive" title={notice} onClose={() => setNotice(null)} /></div> : null}

      {items.length === 0 ? (
        <div className="pane-body outreach-empty">
          <EmptyState title={`No ${TABS.find((option) => option.value === tab)?.label.toLowerCase()}`} description={EMPTY_COPY[tab]}
            action={tab === "draft" ? <Button variant="primary" href="#/targets">Open targets</Button> : undefined} />
          <Readiness settings={settings} />
        </div>
      ) : (
        <div className={`split is-boxed ${showDetail && !desktop ? "is-detail" : ""}`}>
          <section className="split-list" aria-label={`${TABS.find((option) => option.value === tab)?.label} list`}>
            <div className="split-scroll">
              {(
                <ul className="row-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <ListRow onClick={() => setSelectedId(item.id)} active={selected?.id === item.id}
                        leading={<Monogram name={item.companyName} size={32} />}
                        title={item.subject || "No subject"}
                        subtitle={<Meta parts={[item.companyName, item.kind === "followup" ? "Follow-up" : "First email", whenOf(item)]} />}
                        trailing={<Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          {showDetail && selected ? (
            <Editor key={selected.id} item={selected} desktop={desktop} onBack={() => setSelectedId(null)} onAction={(action) => handle(selected, action)} />
          ) : desktop ? (
            <section className="split-detail" aria-label="Message">
              <EmptyState title="No message selected" description="Pick a message on the left." />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Editor({ item, desktop, onBack, onAction }: { item: Outreach; desktop: boolean; onBack: () => void; onAction: (action: OutboxAction) => Promise<boolean> }) {
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [cvVariant, setCvVariant] = useState(item.cvVariant);
  const [busy, setBusy] = useState<"approve" | "save" | null>(null);
  const editable = item.status === "draft" || item.status === "followup_due";
  const dirty = subject !== item.subject || body !== item.body || cvVariant !== item.cvVariant;
  const run = async (action: OutboxAction) => {
    setBusy(action.action === "approve" ? "approve" : "save");
    try { await onAction(action); } finally { setBusy(null); }
  };
  return (
    <section className="split-detail" aria-label="Message">
      <div className="detail-scroll">
        <div className="detail-inner is-narrow">
          {desktop ? null : <Button variant="plain" icon="chevronLeft" onClick={onBack} className="back-link">Outreach</Button>}
          <header className="detail-head">
            <Monogram name={item.companyName} size={40} />
            <div className="detail-titles">
              <h2>{item.jobTitle}</h2>
              <p><Meta parts={[item.companyName, item.kind === "followup" ? "Follow-up" : "First email", whenOf(item)]} /></p>
            </div>
            <div className="detail-actions">
              {editable ? <Button variant="primary" icon="check" busy={busy === "approve"} disabled={busy !== null} onClick={() => run({ action: "approve" })}>Approve</Button> : null}
              {editable ? <Button disabled={!dirty || busy !== null} busy={busy === "save"} onClick={() => run({ action: "save", payload: { subject, body, cvVariant } })}>Save</Button> : null}
              {item.status === "sent" || item.status === "replied" ? <Button icon="mail" href={`mailto:${item.contactEmail}`}>Open in Mail</Button> : null}
            </div>
          </header>
          <div className="editor">
            <Field label="To" htmlFor="out-to" layout="row"><TextInput id="out-to" value={item.contactEmail} readOnly /></Field>
            <Field label="Subject" htmlFor="out-subject" layout="row"><TextInput id="out-subject" value={subject} readOnly={!editable} onChange={(event) => setSubject(event.target.value)} /></Field>
            <Field label="CV" htmlFor="out-cv" layout="row">
              <Select id="out-cv" value={cvVariant} disabled={!editable} onChange={(event) => setCvVariant(event.target.value)}>
                {[...new Set([item.cvVariant, "AI Engineer", "AI Fullstack"])].map((variant) => <option key={variant}>{variant}</option>)}
              </Select>
            </Field>
            <label className="sr-only" htmlFor="out-body">Message</label>
            <TextArea id="out-body" className="editor-body" value={body} readOnly={!editable} onChange={(event) => setBody(event.target.value)} />
            {editable ? <p className="section-note">Nothing is sent until you approve it. Approved emails go out within the daily cap.</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** What has to be true before the first email can go out, each with where to fix it. */
function Readiness({ settings }: { settings: Profile }) {
  const [connections, setConnections] = useState<Connections | null>(null);
  useEffect(() => {
    let live = true;
    api.getConnections().then((value) => { if (live) setConnections(value); }).catch(() => { if (live) setConnections(null); });
    return () => { live = false; };
  }, []);
  const cv = settings.cvVariants.find((variant) => variant.fileName);
  const checks: { title: string; ok: boolean | null; detail: string }[] = [
    { title: "Gmail", ok: connections ? connections.GMAIL_CONNECTED : null, detail: connections?.GMAIL_CONNECTED ? "Connected. Emails go out from your account." : "Connect it in Settings to send from your own address." },
    { title: "Sender", ok: Boolean(settings.sender.trim()), detail: settings.sender.trim() || "Set the name and address people see." },
    { title: "CV", ok: Boolean(cv), detail: cv ? `${tidyName(cv.name)} is attached to drafts.` : "Import your CV so drafts attach it." },
    { title: "Daily cap", ok: true, detail: `At most ${settings.dailyCap || 20} emails a day, each approved by you.` },
  ];
  return (
    <Card title="Before your first email" flush className="readiness">
      <ul className="row-list">
        {checks.map((check) => (
          <li key={check.title}>
            <ListRow title={check.title} subtitle={check.detail}
              trailing={check.ok === null ? <Badge>Checking</Badge> : check.ok ? <Badge tone="positive">Ready</Badge> : <Button variant="plain" href="#/settings">Set up</Button>} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
