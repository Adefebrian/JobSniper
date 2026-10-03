import { useMemo, useState } from "react";
import type { Outreach, OutboxAction } from "../types.ts";
import { filterOutreach, formatDateTime } from "../utils.ts";
import { EmptyState, ErrorState, Notice, PageHeader } from "../components/States.tsx";

interface Props {
  outreach: Outreach[];
  loading: boolean;
  error: string | null;
  onAction: (item: Outreach, action: OutboxAction) => Promise<boolean>;
  onExport: (format: "csv" | "xlsx") => void;
}

const tabs = [
  { id: "draft", label: "Draft" },
  { id: "scheduled", label: "Scheduled" },
  { id: "sent", label: "Sent" },
  { id: "replied", label: "Replied" },
  { id: "followup_due", label: "Follow-up due" },
];

export function OutreachScreen({ outreach, loading, error, onAction, onExport }: Props) {
  const [tab, setTab] = useState("draft");
  const [editing, setEditing] = useState<Outreach | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const items = useMemo(() => filterOutreach(outreach, tab), [outreach, tab]);
  const sentToday = outreach.filter((item) => item.sentAt && new Date(item.sentAt).toDateString() === new Date().toDateString()).length;

  const handleAction = async (item: Outreach, action: OutboxAction) => {
    const succeeded = await onAction(item, action);
    if (succeeded) {
      setNotice(action.action === "approve" ? "Email approved and added to the send queue." : "Outreach record updated.");
      setEditing(null);
    }
  };

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Approval workflow"
        title="Outreach"
        description="Review each message before it leaves the local workspace. Every send remains an explicit approval."
        actions={<>
          <button className="button button-secondary" onClick={() => onExport("csv")}>Export CSV</button>
          <button className="button button-secondary" onClick={() => onExport("xlsx")}>Export XLSX</button>
        </>}
      />
      {error ? <Notice tone="warning">API unavailable. Showing the last locally available outreach snapshot.</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="cap-row">
        <div><span className="status-label">Daily send cap</span><strong>{sentToday} / 20 sent today</strong></div>
        <div className="cap-meter" aria-label={`${sentToday} of 20 sent today`}><span style={{ width: `${Math.min(100, sentToday / 20 * 100)}%` }} /></div>
        <span className="muted">Resets at local midnight</span>
      </div>
      <div className="tab-list" role="tablist" aria-label="Outreach status">
        {tabs.map((item) => {
          const count = filterOutreach(outreach, item.id).length;
          return <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}<span>{count}</span></button>;
        })}
      </div>
      {loading ? <div className="ledger-loading"><span className="loader" aria-hidden="true" /> Loading outreach</div> : null}
      {!loading && items.length === 0 ? <EmptyState title={`No ${tab.replace("_", " ")} messages`} description="Messages appear here after a target has a grounded draft." /> : null}
      {!loading && items.length > 0 ? (
        <div className="outreach-list">
          {items.map((item) => (
            <article className="outreach-record" key={item.id}>
              <div className="outreach-record-main">
                <div className="record-heading"><span className={`status-chip status-${item.status}`}>{item.status.replace("_", " ")}</span><span className="mono">{item.id}</span></div>
                <h2>{item.subject}</h2>
                <p className="muted">{item.companyName} · {item.jobTitle} · {item.contactEmail}</p>
                <p className="message-preview">{item.body.split("\n").filter(Boolean).slice(0, 2).join(" ")}</p>
                <div className="record-meta"><span>{item.kind === "followup" ? "Follow-up" : "Initial"}</span><span>{formatDateTime(item.scheduledFor ?? item.sentAt)}</span><span>{item.cvVariant} CV</span></div>
              </div>
              <div className="outreach-record-actions">
                {item.status === "draft" ? <button className="button button-primary" onClick={() => handleAction(item, { action: "approve" })}>Approve</button> : null}
                {item.status === "draft" ? <button className="button button-secondary" onClick={() => setEditing(item)}>Edit</button> : null}
                {item.status === "followup_due" ? <button className="button button-primary" onClick={() => handleAction(item, { action: "approve" })}>Approve follow-up</button> : null}
                {item.status === "scheduled" ? <button className="button button-secondary" onClick={() => setEditing(item)}>Inspect</button> : null}
                {item.status === "sent" || item.status === "replied" ? <a className="button button-secondary" href={`mailto:${item.contactEmail}`}>Open mail</a> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {editing ? <OutreachEditor item={editing} onClose={() => setEditing(null)} onSave={(payload) => handleAction(editing, { action: "save", payload })} /> : null}
    </div>
  );
}

function OutreachEditor({ item, onClose, onSave }: { item: Outreach; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [cvVariant, setCvVariant] = useState(item.cvVariant);
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Edit outreach message">
      <button className="modal-backdrop" aria-label="Close editor" onClick={onClose} />
      <section className="modal-card">
        <header className="modal-header"><div><p className="mono">{item.id}</p><h2>Edit outreach</h2></div><button className="icon-button" onClick={onClose} aria-label="Close editor">×</button></header>
        <div className="modal-body">
          <label className="field"><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label className="field"><span>Message</span><textarea rows={12} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <label className="field"><span>CV variant</span><select value={cvVariant} onChange={(event) => setCvVariant(event.target.value)}><option>AI Engineer</option><option>AI Fullstack</option></select></label>
        </div>
        <footer className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={() => onSave({ subject, body, cvVariant })}>Save changes</button></footer>
      </section>
    </div>
  );
}
