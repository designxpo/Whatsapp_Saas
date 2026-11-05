"use client";

// Blog — every article, when it goes live, and a private preview of the ones
// that aren't public yet. Articles are written in code; this page only decides
// WHEN each becomes public: publish now, move the date, or go back to the date
// written in the article. Changes take effect on the site immediately.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Eye, ExternalLink, RotateCcw, Send } from "lucide-react";
import { Notice, useNotice } from "@/components/Notice";
import { Panel, Badge, EmptyState, MetricTile, Placeholder, ConfirmDialog, type ConfirmCfg } from "../_ui";

type Row = {
  slug: string; title: string; excerpt: string; category: string; readTime: string;
  status: "published" | "scheduled"; publishAt: string | null; originalAt: string | null; changed: boolean;
  cover: string; liveUrl: string; previewUrl: string | null;
};
type View = "scheduled" | "published";

const fmt = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
  : "—";

function inDays(iso: string | null): string {
  if (!iso) return "";
  const d = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm".
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BlogPage() {
  const [posts, setPosts] = useState<Row[] | null>(null);
  const [previewAvailable, setPreviewAvailable] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("scheduled");
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
  const [moving, setMoving] = useState<{ slug: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useNotice();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/owner/blog");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || "Couldn't load the articles."); return; }
      setErr(null); setPosts(j.posts); setPreviewAvailable(j.previewAvailable);
    } catch { setErr("Couldn't reach the server."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Throws on failure so the confirm dialog can show the reason in place.
  const act = useCallback(async (slug: string, action: "publish" | "reschedule" | "reset", at?: string) => {
    const r = await fetch("/api/owner/blog", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, action, at }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || "That didn't work.");
    setPosts(j.posts);
  }, []);

  const scheduled = useMemo(() => (posts ?? []).filter(p => p.status === "scheduled")
    .sort((a, b) => Date.parse(a.publishAt ?? "") - Date.parse(b.publishAt ?? "")), [posts]);
  const published = useMemo(() => (posts ?? []).filter(p => p.status === "published")
    .sort((a, b) => Date.parse(b.publishAt ?? "1970") - Date.parse(a.publishAt ?? "1970")), [posts]);

  if (!posts && !err) return <Placeholder rows={6} />;
  const next = scheduled[0];
  const list = view === "scheduled" ? scheduled : published;

  const publishNow = (p: Row) => setConfirm({
    title: "Publish this article now?",
    confirmLabel: "Publish now",
    message: <>
      <b className="text-ink-900">{p.title}</b> goes live on the blog, the blog index and the sitemap straight away
      instead of on {fmt(p.publishAt)}. You can take it back down with <i>Back to original date</i> while that date is still ahead.
    </>,
    onConfirm: async () => { await act(p.slug, "publish"); setNote("Published — it's live on the blog now.", "ok"); },
  });

  const reset = (p: Row) => setConfirm({
    title: "Go back to the original date?",
    confirmLabel: "Use original date",
    message: p.status === "published" && p.originalAt && Date.parse(p.originalAt) > Date.now()
      ? <><b className="text-ink-900">{p.title}</b> is live now. Going back to {fmt(p.originalAt)} <b>takes it off the site until then</b> — anyone with the link will get a “not found” page.</>
      : <><b className="text-ink-900">{p.title}</b> will go live on {fmt(p.originalAt)}, the date written in the article.</>,
    onConfirm: async () => { await act(p.slug, "reset"); setNote("Back on its original date.", "ok"); },
  });

  async function saveMove() {
    if (!moving) return;
    setBusy(moving.slug);
    try {
      await act(moving.slug, "reschedule", new Date(moving.value).toISOString());
      setMoving(null); setNote("Date changed.", "ok");
    } catch (e) { setNote(e instanceof Error ? e.message : "That didn't work.", "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-extrabold text-brand-dark">Blog</h1>
        <p className="text-sm text-ink-600">
          Every article and when it goes live. Preview one exactly as readers will see it, publish it early, or move its date.
        </p>
      </header>

      {err && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{err}</div>}
      <Notice notice={note} variant="banner" onClose={() => setNote(null)} />
      {posts && !previewAvailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-[12px] text-amber-900">
          Previews are off: the server&apos;s ADMIN_JWT_SECRET is missing or shorter than 32 characters, so it can&apos;t sign a private link.
        </div>
      )}

      {posts && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricTile label="Scheduled" value={scheduled.length} onClick={() => setView("scheduled")} />
            <MetricTile label="Live" value={published.length} onClick={() => setView("published")} />
            <MetricTile label="Next to go live" value={next ? inDays(next.publishAt) : "—"} sub={next ? next.title : "Nothing scheduled"} />
          </div>

          <div role="tablist" aria-label="Which articles" className="inline-flex rounded-control border border-line bg-white p-0.5">
            {([["scheduled", `Scheduled (${scheduled.length})`], ["published", `Live (${published.length})`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`px-3 py-1.5 rounded-control text-xs font-bold ${view === k ? "bg-brand-700 text-white" : "text-ink-600 hover:bg-canvas"}`}>
                {label}
              </button>
            ))}
          </div>

          <Panel dense>
            {!list.length ? (
              <EmptyState mood="sleeping" title={view === "scheduled" ? "Nothing scheduled" : "Nothing live yet"}
                body={view === "scheduled" ? "Every article is already live. New articles appear here once they're added with a future date." : "Scheduled articles appear here once they go live."} />
            ) : (
              <ul className="divide-y divide-line">
                {list.map(p => (
                  <li key={p.slug} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the cover lives on the marketing host */}
                    <img src={p.cover} alt="" loading="lazy" className="aspect-[1200/630] w-full shrink-0 rounded-control border border-line bg-canvas object-cover sm:w-36" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={p.status === "published" ? "ok" : "info"}>{p.status === "published" ? "Live" : "Scheduled"}</Badge>
                        <span className="text-[11px] text-ink-400">{p.category} · {p.readTime}</span>
                        {p.changed && <Badge tone="warn" title={p.originalAt ? `Originally ${fmt(p.originalAt)}` : undefined}>Date changed</Badge>}
                      </div>
                      <p className="text-[14px] font-bold leading-snug text-ink-900">{p.title}</p>
                      <p className="text-[12px] leading-relaxed text-ink-600 line-clamp-2">{p.excerpt}</p>
                      <p className="text-[12px] text-ink-600 tnum">
                        <CalendarClock className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-ink-400" aria-hidden />
                        {p.status === "published" ? (p.publishAt ? `Live since ${fmt(p.publishAt)}` : "Live") : `Goes live ${fmt(p.publishAt)} IST · ${inDays(p.publishAt)}`}
                        {p.changed && p.originalAt && <span className="text-ink-400"> (was {fmt(p.originalAt)})</span>}
                      </p>

                      {moving?.slug === p.slug && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-control bg-canvas p-2">
                          <label className="text-[12px] font-semibold text-ink-700" htmlFor={`at-${p.slug}`}>New date (your time)</label>
                          <input id={`at-${p.slug}`} type="datetime-local" value={moving.value} min={toLocalInput(new Date().toISOString())}
                            onChange={e => setMoving({ slug: p.slug, value: e.target.value })}
                            className="rounded-control border border-line bg-white px-2 py-1 text-[12px] text-ink-900" />
                          <button onClick={() => void saveMove()} disabled={busy === p.slug || !moving.value}
                            className="rounded-control bg-brand-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-brand-600 disabled:opacity-50">
                            {busy === p.slug ? "Saving…" : "Save date"}
                          </button>
                          <button onClick={() => setMoving(null)} className="px-2 py-1 text-[11px] font-semibold text-ink-600 hover:text-ink-900">Cancel</button>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                      {p.status === "scheduled" ? (
                        <>
                          {p.previewUrl && (
                            <a href={p.previewUrl} target="_blank" rel="noreferrer"
                              className="inline-flex items-center justify-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[11px] font-bold text-ink-900 hover:bg-canvas">
                              <Eye className="h-3.5 w-3.5" /> Preview
                            </a>
                          )}
                          <button onClick={() => publishNow(p)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-control bg-brand-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-brand-600">
                            <Send className="h-3.5 w-3.5" /> Publish now
                          </button>
                          <button onClick={() => setMoving({ slug: p.slug, value: toLocalInput(p.publishAt) })}
                            className="inline-flex items-center justify-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[11px] font-bold text-ink-700 hover:bg-canvas">
                            <CalendarClock className="h-3.5 w-3.5" /> Change date
                          </button>
                        </>
                      ) : (
                        <a href={p.liveUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[11px] font-bold text-ink-900 hover:bg-canvas">
                          <ExternalLink className="h-3.5 w-3.5" /> View live
                        </a>
                      )}
                      {p.changed && (
                        <button onClick={() => reset(p)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-control px-2.5 py-1.5 text-[11px] font-semibold text-ink-600 hover:bg-canvas">
                          <RotateCcw className="h-3.5 w-3.5" /> Back to original date
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="text-[11px] text-ink-400">
            Preview links work for 7 days and are hidden from search engines. Anyone you send one to can read that one article before it&apos;s public.
          </p>
        </>
      )}

      {confirm && <ConfirmDialog cfg={confirm} onDone={() => setConfirm(null)} />}
    </div>
  );
}
