// The context the conversation brief is generated from — one lead, as text.
//
// Pure, so what the model is told can be tested without a model. The route
// (api/admin/contacts/brief) gathers the rows; this decides what they say.
// CRM labels apply when the workspace has connected LeadSquared; without it
// those attributes simply are not there.
//
// Two things it does on purpose:
//
//   • CRM fields are LABELLED ("CRM stage: Not Reachable") rather than listed as
//     raw attribute keys, and machine fields (signatures, ids, click ids) are
//     dropped. Given "lsq_profile_sig: a1b2", a model treats it as a fact about
//     the person.
//   • It carries what a counsellor needs before a call that the chat alone does
//     not: which number owns the lead and who handed it on, which drips are
//     running, and whether the lead is waiting on us.

export interface LeadContext {
  name: string;
  phone?: string;
  isInstagram: boolean;
  igPhone?: string | null;
  email?: string | null;
  firstSource?: string | null;
  since?: string | null;
  tags: string[];
  attributes: Record<string, string>;
  pipelineStage?: string | null;
  status?: string | null;
  needsReply?: boolean;
  lastInboundAt?: string | null;
  owner?: string | null;
  handovers: { at: string; to: string; reason?: string | null }[];
  drips: { sequence: string; step: number; steps: number; status: string; lastError?: string | null }[];
  thread: { role: "user" | "assistant"; body: string }[];
  campaigns?: { received: number; read: number };
  links: { url: string; clicks: number }[];
}

// Attributes that mean something to the CRM, named the way a counsellor says them.
const CRM_LABELS: Record<string, string> = {
  lsq_stage: "CRM stage",
  lsq_owner: "CRM owner",
  lsq_source: "CRM source",
  lsq_lead_score: "CRM lead score",
};

// Bookkeeping, not facts about the person.
const MACHINE = /^(?:lsq_profile_sig|lsq_lead_id|lsq_owner_email|gclid|fbclid|sclx_id|attribution_at)$/i;

const day = (iso: string) => iso.slice(0, 10);

function hoursSince(iso: string, now: number): string {
  const h = Math.max(0, Math.round((now - Date.parse(iso)) / 3_600_000));
  return h < 48 ? `${h}h` : `${Math.round(h / 24)} days`;
}

export function leadContextLines(c: LeadContext, now = Date.now()): string[] {
  const lines: string[] = [];
  lines.push(`Name: ${c.name || "Unknown"}`);
  if (c.isInstagram) {
    lines.push("Channel: Instagram DM");
    if (c.igPhone) lines.push(`Phone shared in chat: ${c.igPhone}`);
  } else if (c.phone) {
    lines.push(`Phone: ${c.phone}`);
  }
  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.firstSource) lines.push(`First source: ${c.firstSource}`);
  if (c.since) lines.push(`Lead since: ${day(c.since)}`);
  if (c.owner) lines.push(`Owned by: ${c.owner}`);
  for (const h of c.handovers) lines.push(`Handed to ${h.to} on ${day(h.at)}${h.reason ? ` (${h.reason})` : ""}`);
  if (c.pipelineStage) lines.push(`Pipeline stage: ${c.pipelineStage}`);
  if (c.status === "escalated") lines.push("Escalated to a person");
  if (c.needsReply && c.lastInboundAt) lines.push(`Waiting for our reply: ${hoursSince(c.lastInboundAt, now)}`);
  if (c.tags.length) lines.push(`Tags: ${c.tags.join(", ")}`);

  const attrs = Object.entries(c.attributes).filter(([k, v]) => v && !MACHINE.test(k));
  for (const [k, label] of Object.entries(CRM_LABELS)) {
    const v = c.attributes[k];
    if (v) lines.push(`${label}: ${v}`);
  }
  const details = attrs.filter(([k]) => !(k in CRM_LABELS));
  if (details.length) lines.push(`Collected details:\n${details.map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`);

  if (c.drips.length) {
    lines.push(`Drips:\n${c.drips.map(d => `  - ${d.sequence} — step ${d.step} of ${d.steps}, ${d.status}${d.lastError ? ` (last: ${d.lastError})` : ""}`).join("\n")}`);
  }
  if (c.thread.length) {
    lines.push(`Recent conversation (oldest first):\n${c.thread.map(m => `${m.role === "user" ? "Lead" : "Us"}: ${m.body.slice(0, 300)}`).join("\n")}`);
  }
  if (c.campaigns?.received) lines.push(`Campaigns received: ${c.campaigns.received} (read: ${c.campaigns.read})`);
  if (c.links.length) lines.push(`Links tapped:\n${c.links.map(l => `  - ${l.url} (${l.clicks}×)`).join("\n")}`);
  return lines;
}
