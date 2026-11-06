"use client";

// Every public reply posted under a comment on one platform — the AI's answers,
// rules' canned replies, follow-ups in a thread — and a way to fix a wrong one.
// YouTube and Facebook change the comment in place; Instagram cannot edit a
// comment, so a correction posts the right reply and removes the old one.
//
// Read a page (25) at a time within a chosen range — 7, 30, 90 days or a year —
// so a long history never loads at once. Replies from before the log existed
// are imported in the background (comment-history.ts); the line under the
// header says while that is still going.

import { useCallback, useEffect, useState } from "react";
import { MessageSquareReply, Pencil, Trash2, Loader2, ExternalLink, RefreshCw, Copy, Check, MessageCircle, Phone } from "lucide-react";
import { Drawer } from "@/components/overlay";
import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { useConfirm } from "@/components/confirm-dialog";
import { SegmentedControl } from "@/components/SegmentedControl";
import { toast } from "@/components/toast";

type Platform = "youtube" | "instagram" | "facebook";
interface Reply {
  id: string; platform: Platform; parentCommentId: string; commentText: string | null; commentAuthor: string | null;
  postId: string | null; replyId: string; replyText: string; source: "ai" | "rule" | "ai_followup" | "manual";
  status: "sent" | "edited" | "deleted"; editedAt: string | null; editedBy: string | null; createdAt: string;
  commentAuthorId: string | null;
  person?: { chatPhone: string; name: string | null; avatarUrl: string | null; leadPhone: string | null };
}

const NAME: Record<Platform, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook" };
const SOURCE: Record<Reply["source"], string> = { ai: "AI", rule: "Rule", ai_followup: "AI follow-up", manual: "Team" };
const SOURCE_HINT: Partial<Record<Reply["source"], string>> = { manual: "Posted by a person, in the platform's own app, not by the AI or a rule" };
type Range = "7" | "30" | "90" | "365";
const RANGES: { value: Range; label: string }[] = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "1 year" }];
const PAGE = 25;
const LIMIT: Record<Platform, number> = { youtube: 9000, instagram: 1000, facebook: 2000 };

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

/** Where the reply can be seen, when the platform gives us an address for it. */
function viewLink(r: Reply): string | null {
  if (r.platform === "youtube" && r.postId) return `https://www.youtube.com/watch?v=${encodeURIComponent(r.postId)}&lc=${encodeURIComponent(r.replyId)}`;
  if (r.platform === "facebook" && r.postId) return `https://www.facebook.com/${encodeURIComponent(r.postId)}`;
  return null;
}

/** The commenter's public profile, when the platform has an address for it. */
function profileLink(r: Reply, who: string): string | null {
  if (r.platform === "instagram" && /^@[\w.]+$/.test(who)) return `https://www.instagram.com/${who.slice(1)}/`;
  if (r.platform === "youtube" && r.commentAuthorId) return `https://www.youtube.com/channel/${encodeURIComponent(r.commentAuthorId)}`;
  return null;
}

/**
 * Who wrote the comment: picture, @handle (linked to their profile), their
 * platform id, a phone they shared in the chat, and a way into that chat.
 * Older replies get their commenter filled in by the background engine.
 */
function Commenter({ r, onOpenChat }: { r: Reply; onOpenChat?: (chatPhone: string) => void }) {
  const [copied, setCopied] = useState(false);
  const who = r.commentAuthor || r.person?.name || "";
  const link = who ? profileLink(r, who) : null;
  const copy = () => {
    if (!r.commentAuthorId) return;
    navigator.clipboard?.writeText(r.commentAuthorId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  };
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      {r.person?.avatarUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={r.person.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
        : <span aria-hidden className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 text-[12px] font-bold flex items-center justify-center shrink-0">{(who.replace(/^@/, "")[0] ?? "?").toUpperCase()}</span>}
      <div className="min-w-0">
        <p className="text-[12px] text-slate-500 truncate">
          {who
            ? link
              ? <a href={link} target="_blank" rel="noreferrer" className="font-bold text-ink-900 hover:underline">{who}</a>
              : <b className="text-ink-900">{who}</b>
            : <b className="text-ink-900">Someone</b>} commented
        </p>
        {(r.commentAuthorId || r.person?.leadPhone || (r.person && onOpenChat)) && (
          <div className="mt-0.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-500">
            {r.commentAuthorId && (
              <button type="button" onClick={copy} title="Copy ID" className="inline-flex items-center gap-1 tabular-nums hover:text-ink-900">
                ID {r.commentAuthorId} {copied ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
              </button>
            )}
            {r.person?.leadPhone && <a href={`tel:${r.person.leadPhone}`} className="inline-flex items-center gap-1 hover:text-ink-900"><Phone className="w-3 h-3" /> {r.person.leadPhone}</a>}
            {r.person && onOpenChat && (
              <button type="button" onClick={() => onOpenChat(r.person!.chatPhone)} className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline">
                <MessageCircle className="w-3 h-3" /> Open chat
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommentReplies({ platform, onOpenChat }: { platform: Platform; onOpenChat?: (chatPhone: string) => void }) {
  const [rows, setRows] = useState<Reply[] | null>(null);
  const [range, setRange] = useState<Range>("30");
  // cursors[i] starts page i (page 0: none); next starts the page after this one.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [paging, setPaging] = useState(false);
  const [history, setHistory] = useState<{ importing: boolean; imported: number; error: string | null } | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reply | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();
  const [editNote, sayEdit] = useNotice();
  const ask = useConfirm();
  const name = NAME[platform];

  const load = useCallback(async (days: Range, cursor: string | null) => {
    const q = new URLSearchParams({ platform, days });
    if (cursor) q.set("cursor", cursor);
    const r = await fetch(`/api/admin/comment-replies?${q}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { say(j.error || "Couldn't load the replies. Check your connection and try again."); setRows(prev => prev ?? []); return false; }
    setSetup(j.setupNeeded ?? null);
    setRows((j.replies ?? []) as Reply[]);
    setNext(j.next ?? null);
    if (!cursor) { setTotal(typeof j.total === "number" ? j.total : null); setHistory(j.history ?? null); }
    return true;
  }, [platform, say]);
  // A new range starts again at its first page.
  useEffect(() => { setRows(null); setCursors([null]); load(range, null); }, [load, range]);

  const page = cursors.length - 1;
  async function goTo(dir: 1 | -1) {
    setPaging(true);
    if (dir === 1 && next) { if (await load(range, next)) setCursors(c => [...c, next]); }
    if (dir === -1 && page > 0) { const prev = cursors[page - 1]; if (await load(range, prev)) setCursors(c => c.slice(0, -1)); }
    setPaging(false);
  }

  function openEdit(r: Reply) { setEditing(r); setDraft(r.replyText); sayEdit(null); }

  async function save() {
    if (!editing) return;
    setBusy(true); sayEdit(null);
    const r = await fetch(`/api/admin/comment-replies/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { sayEdit(j.error || "Couldn't update the reply. Please try again."); return; }
    setRows(prev => (prev ?? []).map(x => (x.id === editing.id ? (j.reply as Reply) : x)));
    setEditing(null);
    if (j.warning) say(j.warning, "warn"); else toast(`Reply updated on ${name}`);
  }

  async function remove(r: Reply) {
    const ok = await ask({
      title: "Delete this reply?", tone: "danger", confirmLabel: "Delete reply",
      message: `It comes down from ${name} for everyone. This can't be undone.`,
      facts: [{ label: "Reply", value: r.replyText.length > 90 ? `${r.replyText.slice(0, 90)}…` : r.replyText }],
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/comment-replies/${r.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) { say(j.error || "Couldn't delete the reply. Please try again."); return; }
    setRows(prev => (prev ?? []).map(x => (x.id === r.id ? { ...x, status: "deleted" } : x)));
    toast(`Reply deleted from ${name}`);
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="group flex items-center gap-1.5">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageSquareReply className="w-3.5 h-3.5" /> Replies sent</p>
          <PageInfo>
            Every public reply posted under a comment on {name}: the AI&apos;s answers, your rules&apos; replies and follow-ups in a thread. If one is wrong, <b>Edit</b> fixes it on {name}
            {platform === "instagram" ? " — Instagram can't edit a comment, so the corrected reply is posted and the old one removed." : "."} Private messages (DMs) are in Live Chat.
          </PageInfo>
        </div>
        <button onClick={() => { setRows(null); load(range, cursors[page]); }} aria-label="Refresh replies" className="grid place-items-center w-9 h-9 rounded-control text-slate-500 hover:bg-canvas hover:text-ink-900"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      {!setup && <SegmentedControl options={RANGES} value={range} onChange={setRange} size="sm" ariaLabel="Show replies from" className="max-w-sm" />}
      {history?.importing && (
        <p className="text-[12px] text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          Bringing in your earlier {name} replies, up to a year back{history.imported ? ` — ${history.imported.toLocaleString()} so far` : ""}. This runs in the background, a little at a time.</p>
      )}
      {history?.error && !history.importing && <p className="text-[12px] text-amber-700">Some earlier replies couldn&apos;t be read from {name}: {history.error}</p>}

      <Notice notice={note} onClose={() => say(null)} />
      {setup && <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{setup}</p>}

      {rows === null ? (
        <div role="status" aria-label="Loading" className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-16 rounded-control bg-canvas animate-pulse" />)}</div>
      ) : !rows.length ? (
        !setup && <p className="text-[13px] text-slate-500">{history?.importing
          ? "Nothing in this range yet — earlier replies are still coming in."
          : `No replies under ${name} comments in the last ${RANGES.find(r => r.value === range)?.label}. When the AI or one of your comment rules answers a comment, the reply shows here so you can check it${range !== "365" ? " — or pick a longer range above" : ""}.`}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(r => {
            const gone = r.status === "deleted";
            const link = viewLink(r);
            return (
              <li key={r.id} className="rounded-control border border-line p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <Commenter r={r} onOpenChat={onOpenChat} />
                  <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">{ago(r.createdAt)}</span>
                </div>
                {r.commentText && <p className="text-[13px] text-ink-700 bg-canvas rounded-control px-3 py-2 whitespace-pre-wrap break-words">{r.commentText}</p>}
                <div className="flex items-start gap-2">
                  <span title={SOURCE_HINT[r.source]} className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">{SOURCE[r.source]}</span>
                  <p className={`text-[13px] whitespace-pre-wrap break-words min-w-0 ${gone ? "line-through text-slate-400" : "text-ink-900"}`}>{r.replyText}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {r.status === "edited" && <span className="text-[11px] text-slate-500">Edited{r.editedBy ? ` by ${r.editedBy}` : ""}{r.editedAt ? ` · ${ago(r.editedAt)}` : ""}</span>}
                  {gone && <span className="text-[11px] text-red-600 font-semibold">Deleted{r.editedBy ? ` by ${r.editedBy}` : ""}</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {link && !gone && <a href={link} target="_blank" rel="noreferrer" className="min-h-8 px-2 py-1 rounded-control text-[12px] font-bold text-slate-600 hover:bg-canvas hover:text-ink-900 inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View on {name}</a>}
                    {!gone && <button onClick={() => openEdit(r)} className="min-h-8 px-2 py-1 rounded-control border border-line text-[12px] font-bold text-ink-700 hover:bg-canvas inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>}
                    {!gone && <button onClick={() => remove(r)} aria-label="Delete reply" className="grid place-items-center w-8 h-8 rounded-control text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows && rows.length > 0 && (page > 0 || next) && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[12px] text-slate-500 tabular-nums">
            {page * PAGE + 1}–{page * PAGE + rows.length}{total !== null ? ` of ${total.toLocaleString()}` : ""}
          </span>
          <div className="flex items-center gap-1.5">
            {paging && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
            <button onClick={() => goTo(-1)} disabled={paging || page === 0} className="min-h-8 px-2.5 py-1 rounded-control border border-line text-[12px] font-bold text-ink-700 hover:bg-canvas disabled:opacity-40">Newer</button>
            <button onClick={() => goTo(1)} disabled={paging || !next} className="min-h-8 px-2.5 py-1 rounded-control border border-line text-[12px] font-bold text-ink-700 hover:bg-canvas disabled:opacity-40">Older</button>
          </div>
        </nav>
      )}

      <Drawer open={!!editing} onClose={() => !busy && setEditing(null)} title="Edit reply" width="md"
        subtitle={platform === "instagram" ? "Instagram can't edit a comment: saving posts your corrected reply and removes the old one." : `Saving changes the reply on ${name} for everyone.`}
        footer={<>
          <button onClick={() => setEditing(null)} disabled={busy} className="min-h-9 px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Cancel</button>
          {!busy && (!draft.trim() || draft.trim() === editing?.replyText) && <span className="ml-auto text-[12px] text-slate-500">{!draft.trim() ? "Type the reply first." : "Change the reply to save it."}</span>}
          <button onClick={save} disabled={busy || !draft.trim() || draft.trim() === editing?.replyText} title={!draft.trim() ? "Type the reply first" : draft.trim() === editing?.replyText ? "Nothing has changed yet" : undefined} className="ml-auto px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 inline-flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {platform === "instagram" ? "Post corrected reply" : "Update reply"}
          </button>
        </>}>
        {editing && <ReplyEditor reply={editing} draft={draft} onDraft={setDraft} limit={LIMIT[platform]} notice={<Notice notice={editNote} />} />}
      </Drawer>
    </section>
  );
}

// The form inside the side panel: their comment for context, then the reply.
function ReplyEditor({ reply, draft, onDraft, limit, notice }: { reply: Reply; draft: string; onDraft: (v: string) => void; limit: number; notice: React.ReactNode }) {
  return (
    <div className="space-y-3">
      {reply.commentText && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">{reply.commentAuthor || "Their comment"}</p>
          <p className="text-[13px] text-ink-700 bg-canvas rounded-control px-3 py-2 whitespace-pre-wrap break-words">{reply.commentText}</p>
        </div>
      )}
      <label className="block">
        <span className="text-[11px] font-bold text-slate-400 uppercase">Your reply</span>
        <textarea value={draft} onChange={e => onDraft(e.target.value)} rows={7} maxLength={limit}
          className="mt-1 w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 leading-relaxed" />
      </label>
      <p className="text-[11px] text-slate-500 text-right tabular-nums">{draft.length.toLocaleString()} / {limit.toLocaleString()}</p>
      {notice}
    </div>
  );
}
