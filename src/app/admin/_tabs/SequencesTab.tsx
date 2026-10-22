"use client";
import { previewParts, type TemplateComponent } from "@/lib/templatepreview";
import { useState, useEffect, useCallback, useRef, Fragment, type Dispatch, type SetStateAction } from "react";
import { Loader2, Send, Users, History, Zap, Ban, LogOut, UploadCloud, Check, Trash2, Plus, Bot, MessageSquare, Facebook, Database, Sparkles, ShieldCheck, ArrowRight, Globe, FileText, BarChart3, LayoutTemplate, FlaskConical, Home, CircleCheck, Settings, Tag, UserCheck, RefreshCw, Image as ImageIcon, Video, Phone, Smartphone, Link2, Copy, X, GalleryHorizontalEnd, Star, Filter, Download, ChevronLeft, ChevronRight, ArrowLeft, MousePointerClick, Reply, AlertTriangle, ClipboardList, ExternalLink, Search, Megaphone, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, MapPin, Instagram, Workflow, ShoppingBag, TrendingUp, Mic, Paperclip, KanbanSquare, GripVertical, SmilePlus, KeyRound, Building2} from "lucide-react";
import { templatePlaceholders, paramCount, isNamedFormat } from "@/lib/template-params";
import { getJson, postJson, apiErrorText, newGeneration } from "@/lib/apicall";
import { SEQ_TRIGGERS, SEQ_TRIGGERS_DEAD, triggerSpec, triggerLabel } from "@/lib/seqtriggers";
import { KNOWN_SCORES } from "@/lib/drip-types";
import { audienceFingerprint, describeAudience as describeSeqAudience } from "@/lib/seqaudience";
import { LANES, AIDA_STAGES, AIDA_LABELS, type Lane, type AidaStage } from "@/lib/drip-types";
import { ConfirmProvider, useConfirm } from "@/components/confirm-dialog";
import { inp, ChannelSelect, useChannelList, ImageUpload } from "../_shared";
import { useVocab } from "@/lib/vocab-client";

// The workspace's own nouns, lower-cased for mid-sentence use (1 = singular, N = plural).
function useWords() {
  const { vocab } = useVocab();
  const lc = (x: string) => x.toLowerCase();
  return { vocab, lead1: lc(vocab.lead.one), leadN: lc(vocab.lead.many), seq1: lc(vocab.sequence.one), seqN: lc(vocab.sequence.many), ct1: lc(vocab.contact.one), ctN: lc(vocab.contact.many) };
}
function closeIfDeleted<T extends { id?: string }>(
  set: Dispatch<SetStateAction<T | null>>,
  deletedId: string,
) {
  set(f => (f && f.id === deletedId ? null : f));
}
type SeqAudience = { attrIn?: Record<string, string[]>; attrNotIn?: Record<string, string[]>; hasTag?: string[]; lacksTag?: string[] } | null;
// `audience` is carried through the editor untouched. It is set by a
// seeder, there is no editor for it yet, and a save that dropped it would
// widen a restricted step to the whole enrolment without saying so.
type StepDraft = { delayMinutes: number; audience?: SeqAudience; action: { type: "text" | "template" | "media"; text?: string; templateName?: string; languageCode?: string; params?: string[]; mediaKind?: "image" | "video" | "document" | "audio"; url?: string; caption?: string } };
type SeqRow = { id: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string | null; channelId: string | null; active: boolean; team: Lane | null; aidaStage: AidaStage | null; steps: { delayMinutes: number; audience?: SeqAudience; action: StepDraft["action"] }[] };
type SeqDraft = { id?: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string; channelId: string | null; active: boolean; team: Lane | null; aidaStage: AidaStage | null; steps: StepDraft[] };
const EMPTY_SEQ: SeqDraft = { name: "", platform: "whatsapp", triggerKind: "manual", triggerValue: "", channelId: null, active: true, team: null, aidaStage: null, steps: [{ delayMinutes: 0, action: { type: "text", text: "" } }] };

// describeAudience now lives in seqaudience.ts, imported above: the page had
// a near-identical copy whose comment said it "mirrors" the lib one, which is
// a promise no compiler keeps. Only the lib version learned to summarise a
// forty-value list, so for a while the two said different things about the
// same rule on the same screen.
// Attaching the media a sequence step sends.
//
// This was a bare "Media URL" box. WhatsApp fetches media by URL, so a URL
// is genuinely what the step needs — but nobody has one to hand, and the
// portal already has a public bucket and an upload route that every other
// media field uses. Asking for a URL here meant uploading the file
// somewhere else first, or pasting a link to a Drive page that Meta cannot
// fetch and that fails as an opaque send error.
//
// The URL box stays, because a hosted asset is a real answer. The upload is
// the path for everybody else.
//
// `accept` is narrowed to what uploadguard.ts will actually store for the
// chosen kind. A refusal after the file has uploaded is a worse experience
// than a file picker that never offered it — and the refusal text that does
// get through is written for the person, so it is shown verbatim.
const MEDIA_ACCEPT: Record<string, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/3gpp,video/quicktime",
  document: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv",
};

function SeqMediaPicker({ action, onChange }: {
  action: StepDraft["action"];
  onChange: (patch: Partial<StepDraft["action"]>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kind = action.mediaKind ?? "image";
  const url = action.url ?? "";

  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      // The refusal messages are prose written for whoever is standing here
      // ("SVG images can carry scripts — export it as a PNG"). Swallowing
      // them, as the older upload buttons do, leaves the field empty with no
      // reason given and the person re-picking the same file.
      if (!r.ok || !d.url) setErr(d.error || "Upload failed. Try again.");
      else onChange({ url: d.url });
    } catch {
      setErr("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className={`${inp} !py-1.5`} aria-label="Media type" value={kind}
          onChange={e => onChange({ mediaKind: e.target.value as NonNullable<StepDraft["action"]["mediaKind"]> })}
        >
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="document">Document</option>
        </select>

        <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-dashed border-line text-xs font-bold cursor-pointer hover:border-brand-500 ${busy ? "opacity-60 pointer-events-none" : ""}`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
          {busy ? "Uploading…" : "Upload"}
          <input
            type="file" className="hidden" accept={MEDIA_ACCEPT[kind] ?? ""}
            onChange={e => {
              const f = e.target.files?.[0];
              // Cleared before the await: the input is reused, and leaving
              // the old value means re-picking the SAME file fires nothing.
              e.currentTarget.value = "";
              if (f) void upload(f);
            }}
          />
        </label>

        {url && !busy && (
          <button type="button" onClick={() => { onChange({ url: "" }); setErr(null); }}
            className="text-[11px] font-bold text-ink-400 hover:text-red-600">Remove</button>
        )}
      </div>

      <input
        className={`${inp} w-full`} placeholder="Media URL — or upload a file above"
        aria-label="Media URL" value={url} onChange={e => { onChange({ url: e.target.value }); setErr(null); }}
      />
      <input
        className={`${inp} w-full`} placeholder="Caption (optional)"
        aria-label="Caption" value={action.caption ?? ""} onChange={e => onChange({ caption: e.target.value })}
      />

      {err && (
        <p className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-control px-2.5 py-1.5">{err}</p>
      )}

      {url && !err && (
        <div className="flex items-center gap-2">
          {kind === "image"
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={url} alt="" className="w-12 h-12 rounded-control object-cover border border-line" />
            : <Paperclip className="w-4 h-4 text-ink-400" />}
          <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-700 hover:underline truncate max-w-[22rem]">{url}</a>
        </div>
      )}

      <p className="text-[11px] text-ink-400">
        WhatsApp fetches this by URL, so it has to be publicly reachable — a Drive or Dropbox share page is not.
        Uploading puts it in this workspace&apos;s own public bucket.
      </p>
    </div>
  );
}

// Picking the template a sequence step sends.
//
// This was two free-text boxes. A template name is not something anybody
// remembers correctly — it is lowercase, underscored, and has to match a
// name on Meta exactly — and a typo fails at SEND time, four weeks into a
// campaign, as one line in last_error that nobody is watching.
//
// Scoped to the number the sequence sends from, because templates are
// WABA-scoped: the same name approved on a different account does not exist
// here. Picking one fills the language too, so the two can never disagree.
//
// Free text is still reachable. A template approved minutes ago may not be
// in Meta's list yet, and an editor that cannot express a real name is
// worse than one that lets you get it wrong.
type SeqTpl = { name: string; status: string; language: string; components?: TemplateComponent[] };
const tplKey = (n: string, l: string) => `${n}\u0000${l}`;
/** Highest {{n}} in the body — how many params the step must supply. */
function tplVarCount(t: SeqTpl): number {
  const body = t.components?.find(c => c.type === "BODY")?.text ?? "";
  return Math.max(0, ...(body.match(/\{\{(\d+)\}\}/g) ?? []).map(m => parseInt(m.replace(/\D/g, ""), 10)));
}

function SeqTemplatePicker({ channelId, action, onChange }: {
  channelId: string | null;
  action: StepDraft["action"];
  onChange: (patch: Partial<StepDraft["action"]>) => void;
}) {
  const [tpls, setTpls] = useState<SeqTpl[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    // Reset first: while the new number's list is in flight the OLD list is
    // still in state, so a name from the previous account would look valid
    // for a moment — exactly when the warning matters most.
    setLoaded(false);
    fetch(`/api/admin/templates${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ""}`)
      .then(r => r.json()).then(d => { setTpls(d.templates ?? []); setLoaded(true); })
      .catch(() => { setTpls([]); setLoaded(true); });
  }, [channelId]);

  const name = action.templateName ?? "";
  const lang = action.languageCode ?? "";
  const approved = tpls.filter(t => t.status === "APPROVED");
  const chosen = approved.find(t => tplKey(t.name, t.language) === tplKey(name, lang));
  const unknown = !!name && loaded && !chosen;
  const varCount = chosen ? tplVarCount(chosen) : 0;
  const params = action.params ?? [];

  if (manual) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="Template name" value={name} onChange={e => onChange({ templateName: e.target.value })} />
          <input className={inp} placeholder="Language (e.g. en_US)" value={lang} onChange={e => onChange({ languageCode: e.target.value })} />
        </div>
        <button type="button" onClick={() => setManual(false)} className="text-[11px] font-bold text-brand-700 hover:text-brand-600">Choose from the approved list instead</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <select
        className={`${inp} w-full`} aria-label="Template"
        value={chosen ? tplKey(chosen.name, chosen.language) : ""}
        onChange={e => {
          const t = approved.find(x => tplKey(x.name, x.language) === e.target.value);
          // Changing template throws the old params away — they belonged to
          // a different body and would be filled into the wrong {{n}}.
          onChange({ templateName: t?.name ?? "", languageCode: t?.language ?? "", params: [] });
        }}
      >
        <option value="">{loaded ? "Choose a template…" : "Loading templates…"}</option>
        {approved.map(t => (
          <option key={tplKey(t.name, t.language)} value={tplKey(t.name, t.language)}>
            {t.name} · {t.language}{tplVarCount(t) ? ` · ${tplVarCount(t)} variable${tplVarCount(t) === 1 ? "" : "s"}` : ""}
          </option>
        ))}
      </select>

      {!channelId && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-2.5 py-1.5">
          Pick the number this sends from first — templates only exist on the account they were approved for.
        </p>
      )}
      {channelId && loaded && !approved.length && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-2.5 py-1.5">
          No approved templates on this number yet{tpls.length ? ` (${tpls.length} still pending or rejected)` : ""}.
        </p>
      )}
      {unknown && (
        <p className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-control px-2.5 py-1.5">
          <b>“{name}” is not approved on this number.</b> This step will fail at send time. Templates are tied to the account they were approved on.
        </p>
      )}

      {/* Variables. A template with {{1}} sent without a param is rejected by
          Meta with #132000 — and nothing in this editor used to ask for them. */}
      {varCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-ink-500">What fills each blank</p>
          {Array.from({ length: varCount }, (_, v) => (
            <input
              key={v} className={`${inp} w-full !py-1`} placeholder={`{{${v + 1}}}`}
              aria-label={`Value for variable ${v + 1}`}
              value={params[v] ?? ""}
              onChange={e => {
                const next = Array.from({ length: varCount }, (_, k) => params[k] ?? "");
                next[v] = e.target.value;
                onChange({ params: next });
              }}
            />
          ))}
        </div>
      )}

      <button type="button" onClick={() => setManual(true)} className="text-[11px] font-bold text-brand-700 hover:text-brand-600">
        Type a name instead
      </button>
    </div>
  );
}

// Format a step delay (minutes) as a human label for the preview timeline.
function fmtDelay(min: number): string {
  if (!min || min <= 0) return "immediately";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return "after " + [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
}

// A labelled field. The sequence editor had none: four controls sat in a grid
// with placeholder text on the two inputs and nothing at all on the two
// selects, so the trigger dropdown simply read "Manual / API" with no
// indication that it was the trigger. A select cannot carry a placeholder, so
// the label is the only thing that can say what it is.
function SeqField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">{label}</p>
      {children}
      {hint && <p className="text-[11px] text-ink-400 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

// A wait, in whatever unit the person is thinking in.
//
// This was a box of raw minutes, which asks somebody planning a three-day
// follow-up to type 4320. The stored value is still minutes; only the typing
// changes. The unit is held in state rather than re-derived on every render, so
// typing 24 while in hours does not rewrite itself as "1 day" mid-keystroke.
const DELAY_UNITS: [string, number][] = [["minutes", 1], ["hours", 60], ["days", 1440]];
function DelayPicker({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const [unit, setUnit] = useState(() =>
    minutes && minutes % 1440 === 0 ? 1440 : minutes && minutes % 60 === 0 ? 60 : 1);
  const shown = unit === 1 ? minutes : Math.round((minutes / unit) * 100) / 100;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input type="number" min={0} className={`${inp} !py-1 w-16`} value={shown}
        onChange={e => onChange(Math.max(0, Math.round((Number(e.target.value) || 0) * unit)))} />
      <select className={`${inp} !py-1`} value={unit}
        onChange={e => {
          // Keep the real wait unchanged when the unit changes — this is a
          // change of how it reads, not of what it does.
          setUnit(Number(e.target.value));
        }}>
        {DELAY_UNITS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </span>
  );
}

// Chat-style preview of a sequence — each step shown as the message the contact
// receives, in WhatsApp or Instagram styling, with the wait before each step.
function SequencePreview({ platform, steps, channelId }: { platform: "whatsapp" | "instagram"; steps: StepDraft[]; channelId: string | null }) {
  const ig = platform === "instagram";
  // One fetch for the whole panel. A template step shows the approved body
  // and buttons rather than a filename — what the operator is checking is
  // the message, and the filename is the one part the lead never sees.
  const [tpls, setTpls] = useState<SeqTpl[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    fetch(`/api/admin/templates${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ""}`)
      .then(r => r.json()).then(d => { setTpls(d.templates ?? []); setLoaded(true); })
      .catch(() => { setTpls([]); setLoaded(true); });
  }, [channelId]);
  const find = (name?: string, lang?: string) =>
    tpls.find(t => tplKey(t.name, t.language) === tplKey(name ?? "", lang ?? ""));
  const bubble = ig ? "bg-slate-100 text-slate-800 rounded-2xl rounded-bl-md" : "bg-white text-slate-800 rounded-lg rounded-tl-sm";
  return (
    <div className="xl:w-72 shrink-0">
      <p className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Preview · {ig ? "Instagram" : "WhatsApp"}</p>
      <div className={`rounded-control p-3 space-y-3 ${ig ? "bg-white border border-line" : "bg-[#e5ddd5]"}`}>
        {steps.map((st, i) => {
          const a = st.action;
          // Hoisted so the timestamp can sit ABOVE the button strip, which is
          // where WhatsApp puts it — buttons are a footer attached to the
          // bubble, not part of the message.
          const tpl = a.type === "template" ? find(a.templateName, a.languageCode) : undefined;
          const parts = tpl ? previewParts(tpl, a.params ?? []) : null;
          return (
            <div key={i} className="space-y-1.5">
              <p className="text-center"><span className="text-[10px] text-slate-500 bg-black/[0.06] rounded-full px-2 py-0.5">⏱ {fmtDelay(st.delayMinutes)}</span></p>
              <div className="flex">
                <div className={`max-w-[85%] px-3 py-2 text-[13px] shadow-sm ${bubble}`}>
                  {a.type === "text" && <p className="whitespace-pre-wrap break-words">{a.text?.trim() || "Empty message…"}</p>}
                  {a.type === "template" && !parts && <>
                    <p className="font-semibold break-words">📄 {a.templateName?.trim() || "template"}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {!a.templateName?.trim() ? "no template chosen yet"
                        : !loaded ? "loading the approved copy…"
                        : "not approved on this number — nothing to preview"}
                    </p>
                  </>}
                  {a.type === "template" && parts && <>
                    {parts.headerMedia && (
                      <div className="w-full h-20 bg-slate-200 rounded-md flex items-center justify-center text-slate-400 mb-1">
                        {parts.headerMedia === "VIDEO" ? <Video className="w-5 h-5" /> : parts.headerMedia === "DOCUMENT" ? <FileText className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
                      </div>
                    )}
                    {parts.headerText && <p className="font-bold break-words mb-1">{parts.headerText}</p>}
                    <p className="whitespace-pre-wrap break-words">{parts.body}</p>
                    {parts.footer && <p className="text-[11px] text-slate-400 mt-1 break-words">{parts.footer}</p>}
                    {parts.buttons.length > 0 && <>
                      <p className="text-[9px] text-slate-400 text-right mt-0.5">10:30</p>
                      <div className="-mx-3 -mb-2 border-t border-slate-200 divide-y divide-slate-200">
                        {parts.buttons.map((b, bi) => (
                          <p key={bi} className="text-center text-[12px] font-medium text-[#00a5f4] py-1.5 px-2 break-words">{b}</p>
                        ))}
                      </div>
                    </>}
                  </>}
                  {a.type === "media" && <>
                    {a.mediaKind === "image" && a.url
                      ? <ImgFallback url={a.url} imgClass="w-40 h-24 object-cover rounded-md" boxClass="w-40 h-24 bg-slate-200 rounded-md flex items-center justify-center text-slate-400" icon={<ImageIcon className="w-6 h-6" />} />
                      : <div className="w-40 h-24 bg-slate-200 rounded-md flex items-center justify-center text-slate-400">{a.mediaKind === "video" ? <Video className="w-6 h-6" /> : a.mediaKind === "document" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}</div>}
                    {a.caption?.trim() && <p className="break-words mt-1">{a.caption}</p>}
                  </>}
                  {!parts?.buttons.length && <p className="text-[9px] text-slate-400 text-right mt-0.5">10:30</p>}
                </div>
              </div>
            </div>
          );
        })}
        {!steps.length && <p className="text-xs text-ink-400 text-center py-4">Add steps to preview the conversation.</p>}
      </div>
    </div>
  );
}

// Auto-drip by LeadSquared stage (Phase 6): when a lead's LSQ stage changes
// (delivered by the LSQ→portal webhook), the mapped sequence starts and other
// stage-managed sequences stop. Config in wa_settings via /api/admin/stage-drips.
// Landing-page form → WhatsApp flow. A cold web-form lead can't be sent free-form
// messages, so this sends an approved TEMPLATE on the LeadSquared event and ARMS
// the question flow for the reply. Config in wa_settings via /api/admin/lead-welcome.
type LeadWelcomeCfg = { enabled: boolean; templateName: string; languageCode: string; nameParam: boolean; flowId: string; trigger: string; sourceContains: string };
function LeadWelcomePanel() {
  const { lead1, leadN } = useWords();
  const [cfg, setCfg] = useState<LeadWelcomeCfg | null>(null);
  const [flows, setFlows] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { fetch("/api/admin/lead-welcome").then(r => r.json()).then(d => setCfg(d.config ?? null)).catch(() => setCfg(null)); }, []);
  useEffect(() => { fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows((d.flows ?? []).filter((f: { platform?: string }) => !f.platform || f.platform === "whatsapp" || f.platform === "all"))).catch(() => {}); }, []);

  async function save() {
    if (!cfg) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/lead-welcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).then(r => r.json());
      if (d.error) setMsg(d.error); else { setCfg(d.config); setMsg("Saved ✓"); }
    } finally { setBusy(false); }
  }
  if (!cfg) return null;
  const set = (p: Partial<LeadWelcomeCfg>) => setCfg(c => c ? { ...c, ...p } : c);
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Zap className="w-4 h-4 text-brand-700" /> Landing-page form → WhatsApp flow</p>
          <p className="text-[11px] text-ink-400">When a form {lead1} arrives from LeadSquared, send an approved <b>template</b> and start your <b>question flow</b> the moment they reply. Cold web {leadN} can&apos;t be messaged free-form — the template opens the 24h window, then the flow runs.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-700 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} /> On</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className={`${inp} !py-1.5 text-xs`} placeholder="Approved template name" value={cfg.templateName} onChange={e => set({ templateName: e.target.value })} />
        <input className={`${inp} !py-1.5 text-xs`} placeholder="Template language (e.g. en / en_US)" value={cfg.languageCode} onChange={e => set({ languageCode: e.target.value })} />
        <select className={`${inp} !py-1.5 text-xs`} value={cfg.flowId} onChange={e => set({ flowId: e.target.value })}>
          <option value="">Pick the question flow…</option>
          {flows.map(f => <option key={f.id} value={f.id}>{f.name}{f.active ? "" : " (inactive)"}</option>)}
        </select>
        <select className={`${inp} !py-1.5 text-xs`} value={cfg.trigger === "created" ? "created" : "stage"} onChange={e => set({ trigger: e.target.value === "created" ? "created" : "" })}>
          <option value="created">Fire on: new {lead1} created</option>
          <option value="stage">Fire on: {lead1} enters a stage</option>
        </select>
        {cfg.trigger !== "created" && <input className={`${inp} !py-1.5 text-xs`} placeholder="LSQ stage name (exact)" value={cfg.trigger} onChange={e => set({ trigger: e.target.value })} />}
        <input className={`${inp} !py-1.5 text-xs`} placeholder="Only if Source contains… (optional)" value={cfg.sourceContains} onChange={e => set({ sourceContains: e.target.value })} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={cfg.nameParam} onChange={e => set({ nameParam: e.target.checked })} /> template uses {"{{1}}"} = {lead1}&apos;s first name</label>
        <div className="flex-1" />
        <button onClick={save} disabled={busy} className="px-3 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "…" : "Save"}</button>
        {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
      </div>
      <p className="text-[11px] text-ink-400">Set the LeadSquared automation for your signup form to POST to the LSQ→portal webhook (see docs/lsq-webhooks.md). Each {lead1} is welcomed once per 30 days; opted-out numbers are skipped.</p>
    </div>
  );
}

// The switch that starts the stage drip, and the dry run it is read from.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// The poll asks LeadSquared which leads reached the hand-off stage, because
// LeadSquared has no API for creating the Automation that would otherwise
// tell us. It had an API route and no UI at all, which meant the one control
// that starts sending marketing templates to thousands of real people could
// only be operated by somebody with database access.
//
// Worse, observe mode wrote its findings to wa_settings and nothing read them
// back. A dry run nobody can see is not a dry run — it is a delay.
//
// So the panel's real job is the bottom half: showing WHAT THE LAST PASS SAW,
// so the decision to go live is made against evidence rather than a promise.
type PollCfg = {
  enabled: boolean; mode: "observe" | "apply"; stage: string;
  watermark: string | null; maxPerRun: number; burstAlarm: number;
  lastRunAt?: string; lastApplied?: number; lastError?: string;
  lastCandidates?: number;
  lastObserved?: { phone: string; stage: string | null; knownStage: string | null; wouldEnroll: string | null; note: string }[];
};

//
// ── Why this needs a screen at all ────────────────────────────────────────
//
// The journey is five steps, three audience rules, a send window, a daily
// cap and an enrolment guard. Exactly one of those — the steps — can be set
// from the sequence editor, so hand-building it produces a DIFFERENT journey
// that looks right: every step to everybody, at any hour, as often as the
// delays allow. The seeder has existed since the drip was designed and could
// only be reached by posting to an API, which meant in practice it was run
// once and then nobody could re-run it.
//
// ── Why rebuilding matters more than building ─────────────────────────────
//
// The course lists inside the saved steps are a FROZEN COPY of the programme
// table, taken at seed time. Teaching that table a new course changes the
// code, the tests and nothing else: the live drip goes on reaching exactly
// who it reached before. That had already happened twice — Tanvi's answers
// sat unapplied for a day, and the 17 names LeadSquared actually uses were
// mapped and still reached nobody until a rebuild.
//
// So this screen leads with the diff, not the build button. It compares what
// the library would produce now against what is saved, and says which steps
// are stale. A rebuild that changes nothing should look like one.
type SeedStep = { id: string; day: number; template: string; params: string[]; audience: SeqAudience; note: string | null };
function StagePollPanel({ seqs }: { seqs: SeqRow[] }) {
  const { vocab, lead1, leadN, seq1 } = useWords();
  const ask = useConfirm();
  const [cfg, setCfg] = useState<PollCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/stage-poll").then(r => r.json()).then(d => setCfg(d.poll ?? null)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Record<string, unknown>, note?: string) {
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/stage-poll", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      }).then(r => r.json());
      if (d.error) setMsg(d.error);
      else { setCfg(d.poll ?? null); setMsg(note ?? "Saved ✓"); }
    } catch { setMsg("Connection error."); }
    finally { setBusy(false); }
  }

  if (!cfg) return null;
  const live = cfg.enabled && cfg.mode === "apply";
  const seqName = (id: string | null) => seqs.find(s => s.id === id)?.name ?? id ?? "—";
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

  // Going live is the one action here that reaches customers. It is gated on
  // the same facts a person would want to check first — which stage, which
  // sequence, and how many leads one pass can touch.
  async function goLive() {
    const ok = await ask({
      title: `Start enrolling ${leadN} for real?`,
      message: `${vocab.lead.many} reaching this stage will be enrolled into the ${seq1} and will start receiving WhatsApp messages. This also turns on owner sync, which moves live conversations onto the owning ${vocab.teamMember.one.toLowerCase()}'s number — visible to your team.`,
      facts: [
        { label: "Stage watched", value: cfg!.stage || "(none set)" },
        { label: "Per pass, at most", value: String(cfg!.maxPerRun) },
        { label: "Last pass saw", value: `${cfg!.lastCandidates ?? 0} candidate(s)` },
      ],
      confirmLabel: "Go live",
      tone: "caution",
    });
    if (ok) await save({ mode: "apply", enabled: true }, "Live — enrolling for real.");
  }

  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4 text-brand-700" /> Stage poll
          </p>
          <p className="text-[11px] text-ink-400">
            Asks LeadSquared every minute which {leadN} reached the hand-off stage, because LeadSquared has no API for creating an Automation. Runs the same decisions as the webhook, so both together are harmless.
          </p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${live ? "bg-brand-700 text-white" : cfg.enabled ? "bg-amber-100 text-amber-900" : "bg-canvas text-ink-400 border border-line"}`}>
          {live ? "LIVE" : cfg.enabled ? "WATCHING ONLY" : "OFF"}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-ink-400">Stage</label>
        <input
          className={`${inp} !py-1.5 text-xs w-44`} placeholder="e.g. Qualified"
          defaultValue={cfg.stage}
          onBlur={e => { if (e.target.value.trim() !== cfg.stage) void save({ stage: e.target.value.trim() }, "Stage changed — the next pass re-seeds and enrols nobody."); }}
        />
        <label className="text-[11px] text-ink-400 ml-2">Max per pass</label>
        <input
          type="number" min={1} max={500} className={`${inp} !py-1.5 text-xs w-20`} defaultValue={cfg.maxPerRun}
          onBlur={e => { const n = Number(e.target.value); if (n > 0 && n !== cfg.maxPerRun) void save({ maxPerRun: n }); }}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void save({ enabled: !cfg.enabled })}
          disabled={busy}
          className="px-3 py-1 rounded-control border border-line text-xs font-bold text-ink-900 hover:bg-canvas disabled:opacity-60"
        >
          {cfg.enabled ? "Turn off" : "Turn on"}
        </button>
        {cfg.mode === "apply" ? (
          <button
            onClick={() => void save({ mode: "observe" }, "Back to watching only — nothing will enrol.")}
            disabled={busy}
            className="px-3 py-1 rounded-control border border-amber-300 bg-amber-50 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            Stop enrolling
          </button>
        ) : (
          <button
            onClick={() => void goLive()}
            disabled={busy || !cfg.stage.trim()}
            className="px-3 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60"
            title={cfg.stage.trim() ? undefined : "Set the stage first"}
          >
            Go live
          </button>
        )}
        <button
          onClick={() => void save({ runNow: true }, "Ran one pass.")}
          disabled={busy || !cfg.enabled}
          className="px-3 py-1 rounded-control border border-line text-xs font-semibold text-ink-900 hover:bg-canvas disabled:opacity-60"
        >
          Run a pass now
        </button>
        {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
      </div>

      <div className="text-[11px] text-ink-400 flex flex-wrap gap-x-4 gap-y-0.5">
        <span>Last run: <b className="text-ink-900">{when(cfg.lastRunAt)}</b></span>
        <span>Candidates: <b className="text-ink-900">{cfg.lastCandidates ?? 0}</b></span>
        <span>Enrolled last pass: <b className="text-ink-900">{cfg.lastApplied ?? 0}</b></span>
        {cfg.watermark && <span>Caught up to: <b className="text-ink-900">{when(cfg.watermark)}</b></span>}
      </div>
      {cfg.lastError && (
        <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-1.5">{cfg.lastError}</p>
      )}

      {/* The point of the whole screen: what the dry run actually saw. */}
      <div>
        <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">
          What the last pass saw {cfg.mode !== "apply" && <span className="normal-case tracking-normal">(nothing was sent)</span>}
        </p>
        {!cfg.lastObserved?.length ? (
          <p className="text-[11px] text-ink-400">
            Nothing yet. A {lead1} has to MOVE onto the stage while the poll is on — {leadN} already sitting there are treated as seen, so switching on never messages the backlog.
          </p>
        ) : (
          <div className="border border-line rounded-control divide-y divide-line">
            {cfg.lastObserved.map((o, i) => (
              <div key={i} className="px-3 py-1.5 flex items-start justify-between gap-3">
                <span className="text-[12px] text-ink-900 font-medium shrink-0">{o.phone}</span>
                <span className="text-[11px] text-ink-400 text-right min-w-0 break-words">
                  {o.knownStage ?? "new"} → {o.stage} · {o.wouldEnroll ? <b className="text-brand-700">{seqName(o.wouldEnroll)}</b> : o.note}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-ink-400">
        Switching the stage re-seeds: the {leadN} already on it are treated as already seen, so the backlog is never messaged. Only {leadN} who move onto it afterwards are enrolled.
      </p>
    </div>
  );
}

function StageDripsPanel({ seqs }: { seqs: SeqRow[] }) {
  const { lead1, leadN, seq1 } = useWords();
  const [drips, setDrips] = useState<{ stage: string; sequenceId: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { fetch("/api/admin/stage-drips").then(r => r.json()).then(d => setDrips(d.drips ?? [])).catch(() => setDrips([])); }, []);

  async function save() {
    if (!drips) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/stage-drips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drips: drips.filter(x => x.stage.trim() && x.sequenceId) }) }).then(r => r.json());
      if (d.error) setMsg(d.error);
      else { setDrips(d.drips ?? []); setMsg("Saved ✓"); }
    } finally { setBusy(false); }
  }

  if (drips === null) return null;
  const clash = drips.some((d, i) => d.stage.trim() && drips.findIndex(x => x.stage.trim().toLowerCase() === d.stage.trim().toLowerCase()) !== i);
  const waSeqs = seqs.filter(s => s.platform === "whatsapp");
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Database className="w-4 h-4 text-brand-700" /> Auto-drip by LeadSquared stage</p>
        <p className="text-[11px] text-ink-400">When a {lead1}&apos;s LSQ stage changes (via the LSQ→portal webhook), start that stage&apos;s {seq1} — and stop the other stage-managed ones (the {lead1} moved on). Stage names must match LSQ&apos;s ProspectStage exactly (case-insensitive). Opted-out {leadN} are never enrolled.</p>
      </div>
      {drips.map((d, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <input className={`${inp} !py-1.5 text-xs w-44`} placeholder="CRM stage, e.g. Contacted" value={d.stage}
            onChange={e => setDrips(a => (a ?? []).map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)))} />
          <span className="text-[11px] text-ink-400">→</span>
          <select className={`${inp} !py-1.5 text-xs`} value={d.sequenceId}
            onChange={e => setDrips(a => (a ?? []).map((x, j) => (j === i ? { ...x, sequenceId: e.target.value } : x)))}>
            <option value="">Select {seq1}…</option>
            {waSeqs.map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (inactive)"}</option>)}
          </select>
          <button onClick={() => setDrips(a => (a ?? []).filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDrips(a => [...(a ?? []), { stage: "", sequenceId: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add stage rule</button>
        <button onClick={save} disabled={busy || clash} className="px-3 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "…" : "Save rules"}</button>
        {clash && <span className="text-[11px] text-red-500">Duplicate stage.</span>}
        {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
      </div>
      <p className="text-[11px] text-ink-400">Cold {leadN} are usually outside Meta&apos;s 24h window — make each mapped {seq1}&apos;s <b>step 1 an approved template</b> or it will be skipped.</p>
    </div>
  );
}

// Which rungs of the funnel actually have a journey.
//
// This is the whole audit finding, made permanent. Both teams are supposed to
// run a full Attention → Interest → Desire → Action, and the gap nobody could
// see was that Desire — the proof, the outcomes, the alumni, the scarcity —
// had no journey in either lane. A list of sequences cannot show an absence;
// a grid can.
function FunnelCoverage({ seqs }: { seqs: SeqRow[] }) {
  const { leadN } = useWords();
  const live = seqs.filter(s => s.active);
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-2.5">
      <div>
        <p className="text-sm font-bold text-ink-900">Funnel coverage</p>
        <p className="text-[11px] text-ink-400">Each team runs its own full funnel. An empty cell is a stage with nothing sending.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full min-w-[520px]">
          <thead>
            <tr className="text-ink-400">
              <th className="text-left font-medium py-1 pr-3 w-24"></th>
              {AIDA_STAGES.map(st => <th key={st} className="text-left font-medium py-1 px-1.5" title={AIDA_LABELS[st].job}>{AIDA_LABELS[st].label}</th>)}
            </tr>
          </thead>
          <tbody>
            {LANES.map(lane => (
              <tr key={lane} className="border-t border-line">
                <td className="py-1.5 pr-3 font-semibold text-ink-700 capitalize">{lane}</td>
                {AIDA_STAGES.map(st => {
                  const hits = live.filter(x => x.team === lane && x.aidaStage === st);
                  return (
                    <td key={st} className="py-1.5 px-1.5">
                      {hits.length
                        ? <span className="inline-block rounded-full bg-brand-50 text-brand-700 font-semibold px-2 py-0.5" title={hits.map(h => h.name).join(", ")}>{hits.length}</span>
                        : <span className="inline-block rounded-full bg-canvas text-ink-400 px-2 py-0.5">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {seqs.some(s => !s.team) && (
        <p className="text-[11px] text-amber-700">
          {seqs.filter(s => !s.team).length} journey(s) are not filed under a team, so they do not appear above and will reach {leadN} in either lane.
        </p>
      )}
    </div>
  );
}

// Auto-drip by the grade a counsellor gives a lead. Same shape as the stage
// panel above, on the other axis LeadSquared grades on — kept separate because
// a lead moves on one without moving on the other, so one combined screen
// would force a choice the CRM does not.
function ScoreDripsPanel({ seqs }: { seqs: SeqRow[] }) {
  const { leadN, seq1 } = useWords();
  const [drips, setDrips] = useState<{ score: string; sequenceId: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { fetch("/api/admin/lead-score-drips").then(r => r.json()).then(d => setDrips(d.drips ?? [])).catch(() => setDrips([])); }, []);

  async function save() {
    if (!drips) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/lead-score-drips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drips: drips.filter(x => x.score.trim() && x.sequenceId) }) }).then(r => r.json());
      if (d.error) setMsg(d.error);
      else { setDrips(d.drips ?? []); setMsg("Saved ✓"); }
    } finally { setBusy(false); }
  }

  if (drips === null) return null;
  const clash = drips.some((d, i) => d.score.trim() && drips.findIndex(x => x.score.trim().toLowerCase() === d.score.trim().toLowerCase()) !== i);
  const waSeqs = seqs.filter(s => s.platform === "whatsapp");
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Database className="w-4 h-4 text-brand-700" /> Auto-drip by lead score</p>
        <p className="text-[11px] text-ink-400">When someone on your team grades one of your {leadN} in LeadSquared (the <b>Lead Score</b> field), start that grade&apos;s {seq1} — and stop the other score-managed ones. Needs a LeadSquared automation posting to the portal webhook on a Lead Score change. Opted-out {leadN} are never enrolled.</p>
      </div>
      <datalist id="lsq-scores">{KNOWN_SCORES.map(v => <option key={v} value={v} />)}</datalist>
      {drips.map((d, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <input list="lsq-scores" className={`${inp} !py-1.5 text-xs w-44`} placeholder="Lead Score, e.g. Hot" value={d.score}
            onChange={e => setDrips(a => (a ?? []).map((x, j) => (j === i ? { ...x, score: e.target.value } : x)))} />
          <span className="text-[11px] text-ink-400">→</span>
          <select className={`${inp} !py-1.5 text-xs`} value={d.sequenceId}
            onChange={e => setDrips(a => (a ?? []).map((x, j) => (j === i ? { ...x, sequenceId: e.target.value } : x)))}>
            <option value="">Select {seq1}…</option>
            {waSeqs.map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (inactive)"}</option>)}
          </select>
          <button onClick={() => setDrips(a => (a ?? []).filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDrips(a => [...(a ?? []), { score: "", sequenceId: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add score rule</button>
        <button onClick={save} disabled={busy || clash} className="px-3 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "…" : "Save rules"}</button>
        {clash && <span className="text-[11px] text-red-500">Duplicate score.</span>}
        {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
      </div>
      <p className="text-[11px] text-ink-400">Grading {leadN} by hand is almost never inside Meta&apos;s 24h window — make each mapped {seq1}&apos;s <b>step 1 an approved template</b> or it will be skipped.</p>
    </div>
  );
}

// Run a drip from LeadSquared: pull leads matching an advanced (multi-condition)
// search and enroll them into a sequence. Preview before enrolling.
const LSQ_OPS: [string, string][] = [["eq", "equals"], ["contains", "contains"], ["gt", "after / greater"], ["lt", "before / less"]];
// Suggestions for the condition field box (a datalist, so anything else can
// still be typed). mx_Lead_Score leads because grading a lead by hand is the
// most common reason to build an audience, and it was absent — typeable in
// principle, undiscoverable in practice.
const LSQ_FIELDS = ["mx_Lead_Score", "ProspectStage", "Source", "Owner", "OwnerIdName", "mx_City", "CreatedOn", "EmailAddress", "Score", "EngagementScore"];
function LsqDripPanel({ seqs }: { seqs: SeqRow[] }) {
  const { vocab, lead1, leadN, seq1 } = useWords();
  const ask = useConfirm();
  const [conds, setConds] = useState<{ field: string; op: string; value: string }[]>([{ field: "ProspectStage", op: "eq", value: "" }]);
  const [seqId, setSeqId] = useState("");
  const [preview, setPreview] = useState<{ count: number; scanned: number; truncated: boolean; sample: string[] } | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "enroll">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = conds.filter(c => c.field.trim() && c.value.trim());
  const hasAnchor = valid.some(c => c.op === "eq");
  const setCond = (i: number, patch: Partial<{ field: string; op: string; value: string }>) => setConds(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function run(action: "preview" | "enroll") {
    if (action === "enroll") {
      if (!seqId) { setMsg({ ok: false, text: `Select ${seq1} to enroll into.` }); return; }
      if (!(await ask({
        title: `Enrol these ${leadN} into the drip?`, tone: "caution", confirmLabel: `Enrol ${leadN}`, typeToConfirm: "ENROL",
        message: `Everyone enrolled starts receiving this ${seq1}'s messages on its schedule. Enrolments cannot be un-sent once a message has gone.`,
        facts: [{ label: vocab.lead.many, value: preview?.count != null ? `${preview.count.toLocaleString()} matching` : `all matching ${leadN}` }],
      }))) return;
    }
    setBusy(action); setMsg(null); if (action === "preview") setPreview(null);
    try {
      const res = await fetch("/api/admin/leadsquared/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, conditions: valid, sequenceId: seqId || undefined }) });
      const d = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: d.error || "Failed" }); return; }
      if (action === "preview") setPreview(d);
      else setMsg({ ok: true, text: `Enrolled ${d.enrolled} ${d.enrolled === 1 ? lead1 : leadN}${d.skippedOptout ? `, skipped ${d.skippedOptout} opted-out` : ""}${d.truncated ? " (capped at 5000 — refine to reach the rest)" : ""}.` });
    } catch { setMsg({ ok: false, text: "Connection error" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Database className="w-4 h-4 text-brand-700" /> Run a drip from LeadSquared</p>
        <p className="text-[11px] text-ink-400">Pull {leadN} matching these conditions and enroll them into one of your {vocab.sequence.many.toLowerCase()}. Needs ≥1 <b>equals</b> condition (the anchor); the rest refine the list.</p>
      </div>
      <div className="space-y-1.5">
        {conds.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input list="lsq-fields" className={`${inp} flex-1`} placeholder="Field (e.g. ProspectStage)" value={c.field} onChange={e => setCond(i, { field: e.target.value })} />
            <select className={`${inp} w-32 shrink-0`} value={c.op} onChange={e => setCond(i, { op: e.target.value })}>{LSQ_OPS.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
            <input className={`${inp} flex-1`} placeholder="Value (e.g. Prospect)" value={c.value} onChange={e => setCond(i, { value: e.target.value })} />
            {conds.length > 1 && <button onClick={() => setConds(cs => cs.filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>}
          </div>
        ))}
        <datalist id="lsq-fields">{LSQ_FIELDS.map(f => <option key={f} value={f} />)}</datalist>
        {conds.length < 6 && <button onClick={() => setConds(cs => [...cs, { field: "", op: "eq", value: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add condition</button>}
      </div>
      {!hasAnchor && valid.length > 0 && <p className="text-[11px] text-amber-600">Add at least one <b>equals</b> condition — it anchors the LeadSquared search.</p>}
      <div className="flex items-center gap-2">
        <select className={`${inp} flex-1`} value={seqId} onChange={e => setSeqId(e.target.value)}>
          <option value="">Enroll into {seq1}…</option>
          {seqs.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={() => run("preview")} disabled={!hasAnchor || busy !== ""} className="px-3 py-2 rounded-control border border-brand-700 text-brand-700 text-xs font-bold hover:bg-brand-50 disabled:opacity-50 shrink-0">
          {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Preview count"}
        </button>
        <button onClick={() => run("enroll")} disabled={!hasAnchor || !seqId || busy !== ""} className="px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50 shrink-0">
          {busy === "enroll" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enroll"}
        </button>
      </div>
      {preview && <p className="text-[11px] text-ink-600"><b className="text-brand-700">{preview.count}</b> {leadN} match{preview.truncated ? " (capped at 5000)" : ""} · scanned {preview.scanned}{preview.sample.length ? ` · e.g. ${preview.sample.join(", ")}` : ""}</p>}
      {msg && <p className={`text-[11px] font-semibold ${msg.ok ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p>}
      <p className="text-[10px] text-ink-400">Cold {leadN} (no recent chat) only receive a message if the {seq1}&apos;s first step is an approved <b>template</b> — the 24h window is closed until they reply. Opt-outs are skipped automatically.</p>
    </div>
  );
}

// ── Drip analytics: funnel, drop-off and conversion across every journey ─────
type DripOverviewPayload = {
  totalEnrolled: number;
  active: number;
  completed: number;
  stopped: number;
  failed: number;
  completionRate: number;
  stoppedRate: number;
  failedRate: number;
};

type DripAnalyticsPayload = {
  overview: DripOverviewPayload;
  /** The same numbers before the status filter — what the status pills count. */
  statusCounts: DripOverviewPayload;
  bySequence: {
    id: string;
    name: string;
    platform: "whatsapp" | "instagram";
    triggerKind: string;
    triggerValue: string | null;
    active: boolean;
    team: Lane | null;
    aidaStage: AidaStage | null;
    totalSteps: number;
    totalEnrolled: number;
    activeCount: number;
    completedCount: number;
    stoppedCount: number;
    failedCount: number;
    completionRate: number;
    stoppedRate: number;
    failedRate: number;
    steps: {
      stepIndex: number;
      stepNumber: number;
      type: string;
      templateName: string | null;
      delayMinutes: number;
      label: string;
      currentlyOn: number;
      reachedCount: number;
      stoppedCount: number;
      failedCount: number;
      retentionRate: number;
    }[];
    errors: { error: string; count: number }[];
  }[];
  dailyTrend: { date: string; enrolled: number; completed: number; stopped: number; failed: number }[];
  granularity: "day" | "week" | "month";
  sequences: { id: string; name: string; platform: string; active: boolean }[];
  truncated: boolean;
  scanned: number;
  filter: { sequenceId: string; range: string; status: string; platform: string };
};

// One window, named once, used by the dropdown AND by every caption that
// reports a figure. A period that lives only in a <select> is a number with
// no shape: "total enrolled: 428" of WHAT span?
const RANGE_LABELS: Record<string, string> = {
  all: "all time",
  today: "today",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
};
const RANGE_ORDER = ["all", "today", "7d", "14d", "30d", "90d"] as const;

// The server already bucketed and zero-filled the series; this only scales it.
// Zero-filled matters, and a zero bar is drawn as nothing rather than as a
// stub — a gap in enrolments has to stay a visible gap.
//
// It sits inside the hero card rather than in a band of its own: a chart two
// hundred pixels away from the number it explains is a second thing to read.
function DripSparkline({
  trend, granularity,
}: {
  trend: DripAnalyticsPayload["dailyTrend"];
  granularity: DripAnalyticsPayload["granularity"];
}) {
  if (!trend.length) return null;
  const max = Math.max(1, ...trend.map(t => t.enrolled));
  const unit = granularity === "month" ? "month " : granularity === "week" ? "week of " : "";
  const fmt = (d: string) =>
    granularity === "month"
      ? new Date(`${d}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })
      : new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-px h-10" role="img" aria-label="Enrolments over the selected window">
        {trend.map(t => (
          <div
            key={t.date}
            className="flex-1 min-w-px h-full flex items-end"
            title={`${unit}${fmt(t.date)} — ${t.enrolled} enrolled · ${t.completed} completed · ${t.stopped} stopped · ${t.failed} failed`}
          >
            <div
              className="w-full bg-brand-600 rounded-t-[2px]"
              style={{ height: t.enrolled === 0 ? 0 : `${Math.max(4, Math.round((t.enrolled / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-ink-400 tnum">
        <span>{fmt(trend[0].date)}</span>
        <span>peak {max.toLocaleString()}</span>
        <span>{fmt(trend[trend.length - 1].date)}</span>
      </div>
    </div>
  );
}

function fmtDripDelay(min: number): string {
  if (min <= 0) return "Immediate (0m)";
  if (min < 60) return `Wait ${min}m`;
  if (min < 1440) return `Wait ${Math.round(min / 60)}h`;
  const d = Math.round(min / 1440);
  return `Wait ${d} day${d === 1 ? "" : "s"}`;
}

function SeqAnalyticsPanel({
  seqs,
  onFilterEnrollments,
}: {
  seqs: SeqRow[];
  onFilterEnrollments?: (filter: { seqId?: string; status?: string }) => void;
}) {
  const { vocab, seq1, seqN, ctN } = useWords();
  const [selectedSeq, setSelectedSeq] = useState<string>("all");
  const [range, setRange] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [data, setData] = useState<DripAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  const loadAnalytics = useCallback(() => {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (selectedSeq !== "all") params.set("sequenceId", selectedSeq);
    if (range !== "all") params.set("range", range);
    if (platform !== "all") params.set("platform", platform);
    if (status !== "all") params.set("status", status);

    fetch(`/api/admin/sequences/analytics?${params.toString()}`)
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(d => setData(d))
      .catch(e => setErr(e.message || "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [selectedSeq, range, platform, status]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  const zeroOverview: DripOverviewPayload = {
    totalEnrolled: 0, active: 0, completed: 0, stopped: 0, failed: 0,
    completionRate: 0, stoppedRate: 0, failedRate: 0,
  };
  const overview = data?.overview ?? zeroOverview;
  // The pills count the unfiltered cohort on purpose. Counting the FILTERED
  // one zeroes every pill but the selected one, so once you click "Failed"
  // the other four read 0 and there is nothing left to click back to.
  const statusCounts = data?.statusCounts ?? zeroOverview;

  const currentSeq = selectedSeq !== "all"
    ? data?.bySequence.find(s => s.id === selectedSeq)
    : data?.bySequence.length === 1
      ? data.bySequence[0]
      : null;

  return (
    <div className="bg-white rounded-card border border-line p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold text-ink-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-700" /> {vocab.sequence.one} analytics &amp; funnel
          </h3>
          <p className="text-xs text-ink-400 mt-0.5 tnum">
            {seqs.length} {seqs.length === 1 ? seq1 : seqN} · {RANGE_LABELS[range] ?? "all time"}
            {platform !== "all" ? ` · ${platform === "instagram" ? "Instagram" : "WhatsApp"}` : ""}
          </p>
        </div>
        <button
          onClick={loadAnalytics}
          disabled={loading}
          className="px-2.5 py-1.5 rounded-control border border-line text-xs font-semibold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          title="Refresh analytics"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-brand-700" : ""}`} /> Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-canvas border border-line rounded-control p-3 flex flex-wrap items-center gap-2.5 text-xs">
        <div className="flex items-center gap-1.5 text-ink-600 font-semibold shrink-0">
          <Filter className="w-3.5 h-3.5 text-brand-700" /> Filters:
        </div>

        <select className={`${inp} !py-1 text-xs max-w-xs`} value={selectedSeq} onChange={e => setSelectedSeq(e.target.value)}>
          <option value="all">All {seqN} ({seqs.length})</option>
          {seqs.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.platform === "instagram" ? "IG" : "WA"})</option>
          ))}
        </select>

        <select className={`${inp} !py-1 text-xs`} value={range} onChange={e => setRange(e.target.value)}>
          {RANGE_ORDER.map(k => <option key={k} value={k}>{RANGE_LABELS[k]}</option>)}
        </select>

        <select className={`${inp} !py-1 text-xs`} value={platform} onChange={e => setPlatform(e.target.value)}>
          <option value="all">All platforms</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
        </select>

        <div className="h-4 w-px bg-line hidden md:block" />

        <div className="flex items-center gap-1 flex-wrap">
          {[
            { id: "all", label: "All statuses", count: statusCounts.totalEnrolled },
            { id: "active", label: "Active", count: statusCounts.active },
            { id: "completed", label: "Completed", count: statusCounts.completed },
            { id: "stopped", label: "Stopped", count: statusCounts.stopped },
            { id: "failed", label: "Failed", count: statusCounts.failed },
          ].map(tab => {
            const isSel = status === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatus(tab.id)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1 ${
                  isSel ? "bg-ink-950 border-ink-950 text-white" : "bg-white border-line text-ink-600 hover:bg-slate-50"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 rounded-full text-[10px] font-bold ${isSel ? "bg-white/20 text-white" : "bg-slate-100 text-ink-600"}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {(selectedSeq !== "all" || range !== "all" || platform !== "all" || status !== "all") && (
          <button
            onClick={() => { setSelectedSeq("all"); setRange("all"); setPlatform("all"); setStatus("all"); }}
            className="text-[11px] text-brand-700 hover:underline font-semibold ml-auto"
          >
            Reset filters
          </button>
        )}
      </div>

      {err && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-control text-xs text-red-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {data?.truncated && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-control text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Showing the most recent {data.scanned.toLocaleString()} enrolments — there are more than that in
            this window. Narrow the date range or pick a single {seq1} for exact figures.
          </span>
        </div>
      )}

      {/* One number is the hero; the four states are support. A row of six
          equal cards gave the eye nowhere to land. */}
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-5 bg-canvas border border-line rounded-control p-4 flex flex-col justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
              Enrolled · {RANGE_LABELS[range] ?? "all time"}
            </p>
            <p className="text-[2.5rem] leading-none font-black text-ink-900 mt-1.5 tnum">
              {overview.totalEnrolled.toLocaleString()}
            </p>
            <p className="text-[11px] text-ink-400 mt-1.5">
              {status === "all"
                ? `across ${data?.bySequence.length ?? 0} ${(data?.bySequence.length ?? 0) === 1 ? seq1 : seqN}`
                : `${status} only — of ${statusCounts.totalEnrolled.toLocaleString()} enrolled`}
            </p>
          </div>
          {data && <DripSparkline trend={data.dailyTrend} granularity={data.granularity} />}
        </div>

        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { key: "active", label: "Active", dot: "bg-blue-500", value: overview.active,
              note: `${overview.totalEnrolled > 0 ? Math.round((overview.active / overview.totalEnrolled) * 100) : 0}% in progress` },
            { key: "completed", label: "Completed", dot: "bg-emerald-500", value: overview.completed,
              note: `${overview.completionRate}% of finished` },
            { key: "stopped", label: "Stopped", dot: "bg-amber-500", value: overview.stopped,
              note: `${overview.stoppedRate}% replied or opted out` },
            { key: "failed", label: "Failed", dot: "bg-red-500", value: overview.failed,
              note: `${overview.failedRate}% delivery errors` },
          ] as const).map(c => (
            <div key={c.key} className="bg-canvas border border-line rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{c.label}</span>
              </div>
              {/* Ink, not the status hue. Five saturated numbers competed for
                  the same attention and none of them won it. */}
              <p className="text-xl font-black text-ink-900 mt-2 tnum">{c.value.toLocaleString()}</p>
              <p className="text-[10px] text-ink-400 mt-0.5 tnum">{c.note}</p>
            </div>
          ))}
        </div>
      </div>

      {currentSeq ? (
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                <Workflow className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-ink-900">{currentSeq.name}</h4>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${currentSeq.platform === "instagram" ? "bg-pink-50 text-pink-600" : "bg-emerald-50 text-emerald-700"}`}>
                    {currentSeq.platform === "instagram" ? "Instagram" : "WhatsApp"}
                  </span>
                  {!currentSeq.active && <span className="text-[10px] font-bold text-red-500">OFF</span>}
                </div>
                <p className="text-[11px] text-ink-400">
                  Trigger: <span className="font-semibold text-ink-600">{triggerLabel(currentSeq.triggerKind)}</span>
                  {currentSeq.triggerValue ? ` “${currentSeq.triggerValue}”` : ""} · {currentSeq.totalSteps} step{currentSeq.totalSteps === 1 ? "" : "s"} · {currentSeq.totalEnrolled} enrolled
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedSeq !== "all" && seqs.length > 1 && (
                <button onClick={() => setSelectedSeq("all")} className="text-xs text-brand-700 hover:underline font-semibold">
                  ← Compare all {seqN}
                </button>
              )}
              {onFilterEnrollments && (
                <button
                  onClick={() => onFilterEnrollments({ seqId: currentSeq.id, status })}
                  className="px-2.5 py-1 rounded-control bg-canvas hover:bg-slate-100 border border-line text-xs font-semibold text-ink-700 flex items-center gap-1"
                >
                  View in monitor table ↓
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Step-by-step drop-off &amp; retention</span>
              <span className="text-ink-400 text-[11px]">A step counts as reached once it has actually been sent</span>
            </div>

            {currentSeq.steps.length === 0 ? (
              <p className="text-xs text-ink-400 py-4 text-center bg-canvas rounded-control border border-line">
                No steps configured for this {seq1}.
              </p>
            ) : (
              <div className="space-y-2.5">
                {currentSeq.steps.map((st, i) => {
                  const isFirst = i === 0;
                  const prevStep = isFirst ? null : currentSeq.steps[i - 1];
                  const dropFromPrev = prevStep && prevStep.reachedCount > 0
                    ? Math.round(((prevStep.reachedCount - st.reachedCount) / prevStep.reachedCount) * 100)
                    : 0;

                  return (
                    <div key={st.stepIndex} className="border border-line rounded-control p-3 bg-white hover:border-slate-300 transition-colors space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 font-bold flex items-center justify-center text-xs shrink-0">#{st.stepNumber}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">{st.type}</span>
                          <span className="font-semibold text-ink-900 truncate max-w-xs" title={st.label}>
                            {st.templateName ? `template "${st.templateName}"` : st.label}
                          </span>
                          <span className="text-ink-400 text-[11px]">({fmtDripDelay(st.delayMinutes)})</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 text-[11px]">
                          <span className="font-bold text-ink-900">
                            {st.reachedCount.toLocaleString()} <span className="text-ink-400 font-normal">reached ({st.retentionRate}%)</span>
                          </span>
                          <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold" title="Waiting for this step to send">
                            {st.currentlyOn} in flight
                          </span>
                          {st.stoppedCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-semibold" title="Stopped before this step (replied / opted out)">
                              {st.stoppedCount} stopped
                            </span>
                          )}
                          {st.failedCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 font-semibold" title="Failed on this step">
                              {st.failedCount} failed
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="w-full bg-canvas rounded-full h-2.5 overflow-hidden flex">
                          <div
                            className="bg-brand-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(1, st.retentionRate)}%` }}
                            title={`${st.reachedCount} of ${currentSeq.totalEnrolled} reached this step (${st.retentionRate}%)`}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-ink-400">
                          <span>{st.reachedCount} delivered</span>
                          {!isFirst && dropFromPrev > 0 && (
                            <span className="text-amber-600 font-medium">▼ {dropFromPrev}% drop-off from step #{st.stepNumber - 1}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {currentSeq.errors.length > 0 && (
            <div className="border border-red-200 bg-red-50/60 rounded-control p-3 space-y-2">
              <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Delivery failures
              </p>
              <div className="divide-y divide-red-200/60 text-xs">
                {currentSeq.errors.map((er, idx) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-red-800 truncate font-mono text-[11px]" title={er.error}>{er.error}</span>
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[10px] shrink-0">
                      {er.count} contact{er.count === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Every {seq1} — comparison</p>
            <p className="text-[11px] text-ink-400">Click any row to inspect its step drop-off</p>
          </div>

          {!data?.bySequence.length ? (
            <p className="text-xs text-ink-400 py-6 text-center bg-canvas rounded-control border border-line">
              No {seqN} match the current filters.
            </p>
          ) : (
            <div className="border border-line rounded-control overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-canvas text-[10px] font-bold text-ink-400 uppercase">
                <div className="col-span-4 sm:col-span-3">{vocab.sequence.one}</div>
                <div className="col-span-2 hidden sm:block">Trigger / steps</div>
                <div className="col-span-2 text-right">Enrolled</div>
                <div className="col-span-2 text-right">Active</div>
                <div className="col-span-2 text-right">Stopped</div>
                <div className="col-span-2 sm:col-span-1 text-right">Done</div>
              </div>

              <div className="divide-y divide-line text-xs">
                {data.bySequence.map(seq => (
                  <div
                    key={seq.id}
                    onClick={() => setSelectedSeq(seq.id)}
                    className="grid grid-cols-12 gap-2 px-3 py-2.5 items-center hover:bg-slate-50 cursor-pointer transition-colors group"
                  >
                    <div className="col-span-4 sm:col-span-3 min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-bold text-ink-900 group-hover:text-brand-700 transition-colors truncate">{seq.name}</span>
                        {!seq.active && <span className="text-[9px] font-bold text-red-500">OFF</span>}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-ink-400 mt-0.5">
                        <span className={seq.platform === "instagram" ? "text-pink-600 font-semibold" : "text-emerald-700 font-semibold"}>
                          {seq.platform === "instagram" ? "IG" : "WA"}
                        </span>
                        {seq.team && <span>· {seq.team}</span>}
                      </div>
                    </div>

                    <div className="col-span-2 hidden sm:block truncate text-ink-500 text-[11px]">
                      <span>{triggerLabel(seq.triggerKind)}</span>
                      <span className="text-ink-400"> · {seq.totalSteps} steps</span>
                    </div>

                    <div className="col-span-2 text-right font-black text-ink-900 tnum">{seq.totalEnrolled.toLocaleString()}</div>
                    <div className="col-span-2 text-right tnum">
                      <span className="font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">{seq.activeCount}</span>
                    </div>
                    <div className="col-span-2 text-right tnum">
                      <span className="font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md" title="Stopped on reply or action">{seq.stoppedCount}</span>
                    </div>
                    <div className="col-span-2 sm:col-span-1 text-right tnum">
                      <span className="font-bold text-emerald-700">{seq.completedCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Test + monitor a drip: enroll one number on demand, force the due steps to run
// (without waiting for the 5-minute cron), and watch every enrollment's progress
// + errors. This is what turns "is it even working?" into a yes/no you can see.
type EnrRow = { id: string; sequenceName: string; phone: string; platform: string; currentStep: number; status: string; nextRunAt: string | null; lastError: string | null; updatedAt: string | null };
function fmtWhen(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s); if (isNaN(d.getTime())) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff), m = Math.round(abs / 60000), h = Math.round(abs / 3600000), days = Math.round(abs / 86400000);
  const rel = m < 1 ? "now" : m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${days}d`;
  return diff >= 0 ? `in ${rel}` : `${rel} ago`;
}
const ENR_BADGE: Record<string, string> = { active: "bg-blue-50 text-blue-600", completed: "bg-emerald-50 text-emerald-600", stopped: "bg-slate-100 text-slate-500", failed: "bg-red-50 text-red-600" };
function SeqMonitorPanel({ seqs, filterFromAnalytics }: { seqs: SeqRow[]; filterFromAnalytics?: { seqId?: string; status?: string } | null }) {
  const { vocab, seq1, seqN, ct1, ctN } = useWords();
  const [enr, setEnr] = useState<EnrRow[]>([]);
  const [total, setTotal] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [offset, setOffset] = useState(0);
  const [seqId, setSeqId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"" | "test" | "run" | "refresh">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [contacts, setContacts] = useState<{ phone: string; name: string; withinWindow: boolean }[]>([]);

  // Monitor-level filters, independent of the test box above.
  const [filterSeq, setFilterSeq] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  // "View in monitor table ↓" from the analytics panel lands here.
  useEffect(() => {
    if (filterFromAnalytics) {
      if (filterFromAnalytics.seqId !== undefined) setFilterSeq(filterFromAnalytics.seqId);
      if (filterFromAnalytics.status !== undefined) setFilterStatus(filterFromAnalytics.status);
      setOffset(0);
    }
  }, [filterFromAnalytics]);

  // Paged on the SERVER. The list used to ask for 100 rows and render all of
  // them; a workspace with a few thousand enrolments turned the monitor into
  // the slowest thing on the page and still showed only a prefix.
  const loadEnr = useCallback((lim = perPage, off = offset) => {
    const params = new URLSearchParams({ limit: String(lim), offset: String(off) });
    if (filterSeq !== "all") params.set("sequenceId", filterSeq);
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterPlatform !== "all") params.set("platform", filterPlatform);
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/admin/sequences/enrollments?${params.toString()}`)
      .then(r => r.json())
      .then(d => { setEnr(d.enrollments ?? []); setTotal(d.total ?? 0); })
      .catch(() => {});
  }, [perPage, offset, filterSeq, filterStatus, filterPlatform, search]);
  useEffect(() => { loadEnr(); }, [loadEnr]);

  const page = Math.floor(offset / perPage) + 1;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const hasFilters = filterSeq !== "all" || filterStatus !== "all" || filterPlatform !== "all" || search.trim() !== "";

  // The picked sequence drives the platform — and the test sends on THAT platform
  // (a WhatsApp sequence can't reach Instagram). Load valid contacts for it.
  const selSeq = seqs.find(s => s.id === seqId) || null;
  const platform = selSeq?.platform ?? "whatsapp";
  useEffect(() => {
    if (!seqId) { setContacts([]); return; }
    fetch(`/api/admin/sequences/test-contacts?platform=${platform}`).then(r => r.json()).then(d => setContacts(d.contacts ?? [])).catch(() => setContacts([]));
  }, [seqId, platform]);

  async function testEnroll() {
    if (!seqId) { setMsg({ ok: false, text: `Select ${seq1} to test.` }); return; }
    if (!phone.trim()) { setMsg({ ok: false, text: platform === "instagram" ? `Pick an Instagram ${ct1} (you can't message a handle).` : "Enter a WhatsApp number to test with." }); return; }
    setBusy("test"); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences/test-enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequenceId: seqId, phone }) });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: d.note || "Enrolled." } : { ok: false, text: d.error || "Failed" });
      setOffset(0); loadEnr(perPage, 0);
    } catch { setMsg({ ok: false, text: "Connection error" }); }
    finally { setBusy(""); }
  }
  async function runNow() {
    setBusy("run"); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences/run", { method: "POST" });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: `Processed ${d.processed} due step(s) now.` } : { ok: false, text: d.error || "Failed" });
      loadEnr();
    } catch { setMsg({ ok: false, text: "Connection error" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><FlaskConical className="w-4 h-4 text-brand-700" /> Test &amp; monitor</p>
        <p className="text-[11px] text-ink-400">Enroll your own number to test a drip, force due steps to send now (instead of waiting up to 5 min for the scheduler), and watch every enrollment below.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inp} flex-1 min-w-[10rem]`} value={seqId} onChange={e => { setSeqId(e.target.value); setPhone(""); setMsg(null); }}>
          <option value="">Test {seq1}…</option>
          {seqs.map(s => <option key={s.id} value={s.id}>{s.name}{!s.active ? " (off)" : ""}</option>)}
        </select>
        {selSeq && <span className={`px-2 py-1.5 rounded-control text-[11px] font-bold shrink-0 ${platform === "instagram" ? "bg-pink-50 text-pink-600" : "bg-emerald-50 text-emerald-700"}`}>sends on {platform === "instagram" ? "Instagram" : "WhatsApp"}</span>}
        {seqId && (
          <select className={`${inp} w-48`} value="" onChange={e => { if (e.target.value) setPhone(e.target.value); }}>
            <option value="">{contacts.length ? `Select ${ct1} who messaged you…` : `No ${ctN} on this platform yet`}</option>
            {contacts.map(c => <option key={c.phone} value={c.phone}>{c.name}{c.withinWindow ? " ✅" : ""}</option>)}
          </select>
        )}
        <input className={`${inp} w-44`} placeholder={platform === "instagram" ? "IG id — pick a contact ↑" : "WhatsApp number"} value={phone} onChange={e => setPhone(e.target.value)} />
        <button onClick={testEnroll} disabled={busy !== "" || !seqId} className="px-3 py-2 rounded-control border border-brand-700 text-brand-700 text-xs font-bold hover:bg-brand-50 disabled:opacity-50 shrink-0 flex items-center gap-1.5">{busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enroll &amp; send</button>
        <button onClick={runNow} disabled={busy !== ""} className="px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50 shrink-0 flex items-center gap-1.5">{busy === "run" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Run due steps now</button>
        <button onClick={() => loadEnr()} className="p-2 rounded-control border border-line text-ink-500 hover:bg-canvas shrink-0" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      {msg && <p className={`text-[11px] font-semibold ${msg.ok ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p>}
      <p className="text-[10px] text-ink-400">The test sends on the <b>{seq1}&apos;s platform</b> — to test Instagram, pick an <b>Instagram</b> {seq1}. Instagram can only message someone who <b>DMed your IG first</b> (so pick them from the list — you can&apos;t message a @handle). <b>✅</b> = messaged in the last 24h, so a plain <b>text</b> step will deliver; otherwise use an approved <b>template</b> step.</p>

      {/* Monitor filters */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line text-xs">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className={`${inp} w-full !pl-8 !py-1 text-xs`}
            placeholder={`Search ${ct1} phone number…`}
            value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0); }}
          />
        </div>
        <select className={`${inp} !py-1 text-xs`} value={filterSeq} onChange={e => { setFilterSeq(e.target.value); setOffset(0); }}>
          <option value="all">All {seqN}</option>
          {seqs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={`${inp} !py-1 text-xs`} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setOffset(0); }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="stopped">Stopped</option>
          <option value="failed">Failed</option>
        </select>
        <select className={`${inp} !py-1 text-xs`} value={filterPlatform} onChange={e => { setFilterPlatform(e.target.value); setOffset(0); }}>
          <option value="all">All platforms</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => { setFilterSeq("all"); setFilterStatus("all"); setFilterPlatform("all"); setSearch(""); setOffset(0); }}
            className="text-xs text-brand-700 hover:underline font-semibold"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Enrollment monitor */}
      <div id="seq-enrollment-monitor" className="border border-line rounded-control overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-canvas text-[10px] font-bold text-ink-400 uppercase">
          <div className="col-span-3">{vocab.sequence.one}</div><div className="col-span-3">{vocab.contact.one}</div><div className="col-span-2">Step</div><div className="col-span-2">Status</div><div className="col-span-2">Next / error</div>
        </div>
        {enr.length === 0 && (
          <p className="px-3 py-3 text-xs text-ink-400">
            {hasFilters
              ? "No enrollments match the current filter."
              : total === 0
                ? "No enrollments yet. Enroll a number above, or wire a trigger (keyword / growth tool) and have someone message you."
                : "No results on this page."}
          </p>
        )}
        {enr.map(e => (
          <div key={e.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-line text-[12px] items-center">
            <div className="col-span-3 truncate font-medium text-ink-800">{e.sequenceName}</div>
            <div className="col-span-3 truncate font-mono text-ink-600">{e.phone}<span className="text-ink-300"> · {e.platform === "instagram" ? "IG" : "WA"}</span></div>
            <div className="col-span-2 text-ink-600">#{(e.currentStep ?? 0) + 1}</div>
            <div className="col-span-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ENR_BADGE[e.status] ?? "bg-slate-100 text-slate-500"}`}>{e.status}</span></div>
            <div className="col-span-2 truncate text-[11px]">{e.lastError ? <span className="text-red-600" title={e.lastError}>⚠ {e.lastError}</span> : <span className="text-ink-400">{e.status === "active" ? fmtWhen(e.nextRunAt) : fmtWhen(e.updatedAt)}</span>}</div>
          </div>
        ))}
        {total > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-line text-xs text-ink-500">
            <span>{offset + 1}–{Math.min(offset + perPage, total)} of {total.toLocaleString()}</span>
            <div className="flex items-center gap-3">
              <select className="border border-line rounded-lg px-2 py-1 text-xs" value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setOffset(0); }}>
                {[25, 50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
              <button onClick={() => setOffset(o => Math.max(0, o - perPage))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30" title="Previous page"><ChevronLeft className="w-4 h-4" /></button>
              <span className="font-semibold">{page}/{lastPage}</span>
              <button onClick={() => setOffset(o => o + perPage)} disabled={page >= lastPage} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30" title="Next page"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SequencesTab() {
  const { vocab, leadN, seq1, seqN, ct1 } = useWords();
  const ask = useConfirm();
  const [seqs, setSeqs] = useState<SeqRow[]>([]);
  const [monitorFilter, setMonitorFilter] = useState<{ seqId?: string; status?: string } | null>(null);
  const [form, setForm] = useState<SeqDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs(d.sequences ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  function editRow(s: SeqRow) {
    setForm({ id: s.id, name: s.name, platform: s.platform, triggerKind: s.triggerKind, triggerValue: s.triggerValue ?? "", channelId: s.channelId, active: s.active, team: s.team ?? null, aidaStage: s.aidaStage ?? null, steps: s.steps.length ? s.steps.map(st => ({ delayMinutes: st.delayMinutes, audience: st.audience ?? null, action: st.action })) : EMPTY_SEQ.steps });
    setMsg(null);
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg(`Give the ${seq1} a name.`); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, triggerValue: form.triggerValue || null }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!(await ask({
      title: `Delete this ${seq1}?`, tone: "danger", confirmLabel: `Delete ${seq1}`,
      message: "Anyone part-way through it stops receiving the rest of its messages.",
    }))) return;
    await fetch("/api/admin/sequences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    closeIfDeleted(setForm, id);
    load();
  }
  const setStep = (i: number, patch: Partial<StepDraft>) => setForm(f => f ? { ...f, steps: f.steps.map((s, j) => j === i ? { ...s, ...patch } : s) } : f);
  const setStepAction = (i: number, patch: Partial<StepDraft["action"]>) => setForm(f => f ? { ...f, steps: f.steps.map((s, j) => j === i ? { ...s, action: { ...s.action, ...patch } } : s) } : f);

  const editorRef = useRevealOnOpen(!!form);
  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Workflow className="w-5 h-5" /> {vocab.sequence.many}</h2>
          <p className="text-sm text-slate-500">Timed multi-step follow-ups. Triggered by keywords, opt-ins, story replies, abandoned carts, and more — they run automatically and respect the 24-hour window.</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_SEQ }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New {seq1}</button>
      </div>

      {/* How a sequence actually fires — the part that's easy to miss. */}
      <div className="bg-brand-50/60 border border-brand-700/15 rounded-card p-4 text-[12px] text-ink-700 space-y-1.5">
        <p className="font-bold text-ink-900 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-brand-700" /> How your {seqN} run</p>
        <p><b>1. A trigger enrols someone.</b> Each {seq1} does nothing on its own — it needs an entry point: a <b>keyword</b> they send, a <b>growth tool</b> opt-in, an Instagram <b>story reply</b>, a cart/order event, or the <b>Test</b> box below. Set the trigger on the {seq1}, then make sure that path exists.</p>
        <p><b>2. The schedule sends the steps.</b> A background job runs <b>every ~5 minutes</b> and delivers each step once its wait is up. <b>Step 1&apos;s wait</b> counts from enrolment (0 = send immediately); every later step&apos;s wait counts from the previous step.</p>
        <p><b>3. The 24-hour rule applies.</b> Plain <b>text/media</b> steps only deliver if the {ct1} messaged you in the last 24h. To reach people outside that window, make the step an approved <b>template</b>.</p>
        <p className="text-ink-400">Not sure it&apos;s working? Use <b>Test &amp; monitor</b> below — enroll your own number and click <b>Run due steps now</b>.</p>
      </div>

      {seqs.map(s => (
        <div key={s.id} className="bg-white rounded-card border border-line p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Workflow className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{s.name} {!s.active && <span className="text-[10px] font-bold text-red-500">· OFF</span>}</p>
            <p className="text-[11px] text-ink-400">{s.team ? <span className="font-semibold text-ink-600">{s.team === "sales" ? "Sales" : "Marketing"}{s.aidaStage ? ` · ${AIDA_LABELS[s.aidaStage].label}` : ""} · </span> : <span className="text-amber-600 font-semibold">Unassigned · </span>}{s.platform} · starts when: {triggerLabel(s.triggerKind)}{s.triggerValue ? ` “${s.triggerValue}”` : ""} · {s.steps.length} step{s.steps.length === 1 ? "" : "s"}</p>
          </div>
          <button onClick={() => editRow(s)} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(s.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!seqs.length && !form && <p className="text-xs text-ink-400">No {seqN} yet.</p>}

      {form && (
        <div ref={editorRef} className="bg-white rounded-card border-2 border-brand-700/30 p-4 flex flex-col xl:flex-row gap-5">
          <div className="flex-1 min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <SeqField label="Name it" hint="Only you see this.">
              <input className={`${inp} w-full`} placeholder="Brochure follow-up" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </SeqField>
            <SeqField label="Where it sends" hint="Changing this changes which triggers are available.">
              <select className={`${inp} w-full`} value={form.platform}
                onChange={e => {
                  // A trigger that does not exist on the new platform would stay
                  // selected and invisible, so move to one that does.
                  const platform = e.target.value as SeqDraft["platform"];
                  const keep = triggerSpec(form.triggerKind)?.platforms.includes(platform);
                  setForm({ ...form, platform, channelId: null, triggerKind: keep ? form.triggerKind : "manual", triggerValue: keep ? form.triggerValue : "" });
                }}>
                <option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option>
              </select>
            </SeqField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SeqField label="Which team runs this" hint={`Marketing speaks to ${leadN} nobody owns yet. Sales speaks to ${leadN} someone already owns. A journey never reaches the other team's ${leadN}.`}>
              <select className={`${inp} w-full`} value={form.team ?? ""}
                onChange={e => setForm({ ...form, team: (e.target.value || null) as Lane | null })}>
                <option value="">Unassigned — reaches anyone (old behaviour)</option>
                {LANES.map(l => <option key={l} value={l}>{l === "marketing" ? `Marketing — ${leadN} nobody owns yet` : `Sales — ${leadN} someone owns`}</option>)}
              </select>
            </SeqField>
            <SeqField label="What job it does" hint={form.aidaStage ? AIDA_LABELS[form.aidaStage].job : "Used to show which part of the funnel has no journey yet. It does not change how anything sends."}>
              <select className={`${inp} w-full`} value={form.aidaStage ?? ""}
                onChange={e => setForm({ ...form, aidaStage: (e.target.value || null) as AidaStage | null })}>
                <option value="">Not set</option>
                {AIDA_STAGES.map(st => <option key={st} value={st}>{AIDA_LABELS[st].label}</option>)}
              </select>
            </SeqField>
          </div>

          <SeqField label="What starts it" hint="Nothing is sent until something enrols someone.">
            <div className="space-y-1.5">
              {SEQ_TRIGGERS.filter(t => t.platforms.includes(form.platform)).map(t => {
                const on = form.triggerKind === t.value;
                return (
                  <label key={t.value}
                    className={`flex gap-2.5 items-start rounded-control border p-2.5 cursor-pointer transition-colors ${on ? "border-brand-700 bg-brand-50/60" : "border-line hover:bg-canvas"}`}>
                    <input type="radio" name="seq-trigger" className="accent-brand-700 mt-0.5" checked={on}
                      onChange={() => setForm({ ...form, triggerKind: t.value, triggerValue: "" })} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink-900">{t.label}</span>
                      <span className="block text-[11px] text-ink-600">{t.when}</span>
                      {t.note && <span className="block text-[11px] text-ink-400 mt-0.5">{t.note}</span>}
                    </span>
                  </label>
                );
              })}
              {/* Only ever rendered for a sequence already saved on one of the
                  dead four, so the setting is visible instead of silently kept. */}
              {SEQ_TRIGGERS_DEAD[form.triggerKind] && (
                <label className="flex gap-2.5 items-start rounded-control border border-amber-300 bg-amber-50 p-2.5">
                  <input type="radio" name="seq-trigger" className="accent-amber-500 mt-0.5" checked readOnly />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink-900">{SEQ_TRIGGERS_DEAD[form.triggerKind]}</span>
                    <span className="block text-[11px] text-ink-700">This one was never connected to anything — nobody is being enrolled by it. Pick one above instead.</span>
                  </span>
                </label>
              )}
            </div>
          </SeqField>

          {triggerSpec(form.triggerKind)?.field && (() => {
            const f = triggerSpec(form.triggerKind)!.field!;
            return (
              <SeqField label={f.label} hint={f.help}>
                <input className={`${inp} w-full max-w-xs`} inputMode={f.numeric ? "numeric" : undefined}
                  placeholder={f.placeholder} value={form.triggerValue}
                  onChange={e => setForm({ ...form, triggerValue: e.target.value })} />
              </SeqField>
            );
          })()}

          <div className="grid grid-cols-2 gap-3">
            <SeqField label={form.platform === "instagram" ? "Which account it sends from" : "Which number it sends from"}
              hint="Templates only work on the account they were approved for.">
              <ChannelSelect kind={form.platform} value={form.channelId} onChange={v => setForm({ ...form, channelId: v })} allLabel={form.platform === "instagram" ? "Account: default" : "Number: default"} className={`${inp} w-full`} />
            </SeqField>
            <SeqField label="Live?" hint="Switching this off also stops everyone part-way through.">
              <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer py-2">
                <input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
                {form.active ? "On — it can enrol people" : "Off — nothing will be sent"}
              </label>
            </SeqField>
          </div>

          <p className="text-xs font-bold text-slate-400 uppercase pt-1">Steps</p>
          {form.steps.map((st, i) => {
            // Minutes from enrolment, so a step that will land outside the
            // 24-hour window can be flagged where the mistake is being made
            // rather than discovered as a campaign that went quiet after day
            // one. Text and media steps are SKIPPED outside the window, not
            // failed, so nothing else would ever draw attention to it.
            const elapsed = form.steps.slice(0, i + 1).reduce((n, x) => n + Math.max(0, x.delayMinutes), 0);
            const willBeSkipped = elapsed >= 1440 && st.action.type !== "template";
            return (
            <div key={i} className="border border-line rounded-control p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs text-ink-500 flex-wrap">
                <span className="font-bold">#{i + 1}</span>
                <span>{i === 0 ? "after enrolling, wait" : "then wait"}</span>
                <DelayPicker minutes={st.delayMinutes} onChange={m => setStep(i, { delayMinutes: m })} />
                <span>and send</span>
                <select className={`${inp} !py-1`} value={st.action.type} onChange={e => setStepAction(i, { type: e.target.value as StepDraft["action"]["type"] })}>
                  <option value="text">Text</option><option value="template">Template</option><option value="media">Media</option>
                </select>
                <div className="flex-1" />
                {form.steps.length > 1 && <button onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })} className="p-1 text-ink-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
              </div>
              {st.action.type === "text" && <textarea className={`${inp} w-full`} rows={2} placeholder="Message text (sends inside the 24h window)" value={st.action.text ?? ""} onChange={e => setStepAction(i, { text: e.target.value })} />}
              {st.action.type === "template" && <SeqTemplatePicker channelId={form.channelId} action={st.action} onChange={patch => setStepAction(i, patch)} />}
              {/* Set by seeding; there is no editor for it yet. Shown
                  so nobody wonders why a step reached fewer people than the
                  enrolment count, and carried through the save untouched. */}
              {st.audience && (
                <p className="text-[11px] text-ink-600 bg-canvas border border-line rounded-control px-2.5 py-1.5">
                  <b>Only some {leadN} get this step.</b> {describeSeqAudience(st.audience)}
                </p>
              )}
              {st.action.type === "media" && <SeqMediaPicker action={st.action} onChange={patch => setStepAction(i, patch)} />}
              {willBeSkipped && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-2.5 py-1.5 leading-snug">
                  <b>This step will be skipped.</b> It lands more than 24 hours after the {ct1}
                  wrote to you, and WhatsApp only allows an approved template that far out. Change
                  it to a <b>Template</b>, or move it earlier.
                </p>
              )}
            </div>
          );})}
          <button onClick={() => setForm({ ...form, steps: [...form.steps, { delayMinutes: 60, action: { type: "text", text: "" } }] })} className="text-xs font-bold text-brand-700 hover:text-brand-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add step</button>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : `Save ${seq1}`}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
            {msg && <span className="text-xs text-red-500">{msg}</span>}
          </div>
          </div>
          <SequencePreview platform={form.platform} steps={form.steps} channelId={form.channelId} />
        </div>
      )}

      <FunnelCoverage seqs={seqs} />
      <SeqAnalyticsPanel
        seqs={seqs}
        onFilterEnrollments={(f) => {
          setMonitorFilter(f);
          document.getElementById("seq-enrollment-monitor")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      <SeqMonitorPanel seqs={seqs} filterFromAnalytics={monitorFilter} />
      <LeadWelcomePanel />
      <StagePollPanel seqs={seqs} />
      <StageDripsPanel seqs={seqs} />
      <ScoreDripsPanel seqs={seqs} />
      <LsqDripPanel seqs={seqs} />

    </div>
  );
}

// ── Catalog (commerce) ────────────────────────────────────────────────────────
type ProductRow = { id: string; name: string; description: string | null; priceCents: number; currency: string; imageUrl: string | null; retailerId: string | null; metaProductId: string | null; catalogId: string | null; available: boolean; buttonText: string | null; buttonUrl: string | null };
const EMPTY_PRODUCT = { id: undefined as string | undefined, name: "", description: "", price: "", currency: "INR", imageUrl: "", retailerId: "", metaProductId: "", catalogId: "", available: true, buttonText: "", buttonUrl: "" };

// Image that falls back to a placeholder icon when the URL is missing or fails
// to load (e.g. a non-image link was pasted), instead of a broken-image glyph.
function ImgFallback({ url, imgClass, boxClass, icon }: { url: string; imgClass: string; boxClass: string; icon: React.ReactNode }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  if (url && !err) return <img src={url} alt="" className={imgClass} onError={() => setErr(true)} />;
  return <div className={boxClass}>{icon}</div>;
}

function CatalogTab() {
  const ask = useConfirm();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [form, setForm] = useState<typeof EMPTY_PRODUCT | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const load = useCallback(() => { fetch("/api/admin/products").then(r => r.json()).then(d => setProducts(d.products ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function makeCheckout() {
    setCheckoutBusy(true); setMsg(null); setCheckoutId(null);
    try {
      const res = await fetch("/api/admin/checkout-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Checkout" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || `Could not create checkout flow (HTTP ${res.status})`);
      else if (d.published) setCheckoutId(d.id);
      else setMsg(`Created the flow but Meta couldn't publish it: ${(d.validationErrors?.length ? d.validationErrors.join("; ") : d.publishError) || "the Flow JSON didn't pass validation"}`);
    } catch {
      setMsg("Could not reach the server to create the checkout flow.");
    } finally { setCheckoutBusy(false); }
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg("Product name is required."); return; }
    // Left to the old `|| 0`, "abc" became a free product with no warning.
    if (!/^\d+(\.\d{1,2})?$/.test(form.price.trim())) { setMsg("Enter a price as a number, for example 4999 or 4999.00."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name: form.name, description: form.description, priceCents: Math.round(Number(form.price) * 100), currency: form.currency, imageUrl: form.imageUrl || null, retailerId: form.retailerId || null, metaProductId: form.metaProductId || null, catalogId: form.catalogId || null, available: form.available, buttonText: form.buttonText || null, buttonUrl: form.buttonUrl || null }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!(await ask({ title: "Delete this product?", tone: "danger", confirmLabel: "Delete product" }))) return;
    await fetch("/api/admin/products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    closeIfDeleted(setForm, id);
    load();
  }

  const editorRef = useRevealOnOpen(!!form);
  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><ShoppingBag className="w-5 h-5" /> Catalog</h2>
          <p className="text-sm text-slate-500">Products you can send in chat and sell via in-chat checkout. Abandoned carts auto-enroll into your cart-recovery sequence.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={makeCheckout} disabled={checkoutBusy} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60"><Workflow className="w-3.5 h-3.5" /> {checkoutBusy ? "Creating…" : "Create checkout flow"}</button>
          <button onClick={() => { setForm({ ...EMPTY_PRODUCT }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add product</button>
        </div>
      </div>
      {checkoutId && <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded-control px-3 py-2">Published a multi-screen checkout flow — id <code className="font-mono">{checkoutId}</code>. Use it in a flow&apos;s “WhatsApp form” node; on submit, the order is created from the contact&apos;s open cart.</p>}
      {!form && msg && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">⚠ {msg}{/credential|token|WABA|not configured/i.test(msg) ? " — checkout flows need a connected WhatsApp number with WhatsApp Flows access." : ""}</p>}

      {products.map(p => (
        <div key={p.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
          <ImgFallback url={p.imageUrl ?? ""} imgClass="w-12 h-12 rounded-lg object-cover shrink-0" boxClass="w-12 h-12 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ShoppingBag className="w-5 h-5 text-ink-300" />} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{p.name} {!p.available && <span className="text-[10px] font-bold text-red-500">· hidden</span>}</p>
            <p className="text-[11px] text-ink-400">{p.currency} {(p.priceCents / 100).toFixed(2)}{p.retailerId ? ` · SKU ${p.retailerId}` : ""}</p>
          </div>
          <button onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? "", price: String(p.priceCents / 100), currency: p.currency, imageUrl: p.imageUrl ?? "", retailerId: p.retailerId ?? "", metaProductId: p.metaProductId ?? "", catalogId: p.catalogId ?? "", available: p.available, buttonText: p.buttonText ?? "", buttonUrl: p.buttonUrl ?? "" })} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(p.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!products.length && !form && <p className="text-xs text-ink-400">No products yet.</p>}

      {form && (
        <div ref={editorRef} className="bg-white rounded-card border-2 border-brand-700/30 p-4 flex flex-col xl:flex-row gap-5">
          <div className="flex-1 space-y-2 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Product name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div className="flex gap-2"><input className={inp} placeholder="Price" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /><input className={`${inp} w-20`} placeholder="INR" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div className="col-span-2 flex items-center gap-3">
              <ImgFallback url={form.imageUrl} imgClass="w-14 h-14 rounded-lg object-cover border border-line shrink-0" boxClass="w-14 h-14 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ImageIcon className="w-5 h-5 text-ink-300" />} />
              <div className="flex-1 space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <ImageUpload onUploaded={url => setForm({ ...form, imageUrl: url })} />
                  {form.imageUrl && <button onClick={() => setForm({ ...form, imageUrl: "" })} className="text-[11px] font-semibold text-ink-400 hover:text-red-600">Remove</button>}
                </div>
                <input className={`${inp} w-full`} placeholder="…or paste an image link" value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} />
              </div>
            </div>
            <textarea className={`${inp} col-span-2`} rows={2} placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <input className={inp} placeholder={form.id ? "Your SKU / retailer id" : "SKU / retailer id — auto-generated if blank"} value={form.retailerId} onChange={e => setForm({ ...form, retailerId: e.target.value })} />
            <input className={inp} placeholder="Meta catalog product id (optional)" value={form.metaProductId} onChange={e => setForm({ ...form, metaProductId: e.target.value })} />
            <input className={inp} maxLength={20} placeholder='Button label (e.g. "Buy now") — max 20' value={form.buttonText} onChange={e => setForm({ ...form, buttonText: e.target.value })} />
            <input className={inp} placeholder="Button link (https://… — required to use a custom button)" value={form.buttonUrl} onChange={e => setForm({ ...form, buttonUrl: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.available} onChange={e => setForm({ ...form, available: e.target.checked })} /> available</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save product"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
          </div>
          <div className="xl:w-64 shrink-0">
            <p className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Preview in chat</p>
            <div className="bg-[#e5ddd5] rounded-control p-3">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <ImgFallback url={form.imageUrl} imgClass="w-full h-32 object-cover" boxClass="h-32 bg-slate-100 flex items-center justify-center text-slate-300" icon={<ImageIcon className="w-7 h-7" />} />
                <div className="p-2.5 space-y-0.5">
                  <p className="text-[13px] font-semibold text-slate-800 break-words">{form.name || "Product name"}</p>
                  <p className="text-[13px] font-bold text-slate-900">{form.currency || "INR"} {(Number(form.price) || 0).toFixed(2)}</p>
                  {form.description.trim() && <p className="text-[11px] text-slate-500 break-words line-clamp-2">{form.description}</p>}
                </div>
                <div className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600">{form.buttonText.trim() || "View"}</div>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-400 leading-snug">
              {form.buttonUrl.trim()
                ? <>Custom card: image + this button → <span className="font-mono break-all">{form.buttonUrl}</span>. Use the “Custom card” style on a flow’s Product node.</>
                : <>Native catalog card shows WhatsApp’s own “View” button. Add a button link above to send a custom card with your label instead.</>}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sales Pipeline (Kanban; stage-on-contact) ─────────────────────────────────

function useRevealOnOpen<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Only on the transition into open. Reacting to every render would drag
    // the page back to the top of the form on every keystroke.
    if (open && !wasOpen.current && ref.current) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      ref.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
    wasOpen.current = open;
  }, [open]);
  return ref;
}
