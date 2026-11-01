"use client";

// Every public reply posted under a comment on one platform — the AI's answers,
// rules' canned replies, follow-ups in a thread — and a way to fix a wrong one.
// YouTube and Facebook change the comment in place; Instagram cannot edit a
// comment, so a correction posts the right reply and removes the old one.

import { useCallback, useEffect, useState } from "react";
import { MessageSquareReply, Pencil, Trash2, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/overlay";
import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { useConfirm } from "@/components/confirm-dialog";

type Platform = "youtube" | "instagram" | "facebook";
interface Reply {
  id: string; platform: Platform; parentCommentId: string; commentText: string | null; commentAuthor: string | null;
  postId: string | null; replyId: string; replyText: string; source: "ai" | "rule" | "ai_followup" | "manual";
  status: "sent" | "edited" | "deleted"; editedAt: string | null; editedBy: string | null; createdAt: string;
}

const NAME: Record<Platform, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook" };
const SOURCE: Record<Reply["source"], string> = { ai: "AI", rule: "Rule", ai_followup: "AI follow-up", manual: "You" };
const LIMIT: Record<Platform, number> = { youtube: 9000, instagram: 1000, facebook: 2000 };

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Where the reply can be seen, when the platform gives us an address for it. */
function viewLink(r: Reply): string | null {
  if (r.platform === "youtube" && r.postId) return `https://www.youtube.com/watch?v=${encodeURIComponent(r.postId)}&lc=${encodeURIComponent(r.replyId)}`;
  if (r.platform === "facebook" && r.postId) return `https://www.facebook.com/${encodeURIComponent(r.postId)}`;
  return null;
}

export function CommentReplies({ platform }: { platform: Platform }) {
  const [rows, setRows] = useState<Reply[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reply | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();
  const [editNote, sayEdit] = useNotice();
  const ask = useConfirm();
  const name = NAME[platform];

  const load = useCallback(async (before?: string) => {
    const q = new URLSearchParams({ platform });
    if (before) q.set("before", before);
    const r = await fetch(`/api/admin/comment-replies?${q}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { say(j.error || `Couldn't load the replies (HTTP ${r.status}).`); if (!before) setRows([]); return; }
    setSetup(j.setupNeeded ?? null);
    const got = (j.replies ?? []) as Reply[];
    setRows(prev => (before ? [...(prev ?? []), ...got] : got));
    setHasMore(got.length >= 30);
  }, [platform, say]);
  useEffect(() => { load(); }, [load]);

  function openEdit(r: Reply) { setEditing(r); setDraft(r.replyText); sayEdit(null); }

  async function save() {
    if (!editing) return;
    setBusy(true); sayEdit(null);
    const r = await fetch(`/api/admin/comment-replies/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { sayEdit(j.error || `Couldn't update the reply (HTTP ${r.status}).`); return; }
    setRows(prev => (prev ?? []).map(x => (x.id === editing.id ? (j.reply as Reply) : x)));
    setEditing(null);
    say(j.warning || `Reply updated on ${name}.`, j.warning ? "warn" : "ok");
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
    if (!res.ok || j.error) { say(j.error || `Couldn't delete the reply (HTTP ${res.status}).`); return; }
    setRows(prev => (prev ?? []).map(x => (x.id === r.id ? { ...x, status: "deleted" } : x)));
    say(`Reply deleted from ${name}.`, "ok");
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
        <button onClick={() => { setRows(null); load(); }} aria-label="Refresh replies" className="p-1.5 rounded-control text-slate-500 hover:bg-canvas hover:text-ink-900"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      <Notice notice={note} onClose={() => say(null)} />
      {setup && <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{setup}</p>}

      {rows === null ? (
        <div role="status" aria-label="Loading" className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-16 rounded-control bg-canvas animate-pulse" />)}</div>
      ) : !rows.length ? (
        !setup && <p className="text-[13px] text-slate-500">No replies yet. Replies posted under {name} comments from now on show up here.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(r => {
            const gone = r.status === "deleted";
            const link = viewLink(r);
            return (
              <li key={r.id} className="rounded-control border border-line p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[12px] text-slate-500 min-w-0 truncate"><b className="text-ink-900">{r.commentAuthor || "Someone"}</b> commented</p>
                  <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">{ago(r.createdAt)}</span>
                </div>
                {r.commentText && <p className="text-[13px] text-ink-700 bg-canvas rounded-control px-3 py-2 whitespace-pre-wrap break-words">{r.commentText}</p>}
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold">{SOURCE[r.source]}</span>
                  <p className={`text-[13px] whitespace-pre-wrap break-words min-w-0 ${gone ? "line-through text-slate-400" : "text-ink-900"}`}>{r.replyText}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {r.status === "edited" && <span className="text-[11px] text-slate-500">Edited{r.editedBy ? ` by ${r.editedBy}` : ""}{r.editedAt ? ` · ${ago(r.editedAt)}` : ""}</span>}
                  {gone && <span className="text-[11px] text-red-600 font-semibold">Deleted{r.editedBy ? ` by ${r.editedBy}` : ""}</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {link && !gone && <a href={link} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-control text-[11px] font-bold text-slate-500 hover:bg-canvas hover:text-ink-900 inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View on {name}</a>}
                    {!gone && <button onClick={() => openEdit(r)} className="px-2 py-1 rounded-control border border-line text-[11px] font-bold text-ink-700 hover:bg-canvas inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>}
                    {!gone && <button onClick={() => remove(r)} aria-label="Delete reply" className="p-1.5 rounded-control text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && rows && rows.length > 0 && (
        <button onClick={async () => { setLoadingMore(true); await load(rows[rows.length - 1].createdAt); setLoadingMore(false); }} disabled={loadingMore}
          className="w-full px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
          {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Show older replies
        </button>
      )}

      <Drawer open={!!editing} onClose={() => !busy && setEditing(null)} title="Edit reply" width="md"
        subtitle={platform === "instagram" ? "Instagram can't edit a comment: saving posts your corrected reply and removes the old one." : `Saving changes the reply on ${name} for everyone.`}
        footer={<>
          <button onClick={() => setEditing(null)} disabled={busy} className="px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Cancel</button>
          <button onClick={save} disabled={busy || !draft.trim() || draft.trim() === editing?.replyText} className="ml-auto px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 inline-flex items-center gap-1.5">
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
      <p className="text-[11px] text-slate-400 text-right tabular-nums">{draft.length.toLocaleString()} / {limit.toLocaleString()}</p>
      {notice}
    </div>
  );
}
