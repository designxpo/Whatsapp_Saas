"use client";

// Compose a platform → tenant email campaign. Two modes on purpose:
//
//   Simple  — structured fields rendered through renderEmail(), the same
//             template every other platform email uses. Safe in Outlook and
//             Gmail without hand-testing, which a freeform WYSIWYG is not.
//   HTML    — paste a designed campaign and it goes out verbatim, with a live
//             preview so nobody discovers a broken layout after sending.
//
// Both paths get {{company}} / {{name}} substitution, an image upload that
// reuses the existing moderated /api/upload endpoint, and a test send to the
// owner's own inbox before anything reaches a tenant.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Image as ImageIcon, Loader2, Send, Eye, TestTube2, Users } from "lucide-react";
import { Panel, ConfirmDialog, type ConfirmCfg } from "../../_ui";

type Mode = "simple" | "html";
type Audience = "all" | "active" | "trialing" | "suspended";

const AUDIENCE_LABEL: Record<Audience, string> = {
  all: "All tenants",
  active: "Paying tenants",
  trialing: "Tenants on trial",
  suspended: "Suspended / past-due",
};
const AUDIENCES = Object.keys(AUDIENCE_LABEL) as Audience[];

const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400";
const label = "text-[11px] font-bold text-ink-500 uppercase tracking-[0.05em]";

export default function ComposeCampaignPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("simple");
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<"" | "test" | "send">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmCfg, setConfirmCfg] = useState<ConfirmCfg | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/owner/broadcast?counts=1").then(r => r.json())
      .then(d => setCounts(d.counts ?? null)).catch(() => setCounts(null));
  }, []);

  // Blank-line separated → one paragraph each, matching how every other
  // platform email is authored (renderEmail takes a paragraphs array).
  const paragraphs = bodyText.split(/\n\s*\n/).map(p => p.trim().replace(/\n/g, " ")).filter(Boolean);
  const recipientCount = counts?.[audience] ?? null;

  const payload = useCallback(() => ({
    subject, mode, heading, paragraphs, imageUrl: imageUrl || null,
    ctaLabel: ctaLabel || null, ctaUrl: ctaUrl || null, htmlBody, audienceMode: audience,
  }), [subject, mode, heading, paragraphs, imageUrl, ctaLabel, ctaUrl, htmlBody, audience]);

  async function upload(file: File) {
    setUploading(true); setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok || !d.url) { setMsg({ tone: "bad", text: d.error || "Upload failed." }); return; }
      if (mode === "simple") setImageUrl(d.url);
      // In HTML mode the admin owns the markup, so hand them a tag to place
      // rather than guessing where in their layout it belongs.
      else setHtmlBody(h => `${h}\n<img src="${d.url}" alt="" style="display:block;width:100%;max-width:528px;height:auto;border-radius:10px;" />\n`);
      setMsg({ tone: "ok", text: "Image uploaded." });
    } catch { setMsg({ tone: "bad", text: "Upload failed." }); }
    finally { setUploading(false); }
  }

  async function post(testOnly: boolean) {
    setBusy(testOnly ? "test" : "send"); setMsg(null);
    try {
      const r = await fetch("/api/owner/broadcast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), testOnly }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ tone: "bad", text: d.error || "That didn't work." }); return; }
      if (testOnly) { setMsg({ tone: "ok", text: `Test sent to ${d.to} — check it before sending for real.` }); return; }
      router.push("/admin/owner/emails");
    } catch { setMsg({ tone: "bad", text: "Couldn't reach the server." }); }
    finally { setBusy(""); }
  }

  const ready = subject.trim() && (mode === "simple" ? heading.trim() && paragraphs.length : htmlBody.trim());

  return (
    <div className="space-y-4 pb-10">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link href="/admin/owner/emails" className="text-xs text-ink-500 inline-flex items-center gap-1.5 hover:text-ink-900"><ArrowLeft className="w-3.5 h-3.5" /> Back to emails</Link>
          <h1 className="text-xl font-extrabold text-brand-dark mt-2">New campaign</h1>
          <p className="text-sm text-ink-600">One email to every tenant that matches your audience. Sends gradually in the background — Resend is rate-limited, so a large list finishes over a few minutes.</p>
        </div>
      </header>

      {msg && (
        <div className={`rounded-card px-4 py-3 text-sm border ${msg.tone === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.text}</div>
      )}

      <Panel title="Audience">
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map(a => (
            <button key={a} onClick={() => setAudience(a)}
              className={`px-3 py-1.5 rounded-control text-xs font-bold border ${audience === a ? "bg-ink-950 text-white border-ink-950" : "border-line text-ink-600 hover:bg-canvas"}`}>
              {AUDIENCE_LABEL[a]}{counts ? ` · ${counts[a] ?? 0}` : ""}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-500 mt-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          {recipientCount === null ? "Counting recipients…"
            : recipientCount === 0 ? "No tenants match this audience — nothing would send."
            : `${recipientCount} tenant${recipientCount === 1 ? "" : "s"} will receive this. The list is frozen when you send, so a signup mid-send won't be added.`}
        </p>
      </Panel>

      <Panel title="Content" action={
        <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
          {(["simple", "html"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-[6px] text-[11px] font-bold capitalize ${mode === m ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
              {m === "simple" ? "Simple" : "Custom HTML"}
            </button>
          ))}
        </div>
      }>
        <div className="space-y-3">
          <div>
            <p className={label}>Subject</p>
            <input className={`${inp} mt-1`} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What's new in Talko AI this month" />
          </div>

          {mode === "simple" ? (
            <>
              <div>
                <p className={label}>Heading</p>
                <input className={`${inp} mt-1`} value={heading} onChange={e => setHeading(e.target.value)} placeholder="Three things we shipped in August" />
              </div>
              <div>
                <p className={label}>Body</p>
                <textarea className={`${inp} mt-1 font-sans`} rows={8} value={bodyText} onChange={e => setBodyText(e.target.value)}
                  placeholder={"One paragraph per blank line.\n\nUse {{company}} and {{name}} to personalise — they become the tenant's business name and owner's first name."} />
                <p className="text-[11px] text-ink-400 mt-1">{paragraphs.length} paragraph{paragraphs.length === 1 ? "" : "s"} · {"{{company}}"} and {"{{name}}"} are substituted per recipient</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <p className={label}>Button label <span className="text-ink-400 font-normal normal-case">(optional)</span></p>
                  <input className={`${inp} mt-1`} value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="See what's new" />
                </div>
                <div>
                  <p className={label}>Button URL</p>
                  <input className={`${inp} mt-1`} value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://www.thetalko.in/changelog" />
                </div>
              </div>
            </>
          ) : (
            <div>
              <p className={label}>HTML</p>
              <textarea className={`${inp} mt-1 font-mono text-xs`} rows={16} value={htmlBody} onChange={e => setHtmlBody(e.target.value)}
                placeholder={'<div style="font-family:sans-serif">\n  <h1>Hello {{name}}</h1>\n  <p>…</p>\n</div>'} />
              <p className="text-[11px] text-ink-400 mt-1">Sent verbatim. Use inline styles — email clients drop most of what a &lt;style&gt; block would do. Preview before sending.</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas inline-flex items-center gap-1.5 disabled:opacity-60">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {mode === "simple" ? "Upload image" : "Upload & insert image"}
            </button>
            {mode === "simple" && imageUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className="h-9 w-14 object-cover rounded-control border border-line" />
                <button onClick={() => setImageUrl("")} className="text-[11px] font-bold text-ink-400 hover:text-red-600">Remove</button>
              </>
            )}
            <button onClick={() => setShowPreview(p => !p)} disabled={!ready}
              className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas inline-flex items-center gap-1.5 disabled:opacity-40">
              <Eye className="w-3.5 h-3.5" /> {showPreview ? "Hide" : "Preview"}
            </button>
          </div>
        </div>
      </Panel>

      {showPreview && mode === "html" && (
        <Panel title="Preview">
          {/* Sandboxed: a pasted campaign is markup we did not write, and it must
              not be able to run script against the owner console's own origin. */}
          <iframe title="Email preview" sandbox="" srcDoc={htmlBody} className="w-full h-[420px] rounded-control border border-line bg-white" />
        </Panel>
      )}
      {showPreview && mode === "simple" && (
        <Panel title="Preview">
          <div className="rounded-control border border-line p-5 bg-white max-w-[560px]">
            <h2 className="text-lg font-extrabold text-ink-900">{heading || "(heading)"}</h2>
            {paragraphs.map((p, i) => <p key={i} className="text-sm text-ink-600 leading-relaxed mt-3">{p.replace(/\{\{\s*company\s*\}\}/gi, "Example Business").replace(/\{\{\s*name\s*\}\}/gi, "Priya")}</p>)}
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="w-full rounded-control mt-4" />
            )}
            {ctaLabel && ctaUrl && <span className="inline-block mt-4 px-4 py-2 rounded-full bg-brand-700 text-white text-xs font-bold">{ctaLabel}</span>}
          </div>
          <p className="text-[11px] text-ink-400 mt-2">An approximation of the layout — the real email is rendered by the shared template. Send a test to see it exactly as a tenant will.</p>
        </Panel>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={() => post(true)} disabled={!ready || !!busy}
          className="px-3.5 py-2 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas inline-flex items-center gap-1.5 disabled:opacity-40">
          {busy === "test" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube2 className="w-3.5 h-3.5" />} Send test to me
        </button>
        <button
          disabled={!ready || !!busy || recipientCount === 0}
          onClick={() => setConfirmCfg({
            title: "Send to every matching tenant",
            message: <>This emails <b>{recipientCount ?? "?"} tenant{recipientCount === 1 ? "" : "s"}</b> ({AUDIENCE_LABEL[audience]}) with the subject &ldquo;<b>{subject}</b>&rdquo;. Emails already sent can&apos;t be recalled. Type SEND to confirm.</>,
            confirmLabel: "Send campaign",
            requireTyping: "SEND",
            onConfirm: () => post(false),
          })}
          className="px-4 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40">
          {busy === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send campaign
        </button>
      </div>

      {confirmCfg && <ConfirmDialog cfg={confirmCfg} onDone={() => setConfirmCfg(null)} />}
    </div>
  );
}
