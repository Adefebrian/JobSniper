import { useMemo, useState } from "react";
import type { Outreach, OutboxAction } from "../types.ts";
import { filterOutreach, formatDateTime, humanize } from "../utils.ts";
import { EmptyState, Notice, PageHeader } from "../components/States.tsx";

interface Props {
  outreach: Outreach[];
  dailyCap: number;
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

export function OutreachScreen({ outreach, dailyCap, onAction, onExport }: Props) {
  const [tab, setTab] = useState("draft");
  const [editing, setEditing] = useState<Outreach | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const items = useMemo(() => filterOutreach(outreach, tab), [outreach, tab]);
  const cap = dailyCap || 20;
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
        title="Outreach"
        description="Every message waits for your approval before it is sent."
        actions={<>
          <button className="button button-secondary" onClick={() => onExport("csv")}>Export CSV</button>
          <button className="button button-secondary" onClick={() => onExport("xlsx")}>Export XLSX</button>
        </>}
      />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Outreach status">
          {tabs.map((item) => (
            <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : undefined} onClick={() => setTab(item.id)}>
              {item.label} <span className="tabular">{filterOutreach(outreach, item.id).length}</span>
            </button>
          ))}
        </div>
        <p className="muted tabular">{sentToday} of {cap} sent today. Resets at local midnight.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState title={`No ${tabs.find((item) => item.id === tab)?.label.toLowerCase()} messages`} description="Messages appear here after you draft an email from a target." />
      ) : (
        <ul className="rows">
          {items.map((item) => (
            <li className="row outreach-row" key={item.id}>
              <div className="row-main">
                <div className="record-line">
                  <strong>{item.subject}</strong>
                  <span className="tag tag-plain">{humanize(item.status)}</span>
                </div>
                <p className="muted">{item.companyName} · {item.jobTitle} · {item.contactEmail}</p>
                <p className="clamp">{item.body.split("\n").filter(Boolean).slice(0, 2).join(" ")}</p>
                <p className="muted small">{item.kind === "followup" ? "Follow-up" : "Initial"} · {formatDateTime(item.scheduledFor ?? item.sentAt)} · {item.cvVariant} CV</p>
              </div>
              <div className="row-actions">
                {item.status === "draft" || item.status === "followup_due" ? <button className="button button-primary" onClick={() => handleAction(item, { action: "approve" })}>Approve</button> : null}
                {item.status === "draft" ? <button className="button button-secondary" onClick={() => setEditing(item)}>Edit</button> : null}
                {item.status === "scheduled" ? <button className="button button-secondary" onClick={() => setEditing(item)}>Inspect</button> : null}
                {item.status === "sent" || item.status === "replied" ? <a className="button button-secondary" href={`mailto:${item.contactEmail}`}>Open mail</a> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
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
      <button className="modal-scrim" aria-label="Close editor" onClick={onClose} />
      <section className="modal">
        <header className="modal-head">
          <h2>Edit message</h2>
          <button className="button button-quiet" onClick={onClose}>Close</button>
        </header>
        <div className="modal-body">
          <label className="field"><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label className="field"><span>Message</span><textarea rows={12} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <label className="field"><span>CV variant</span><select value={cvVariant} onChange={(event) => setCvVariant(event.target.value)}><option>AI Engineer</option><option>AI Fullstack</option></select></label>
        </div>
        <footer className="modal-actions">
          <button className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={() => onSave({ subject, body, cvVariant })}>Save changes</button>
        </footer>
      </section>
    </div>
  );
}
