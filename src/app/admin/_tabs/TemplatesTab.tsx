"use client";

// WhatsApp message templates (builder + library) — extracted from admin/page.tsx,
// lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { Copy, FileText, GalleryHorizontalEnd, Loader2, MessageSquare, MousePointerClick, Phone, Plus, RefreshCw, Star, Trash2, UploadCloud, Video, Image as ImageIcon, Link2, X, Sparkles, Pencil } from "lucide-react";
import { inp, ChannelSelect } from "../_shared";
import { buildFestivalGreeting } from "@/lib/greetingtemplates";
import { useConfirm } from "@/components/confirm-dialog";
import { Drawer } from "@/components/overlay";
import { templatePlaceholders, paramCount, isNamedFormat, bodyVariableError } from "@/lib/template-params";

// ── Templates ─────────────────────────────────────────────────────────────────
type WaTplComponent = {
  type: string; format?: string; text?: string;
  // Meta's sample values: body_text: [["Asha", …]], body_text_named_params,
  // header_text: ["…"] — read back when a template is opened for editing.
  example?: { body_text?: string[][]; body_text_named_params?: { param_name: string; example: string }[]; header_text?: string[]; header_handle?: string[] };
  buttons?: { type: string; text?: string; url?: string; phone_number?: string; example?: unknown }[];
  cards?: { components?: WaTplComponent[] }[];
};
type WaTemplateRow = {
  id?: string; name: string; status: string; language: string; category: string;
  rejected_reason?: string | null;
  components?: WaTplComponent[];
};

type TplBtnType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";
// Meta lets a template be edited only in these states (whatsapp.ts EDITABLE_TEMPLATE_STATUSES).
const EDITABLE_TPL_STATUSES = ["APPROVED", "REJECTED", "PAUSED"];
type TplButton = { type: TplBtnType; text: string; url: string; phoneNumber: string; example: string };
type TplCard = { headerFormat: "IMAGE" | "VIDEO"; headerHandle: string; fileName: string; previewUrl: string; bodyText: string; buttons: TplButton[]; uploading: boolean };
type TplHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

const newTplButton = (type: TplBtnType = "QUICK_REPLY"): TplButton =>
  ({ type, text: type === "URL" ? "Visit website" : type === "PHONE_NUMBER" ? "Call us" : "", url: "", phoneNumber: "", example: "" });
const newTplCard = (): TplCard =>
  ({ headerFormat: "IMAGE", headerHandle: "", fileName: "", previewUrl: "", bodyText: "", buttons: [newTplButton("QUICK_REPLY")], uploading: false });

// A URL ending in {{1}} is a DYNAMIC button — the per-message suffix (an order
// id, a booking reference) is supplied at send time. Meta requires a sample
// value for one, and rejects the whole submission without it, so `example` has
// to travel with the button rather than being dropped here.
const isDynamicUrl = (b: TplButton) => b.type === "URL" && /\{\{\s*1\s*\}\}/.test(b.url);

function serializeTplButtons(btns: TplButton[]) {
  return btns.map(b =>
    b.type === "QUICK_REPLY" ? { type: b.type, text: b.text }
    : b.type === "URL" ? { type: b.type, text: b.text, url: b.url, ...(isDynamicUrl(b) ? { example: b.example } : {}) }
    : b.type === "PHONE_NUMBER" ? { type: b.type, text: b.text, phoneNumber: b.phoneNumber }
    : { type: b.type, example: b.example });
}

// Sample media goes to Meta's resumable upload API → header_handle for the submission.
async function uploadTplSample(file: File, channelId?: string | null): Promise<{ handle?: string; error?: string }> {
  const fd = new FormData(); fd.append("file", file);
  if (channelId) fd.append("channelId", channelId);
  try {
    const res = await fetch("/api/admin/templates/media", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { handle: d.handle } : { error: d.error || `HTTP ${res.status}` };
  } catch { return { error: "Could not reach the server" }; }
}

// Fills {{1}}, {{2}}… by number, or {{named}} ones in order of first use —
// the order their sample values are kept in.
const fillTplVars = (text: string, ex: string[]) => {
  const names = templatePlaceholders(text);
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, v: string) =>
    (/^\d+$/.test(v) ? ex[Number(v) - 1] : ex[names.indexOf(v)])?.trim() || m);
};

// A template's buttons and samples as Meta returns them, in the builder's shape.
const buttonsFromMeta = (bs: NonNullable<WaTplComponent["buttons"]>): TplButton[] => bs.map(b => ({
  ...newTplButton(b.type as TplBtnType), text: b.text ?? "", url: b.url ?? "", phoneNumber: b.phone_number ?? "",
  example: typeof b.example === "string" ? b.example : Array.isArray(b.example) ? String(b.example[0] ?? "") : "",
}));
const samplesFromMeta = (c: WaTplComponent | undefined): string[] =>
  c?.example?.body_text?.[0] ?? c?.example?.body_text_named_params?.map(p => p.example) ?? [];

function SamplePicker({ accept, fileName, uploading, previewUrl, hint, onFile }: {
  accept: string; fileName: string; uploading: boolean; previewUrl: string; hint: string; onFile: (f: File) => void;
}) {
  return (
    <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-dark/50 bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previewUrl ? <img src={previewUrl} alt="" className="w-10 h-10 rounded object-cover" /> : <UploadCloud className="w-5 h-5 text-slate-400 shrink-0" />}
      <span className="text-xs text-slate-500 flex-1 truncate">
        {uploading ? "Uploading sample to Meta…" : fileName ? `${fileName} — sample uploaded` : hint}
      </span>
      {uploading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />}
      <input type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

function TplButtonEditor({ btns, max, onChange }: { btns: TplButton[]; max: number; onChange: (b: TplButton[]) => void }) {
  const set = (i: number, patch: Partial<TplButton>) => onChange(btns.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {btns.map((b, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center">
          <select className={`${inp} w-32 shrink-0`} value={b.type} onChange={e => set(i, { ...newTplButton(e.target.value as TplBtnType) })}>
            <option value="QUICK_REPLY">Quick reply</option>
            <option value="URL">URL</option>
            <option value="PHONE_NUMBER">Phone</option>
            <option value="COPY_CODE">Copy code</option>
          </select>
          {b.type === "COPY_CODE"
            ? <input className={`${inp} flex-1`} placeholder="Example code, e.g. SAVE20" maxLength={15} value={b.example} onChange={e => set(i, { example: e.target.value })} />
            : <input className={`${inp} w-40 shrink-0`} placeholder="Button text" maxLength={25} value={b.text} onChange={e => set(i, { text: e.target.value })} />}
          {b.type === "URL" && <input className={`${inp} flex-1`} placeholder="https://example.com/track/{{1}}" value={b.url} onChange={e => set(i, { url: e.target.value })} />}
          {b.type === "PHONE_NUMBER" && <input className={`${inp} flex-1`} placeholder="+919876543210" value={b.phoneNumber} onChange={e => set(i, { phoneNumber: e.target.value })} />}
          <button onClick={() => onChange(btns.filter((_, j) => j !== i))} className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
          {/* Meta rejects a {{1}} URL button submitted without a sample value,
              so this input appears exactly when the URL becomes dynamic. */}
          {isDynamicUrl(b) && (
            <div className="basis-full pl-32 -mt-1">
              <input className={`${inp} w-full`} placeholder="Sample value for {{1}} — e.g. 404-0952515-9776314" value={b.example} onChange={e => set(i, { example: e.target.value })} />
              <p className="text-[11px] text-slate-400 mt-1">Per-message link. Meta needs one sample to approve it; the real value comes from your event data (set it under Broadcast → API broadcasting).</p>
            </div>
          )}
        </div>
      ))}
      {btns.length < max && (
        <button onClick={() => onChange([...btns, newTplButton()])} className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline">
          <Plus className="w-3.5 h-3.5" /> Add button
        </button>
      )}
    </div>
  );
}

// WhatsApp-style live preview of the template being built.
function TplPreview({ mode, headerType, headerText, headerExample, headerPreviewUrl, headerFileName, bodyText, footerText, examples, buttons, cards, label = "Live preview" }: {
  mode: "standard" | "carousel"; headerType: TplHeaderType; headerText: string; headerExample: string;
  headerPreviewUrl: string; headerFileName: string; bodyText: string; footerText: string; examples: string[];
  buttons: TplButton[]; cards: TplCard[]; label?: string;
}) {
  const btnRow = (b: TplButton, i: number) => (
    <div key={i} className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600 flex items-center justify-center gap-1">
      {b.type === "URL" && <Link2 className="w-3 h-3" />}{b.type === "PHONE_NUMBER" && <Phone className="w-3 h-3" />}{b.type === "COPY_CODE" && <Copy className="w-3 h-3" />}
      {b.type === "COPY_CODE" ? "Copy code" : b.text || "Button"}
    </div>
  );
  const mediaBox = (format: string, url: string, name: string) => (
    <div className="bg-slate-200 h-28 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {format === "IMAGE" && url ? <img src={url} alt="" className="w-full h-full object-cover" /> :
        <span className="text-slate-400 flex flex-col items-center gap-1 text-[10px]">
          {format === "VIDEO" ? <Video className="w-6 h-6" /> : format === "DOCUMENT" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
          {name || format.toLowerCase()}
        </span>}
    </div>
  );
  return (
    <div className="bg-[#e5ddd5] rounded-card p-4 sticky top-4">
      <p className="text-[10px] font-bold text-slate-600 uppercase mb-2">{label}</p>
      <div className="bg-white rounded-lg shadow-sm overflow-hidden max-w-[270px]">
        {mode === "standard" && headerType !== "NONE" && (
          headerType === "TEXT"
            ? <p className="px-3 pt-2 text-[13px] font-bold text-slate-800">{fillTplVars(headerText || "Header", [headerExample])}</p>
            : mediaBox(headerType, headerPreviewUrl, headerFileName)
        )}
        <p className="px-3 py-2 text-[13px] text-slate-800 whitespace-pre-wrap">{fillTplVars(bodyText, examples) || "Your message body appears here…"}</p>
        {footerText.trim() && <p className="px-3 pb-1.5 text-[11px] text-slate-400">{footerText}</p>}
        <p className="px-3 pb-1.5 text-right text-[10px] text-slate-300">10:30</p>
        {mode === "standard" && buttons.map(btnRow)}
      </div>
      {mode === "carousel" && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {cards.map((c, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden w-[170px] shrink-0">
              {mediaBox(c.headerFormat, c.previewUrl, c.fileName)}
              <p className="px-2 py-1.5 text-[11px] text-slate-800 min-h-[2rem]">{c.bodyText || `Card ${i + 1} text…`}</p>
              {c.buttons.map(btnRow)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const ask = useConfirm();
  const [templates, setTemplates] = useState<WaTemplateRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<"standard" | "carousel">("standard");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [headerType, setHeaderType] = useState<TplHeaderType>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [headerHandle, setHeaderHandle] = useState("");
  const [headerFileName, setHeaderFileName] = useState("");
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState("");
  const [headerUploading, setHeaderUploading] = useState(false);
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [examples, setExamples] = useState("");
  const [buttons, setButtons] = useState<TplButton[]>([]);
  const [clickTracking, setClickTracking] = useState(false);
  const [cards, setCards] = useState<TplCard[]>([newTplCard(), newTplCard()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<"ALL" | "PENDING" | "APPROVED" | "ACTION">("ALL");
  const [favs, setFavs] = useState<string[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);   // which number's WABA
  const [festivals, setFestivals] = useState<{ date: string; name: string; daysAway: number }[]>([]);
  // The template being edited in place; null while building a new one.
  const [editing, setEditing] = useState<WaTemplateRow | null>(null);
  // The template open in the read-only viewer.
  const [viewing, setViewing] = useState<WaTemplateRow | null>(null);
  // What the last submit did, said on the page once the panel has closed.
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("wa_tpl_favs") || "[]")); } catch { /* fresh */ } }, []);
  // Upcoming festivals (non-PII) → one-click greeting-template drafts.
  useEffect(() => { fetch("/api/admin/holidays?days=120").then(r => r.json()).then(d => setFestivals(d.holidays ?? [])).catch(() => {}); }, []);

  // Draft a festival greeting template — prefill the builder (the tenant edits +
  // submits for approval), then they schedule the broadcast for that day.
  function prefillFestival(festival: string) {
    const g = buildFestivalGreeting(festival);
    setMode("standard");
    setName(g.nameSlug); setLanguage("en_US"); setCategory(g.category);
    setHeaderType("NONE"); setHeaderText(""); setHeaderExample(""); setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
    setBodyText(g.body); setFooterText(g.footer); setExamples(g.example);
    setButtons([]); setCards([newTplCard(), newTplCard()]);
    setEditing(null);
    setMsg(`Festival greeting drafted for "${festival}" — edit the copy, then Submit for approval.`);
    setShowBuilder(true);
  }
  const toggleFav = (n: string) => setFavs(f => {
    const next = f.includes(n) ? f.filter(x => x !== n) : [...f, n];
    localStorage.setItem("wa_tpl_favs", JSON.stringify(next));
    return next;
  });

  // Prefill the builder from an existing template (media samples must be re-uploaded).
  // As a copy it gets a new name; to edit, it keeps its own and its samples.
  function copyTemplate(t: WaTemplateRow, asEdit = false) {
    const comps = t.components ?? [];
    setName(asEdit ? t.name : `${t.name}_copy`); setLanguage(t.language);
    setCategory(t.category === "UTILITY" ? "UTILITY" : "MARKETING");
    setEditing(asEdit ? t : null);
    const body = comps.find(c => c.type === "BODY");
    setBodyText(body?.text ?? "");
    setFooterText(comps.find(c => c.type === "FOOTER")?.text ?? "");
    setExamples(asEdit ? samplesFromMeta(body).join("\n") : "");
    const carousel = comps.find(c => c.type === "CAROUSEL");
    if (carousel?.cards?.length) {
      setMode("carousel");
      setCards(carousel.cards.map(card => {
        const cc = card.components ?? [];
        return { ...newTplCard(),
          headerFormat: (cc.find(x => x.type === "HEADER")?.format === "VIDEO" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO",
          bodyText: cc.find(x => x.type === "BODY")?.text ?? "",
          buttons: buttonsFromMeta(cc.find(x => x.type === "BUTTONS")?.buttons ?? []),
        };
      }));
    } else {
      setMode("standard");
      const h = comps.find(c => c.type === "HEADER");
      setHeaderType((h?.format as TplHeaderType) ?? "NONE");
      setHeaderText(h?.format === "TEXT" ? h.text ?? "" : "");
      setHeaderExample(asEdit ? h?.example?.header_text?.[0] ?? "" : "");
      setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
      setButtons(buttonsFromMeta(comps.find(c => c.type === "BUTTONS")?.buttons ?? []));
      setCards([newTplCard(), newTplCard()]);
    }
    setClickTracking(false);
    const media = comps.some(c => c.type === "CAROUSEL" || (c.type === "HEADER" && c.format && c.format !== "TEXT"));
    setMsg(asEdit
      ? `Editing "${t.name}".${media ? " Upload the media sample again before submitting." : ""}`
      : `Copied "${t.name}" — media samples need a fresh upload before submitting.`);
    setShowBuilder(true);
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetch(`/api/admin/templates${channelId ? `?channelId=${channelId}` : ""}`).then(r => r.json());
      setTemplates(d.templates ?? []); setNotice(d.notice ?? null);
    } catch { /* keep last list */ }
    setRefreshing(false);
  }, [channelId]);
  useEffect(() => { load(); }, [load]);

  async function pickHeaderFile(f: File) {
    setHeaderUploading(true); setMsg(null);
    const preview = headerType === "IMAGE" ? URL.createObjectURL(f) : "";
    const r = await uploadTplSample(f, channelId);
    setHeaderUploading(false);
    if (r.error || !r.handle) { setMsg(r.error ?? "Upload failed"); return; }
    setHeaderHandle(r.handle); setHeaderFileName(f.name); setHeaderPreviewUrl(preview);
  }

  async function pickCardFile(i: number, f: File) {
    setMsg(null);
    setCards(cs => cs.map((c, j) => (j === i ? { ...c, uploading: true } : c)));
    const preview = cards[i].headerFormat === "IMAGE" ? URL.createObjectURL(f) : "";
    const r = await uploadTplSample(f, channelId);
    setCards(cs => cs.map((c, j) => (j === i
      ? { ...c, uploading: false, ...(r.handle ? { headerHandle: r.handle, fileName: f.name, previewUrl: preview } : {}) }
      : c)));
    if (r.error) setMsg(r.error);
  }

  const setCard = (i: number, patch: Partial<TplCard>) => setCards(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const exampleList = examples.split(/\r?\n/).map(v => v.trim()).filter(Boolean);

  // Back to an empty "new template" form.
  function resetBuilder() {
    setEditing(null); setName(""); setLanguage("en_US"); setCategory("MARKETING"); setMode("standard");
    setBodyText(""); setFooterText(""); setExamples(""); setButtons([]); setClickTracking(false);
    setHeaderType("NONE"); setHeaderText(""); setHeaderExample(""); setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
    setCards([newTplCard(), newTplCard()]);
  }
  function openNewBuilder() { resetBuilder(); setMsg(null); setShowBuilder(true); }
  function closeBuilder() { setShowBuilder(false); resetBuilder(); setMsg(null); }

  async function create() {
    setMsg(null);
    if (!name.trim() || !bodyText.trim()) { setMsg("Name and body are required."); return; }
    const varError = bodyVariableError(bodyText);
    if (varError) { setMsg(varError); return; }
    const bodyVarCount = paramCount(templatePlaceholders(bodyText));
    if (bodyVarCount > 0 && exampleList.length < bodyVarCount) { setMsg(`Body has ${bodyVarCount} variable${bodyVarCount === 1 ? "" : "s"} — provide ${bodyVarCount} sample value${bodyVarCount === 1 ? "" : "s"}, one per line.`); return; }
    const payload: Record<string, unknown> = {
      name: name.trim(), language: language.trim() || "en_US", category,
      bodyText, footerText: footerText.trim() || undefined, exampleValues: exampleList,
      channelId,
    };
    if (mode === "carousel") {
      if (cards.length < 2) { setMsg("A carousel needs at least 2 cards."); return; }
      for (const [i, c] of cards.entries()) {
        if (!c.headerHandle) { setMsg(`Card ${i + 1}: upload its ${c.headerFormat.toLowerCase()} first.`); return; }
        if (!c.bodyText.trim()) { setMsg(`Card ${i + 1}: body text is required.`); return; }
        if (c.buttons.some(b => b.type !== "COPY_CODE" && !b.text.trim())) { setMsg(`Card ${i + 1}: every button needs text.`); return; }
      }
      payload.carouselCards = cards.map(c => ({ headerFormat: c.headerFormat, headerHandle: c.headerHandle, bodyText: c.bodyText, buttons: serializeTplButtons(c.buttons) }));
    } else {
      payload.headerType = headerType;
      if (headerType === "TEXT") {
        if (!headerText.trim()) { setMsg("Header text is required for a text header."); return; }
        payload.headerText = headerText; payload.headerExample = headerExample;
      }
      if (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") {
        if (!headerHandle) { setMsg(`Upload a sample ${headerType.toLowerCase()} for the header first.`); return; }
        payload.headerHandle = headerHandle;
      }
      if (buttons.some(b => b.type !== "COPY_CODE" && !b.text.trim())) { setMsg("Every button needs text."); return; }
      if (buttons.some(b => b.type === "URL" && !b.url.trim())) { setMsg("URL buttons need a link."); return; }
      if (buttons.length) payload.buttons = serializeTplButtons(buttons);
      if (clickTracking && !editing && buttons.some(b => b.type === "URL")) payload.clickTracking = true;
    }

    // An edit replaces the live template, so say exactly what that costs.
    if (editing) {
      const before = paramCount(templatePlaceholders(editing.components?.find(c => c.type === "BODY")?.text));
      const facts = [
        { label: "Template", value: `${editing.name} · ${editing.language}` },
        { label: "Status now", value: editing.status },
        ...(editing.status === "APPROVED" ? [{ label: "Edit limit", value: "1 a day, 10 in 30 days" }] : []),
        ...(before !== bodyVarCount ? [{ label: "Variables", value: `${before} → ${bodyVarCount} — every broadcast, flow or rule that fills them must change too` }] : []),
      ];
      const ok = await ask({
        title: "Send these changes to Meta?",
        message: "Meta replaces the whole template with this version and reviews it again, usually within minutes. Until it is approved again, sends that use it may be refused.",
        facts, tone: "caution", confirmLabel: "Submit changes",
      });
      if (!ok) return;
      payload.id = editing.id;
      delete payload.name; delete payload.language;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/templates", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Failed to submit");
      else {
        // The panel closes and the outcome is said on the page, where the
        // template now appears in the list.
        setFlash(editing
          ? `Changes sent — Meta is re-reviewing "${editing.name}" (usually minutes). Hit Sync Status to check.`
          : `Submitted "${name.trim()}" — status ${d.status}. Meta approval usually takes minutes to a few hours; hit Sync Status to check.`);
        closeBuilder();
        load();
      }
    } finally { setBusy(false); }
  }

  async function remove(n: string) {
    if (!(await ask({
      title: "Delete this template?", tone: "danger", confirmLabel: "Delete template",
      message: "Every language variant goes with it, and any broadcast or flow still pointing at this name will start failing.",
      facts: [{ label: "Template", value: n }],
    }))) return;
    await fetch("/api/admin/templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, channelId }) });
    load();
  }

  const ACTIONABLE = ["REJECTED", "PAUSED", "DISABLED", "IN_APPEAL"];

  const tplType = (t: WaTemplateRow) => {
    const comps = t.components ?? [];
    if (comps.some(c => c.type === "CAROUSEL")) return "Carousel";
    const h = comps.find(c => c.type === "HEADER");
    if (h?.format && h.format !== "TEXT") return h.format.charAt(0) + h.format.slice(1).toLowerCase();
    return "Text";
  };

  const visibleTemplates = templates
    .filter(t => statusTab === "ALL" ? true : statusTab === "ACTION" ? ACTIONABLE.includes(t.status) : t.status === statusTab)
    .filter(t => {
      const q = query.trim().toLowerCase();
      return !q || t.name.includes(q) || t.status.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || tplType(t).toLowerCase().includes(q);
    })
    .sort((a, b) => Number(favs.includes(b.name)) - Number(favs.includes(a.name)));

  const segBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold ${active ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">Template Messages</h2>
          <p className="text-sm text-slate-500">Build templates per Meta&apos;s guidelines — text, media headers, buttons, or carousels. Only APPROVED templates can be broadcast.</p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <ChannelSelect value={channelId} onChange={setChannelId} allLabel="Number: default" className={`${inp} !py-2 text-xs`} />
          <button onClick={load} disabled={refreshing} className="px-4 py-2 rounded-lg border border-brand-dark text-brand-dark text-sm font-bold flex items-center gap-2 disabled:opacity-60 hover:bg-brand-600/5">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Sync Status
          </button>
          <button onClick={openNewBuilder} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2">
            <Plus className="w-4 h-4" /> New template
          </button>
        </div>
      </div>

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{notice}</div>}
      {flash && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 text-sm text-brand-700 flex items-start justify-between gap-3">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} aria-label="Dismiss" className="text-brand-700/60 hover:text-brand-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {festivals.length > 0 && (
        <div className="bg-white rounded-card border border-line p-4 space-y-2">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-500" /> Festival greetings — draft a template in one tap</p>
          <div className="flex flex-wrap gap-1.5">
            {festivals.slice(0, 6).map(h => (
              <button key={h.date + h.name} onClick={() => prefillFestival(h.name)} className="px-2.5 py-1 rounded-full border border-line bg-canvas hover:border-brand-600 hover:bg-brand-50 text-[11px] font-semibold text-ink-700">
                {h.name} · {new Date(`${h.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{h.daysAway <= 14 ? ` · in ${h.daysAway}d` : ""}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-400">Drafts a ready-to-edit greeting; submit it for approval, then schedule the broadcast for that day in Broadcast.</p>
        </div>
      )}

      <Drawer open={showBuilder} onClose={closeBuilder} width="xl"
        title={editing ? `Edit ${editing.name}` : "New template"}
        subtitle={editing
          ? `${editing.status.toLowerCase()} · name and language can't change${editing.status === "APPROVED" ? ", nor the category" : ""}. Meta reviews the edit again.`
          : "Build it, check the preview on the right, then submit it to Meta for approval."}
        footer={<>
          <button onClick={create} disabled={busy} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editing ? "Submit changes to Meta" : "Submit to Meta for approval"}
          </button>
          <button onClick={closeBuilder} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
          {msg && <span className="text-xs text-amber-700 font-semibold min-w-0">{msg}</span>}
        </>}>
      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <section className="space-y-4">
          <div className="flex items-center justify-end">
            <div className="flex gap-1.5">
              <button className={segBtn(mode === "standard")} disabled={!!editing} onClick={() => setMode("standard")}><MessageSquare className="w-3.5 h-3.5 inline mr-1" />Standard</button>
              <button className={segBtn(mode === "carousel")} disabled={!!editing} onClick={() => setMode("carousel")}><GalleryHorizontalEnd className="w-3.5 h-3.5 inline mr-1" />Carousel</button>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_7rem_8rem] gap-2">
            <input className={`${inp} disabled:bg-slate-50 disabled:text-slate-500`} disabled={!!editing} placeholder="name (lowercase_underscores)" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
            <input className={`${inp} disabled:bg-slate-50 disabled:text-slate-500`} disabled={!!editing} placeholder="en_US" value={language} onChange={e => setLanguage(e.target.value)} />
            <select className={`${inp} disabled:bg-slate-50 disabled:text-slate-500`} disabled={editing?.status === "APPROVED"} value={category} onChange={e => setCategory(e.target.value as "MARKETING" | "UTILITY")}>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
            </select>
          </div>

          {mode === "standard" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Header</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as TplHeaderType[]).map(h => (
                  <button key={h} className={segBtn(headerType === h)} onClick={() => { setHeaderType(h); setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl(""); }}>
                    {h === "NONE" ? "None" : h === "TEXT" ? "Text" : h === "IMAGE" ? <><ImageIcon className="w-3.5 h-3.5 inline mr-1" />Image</> : h === "VIDEO" ? <><Video className="w-3.5 h-3.5 inline mr-1" />Video</> : <><FileText className="w-3.5 h-3.5 inline mr-1" />Document</>}
                  </button>
                ))}
              </div>
              {headerType === "TEXT" && (
                <div className="grid grid-cols-2 gap-2">
                  <input className={inp} placeholder="Header text (60 chars, may use {{1}})" maxLength={60} value={headerText} onChange={e => setHeaderText(e.target.value)} />
                  {/\{\{1\}\}/.test(headerText) && <input className={inp} placeholder="Example for {{1}}" value={headerExample} onChange={e => setHeaderExample(e.target.value)} />}
                </div>
              )}
              {(headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") && (
                <SamplePicker
                  accept={headerType === "IMAGE" ? "image/jpeg,image/png" : headerType === "VIDEO" ? "video/mp4" : "application/pdf"}
                  fileName={headerFileName} uploading={headerUploading} previewUrl={headerPreviewUrl}
                  hint={`Upload a sample ${headerType.toLowerCase()} (${headerType === "IMAGE" ? "JPEG/PNG" : headerType === "VIDEO" ? "MP4" : "PDF"}) — reviewers see this; the actual media is chosen when you broadcast`}
                  onFile={pickHeaderFile}
                />
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-400 uppercase">{mode === "carousel" ? "Message bubble (shown above the cards)" : "Message body"}</p>
              <p className="text-[11px] text-slate-500">The main text your customer reads. Put <span className="font-mono text-slate-600">{"{{1}}"}</span>, <span className="font-mono text-slate-600">{"{{2}}"}</span> where you want fill-in-the-blanks (like a name or date) that you set each time you send.</p>
              <textarea className={`${inp} w-full`} rows={4} maxLength={1024} placeholder={"e.g. Hi {{1}}, your {{2}} class starts tomorrow at 7 PM — see you there!"} value={bodyText} onChange={e => setBodyText(e.target.value)} />
            </div>
            {templatePlaceholders(bodyText).length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-600">Sample values <span className="font-normal text-slate-400">— one per line, in order ({isNamedFormat(templatePlaceholders(bodyText)) ? templatePlaceholders(bodyText).join(", ") : "{{1}} first"}). Meta reviews these; your customers never see them.</span></p>
                <textarea className={`${inp} w-full font-mono`} rows={2} placeholder={"Asha\ntomorrow 7 PM"} value={examples} onChange={e => setExamples(e.target.value)} />
              </div>
            )}
            {mode === "standard" && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-600">Footer <span className="font-normal text-slate-400">(optional)</span></p>
                <p className="text-[11px] text-slate-500">A small grey line under the message — usually a sign-off or an opt-out note.</p>
                <input className={`${inp} w-full`} placeholder="e.g. Team YourBrand · Reply STOP to opt out" maxLength={60} value={footerText} onChange={e => setFooterText(e.target.value)} />
              </div>
            )}
          </div>

          {mode === "standard" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Buttons <span className="font-normal normal-case">(up to 10 — max 2 URL, 1 phone)</span></p>
              <TplButtonEditor btns={buttons} max={10} onChange={setButtons} />
              {!editing && buttons.some(b => b.type === "URL") && (
                <div className="flex items-start gap-3 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2.5">
                  <label className="flex items-center gap-2 shrink-0 cursor-pointer pt-0.5">
                    <input type="checkbox" checked={clickTracking} onChange={e => setClickTracking(e.target.checked)} className="accent-brand-700" />
                    <span className="text-xs font-bold text-brand-700 flex items-center gap-1"><MousePointerClick className="w-3.5 h-3.5" />Enable Click Tracking</span>
                  </label>
                  <p className="text-[11px] text-brand-700">
                    To track clicks we send users a link of the format {(process.env.NEXT_PUBLIC_SITE_URL || "https://your-domain").replace(/\/$/, "")}/r/xxxx which redirects to your URL on click. Click stats show on the campaign dashboard.
                  </p>
                </div>
              )}
            </div>
          )}

          {mode === "carousel" && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase">Cards ({cards.length}/10) <span className="font-normal normal-case">— Meta requires every card to have the same structure</span></p>
              {cards.map((c, i) => (
                <div key={i} className="border border-line rounded-lg p-3 space-y-2 bg-slate-50/60">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500">Card {i + 1}</p>
                    <div className="flex items-center gap-2">
                      <select className={`${inp} text-xs py-1`} value={c.headerFormat} onChange={e => setCard(i, { headerFormat: e.target.value as "IMAGE" | "VIDEO", headerHandle: "", fileName: "", previewUrl: "" })}>
                        <option value="IMAGE">Image</option>
                        <option value="VIDEO">Video</option>
                      </select>
                      {cards.length > 2 && <button onClick={() => setCards(cs => cs.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600"><X className="w-4 h-4" /></button>}
                    </div>
                  </div>
                  <SamplePicker
                    accept={c.headerFormat === "IMAGE" ? "image/jpeg,image/png" : "video/mp4"}
                    fileName={c.fileName} uploading={c.uploading} previewUrl={c.previewUrl}
                    hint={`Upload card ${c.headerFormat.toLowerCase()} (${c.headerFormat === "IMAGE" ? "JPEG/PNG" : "MP4"})`}
                    onFile={f => pickCardFile(i, f)}
                  />
                  <input className={`${inp} w-full`} placeholder="Card text (160 chars)" maxLength={160} value={c.bodyText} onChange={e => setCard(i, { bodyText: e.target.value })} />
                  <TplButtonEditor btns={c.buttons} max={2} onChange={b => setCard(i, { buttons: b })} />
                </div>
              ))}
              {cards.length < 10 && (
                <button onClick={() => setCards(cs => [...cs, newTplCard()])} className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Add card
                </button>
              )}
            </div>
          )}

        </section>

        <TplPreview
          mode={mode} headerType={headerType} headerText={headerText} headerExample={headerExample}
          headerPreviewUrl={headerPreviewUrl} headerFileName={headerFileName}
          bodyText={bodyText} footerText={footerText} examples={exampleList} buttons={buttons} cards={cards}
        />
      </div>
      </Drawer>

      <div className="bg-white rounded-card border border-line overflow-hidden">
        <div className="px-4 pt-4 space-y-3">
          <input className={`${inp} w-full max-w-sm`} placeholder="Search templates (status, name etc.)" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="flex gap-6 text-sm font-semibold border-b border-slate-100">
            {([["ALL", "All"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["ACTION", "Action Required"]] as const).map(([k, label]) => {
              const count = k === "ALL" ? templates.length
                : k === "ACTION" ? templates.filter(t => ACTIONABLE.includes(t.status)).length
                : templates.filter(t => t.status === k).length;
              return (
                <button key={k} onClick={() => setStatusTab(k)}
                  className={`pb-2 -mb-px border-b-2 flex items-center gap-1.5 ${statusTab === k ? "border-brand-dark text-brand-dark" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                  {label}<span className="text-[10px] bg-slate-100 rounded-full px-1.5 py-0.5 font-bold">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {visibleTemplates.map(t => (
            <div key={`${t.name}-${t.language}`} onClick={() => setViewing(t)} title="View template"
              className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50 cursor-pointer">
              <div className="w-52 min-w-0 shrink-0">
                <p className="font-mono text-xs font-semibold text-brand-dark truncate hover:underline">{t.name}</p>
                {t.status === "REJECTED" && t.rejected_reason && <p className="text-[11px] text-red-500 truncate">Rejected: {t.rejected_reason.replaceAll("_", " ").toLowerCase()}</p>}
              </div>
              <span className="w-24 shrink-0 text-[11px] font-bold text-slate-400 uppercase">{t.category}</span>
              <span className={`w-24 shrink-0 text-[11px] font-bold ${t.status === "APPROVED" ? "text-brand-600" : ACTIONABLE.includes(t.status) ? "text-red-500" : "text-amber-500"}`}>{t.status}</span>
              <span className="w-20 shrink-0 text-[11px] font-bold text-slate-500 uppercase">{tplType(t)}</span>
              <span className="w-16 shrink-0 text-[11px] text-slate-400">{t.language}</span>
              <div className="flex-1" />
              <div className="flex items-center" onClick={e => e.stopPropagation()}>
              <button onClick={() => toggleFav(t.name)} title="Favourite" className={`p-1.5 rounded-lg hover:bg-slate-100 ${favs.includes(t.name) ? "text-amber-400" : "text-slate-300 hover:text-slate-500"}`}>
                <Star className="w-4 h-4" fill={favs.includes(t.name) ? "currentColor" : "none"} />
              </button>
              {t.id && EDITABLE_TPL_STATUSES.includes(t.status) && (
                <button onClick={() => copyTemplate(t, true)} title="Edit this template" className="p-1.5 text-slate-400 hover:text-brand-dark hover:bg-slate-100 rounded-lg"><Pencil className="w-4 h-4" /></button>
              )}
              <button onClick={() => copyTemplate(t)} title="Duplicate into builder" className="p-1.5 text-slate-400 hover:text-brand-dark hover:bg-slate-100 rounded-lg"><Copy className="w-4 h-4" /></button>
              <button onClick={() => remove(t.name)} title="Delete" className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {visibleTemplates.length === 0 && (
            <p className="px-4 py-8 text-center text-slate-400 text-sm">
              {templates.length === 0 ? "No templates yet — hit + New template to build your first one." : "Nothing matches this filter."}
            </p>
          )}
        </div>
      </div>

      {viewing && (
        <TemplateViewer t={viewing} type={tplType(viewing)} onClose={() => setViewing(null)}
          onEdit={EDITABLE_TPL_STATUSES.includes(viewing.status) && viewing.id ? () => { copyTemplate(viewing, true); setViewing(null); } : undefined}
          onCopy={() => { copyTemplate(viewing); setViewing(null); }} />
      )}
    </div>
  );
}

// Read-only view of one template: how it looks in WhatsApp, and the details
// the list row has no room for — variables with their samples, where each
// button goes, why Meta rejected it.
function TemplateViewer({ t, type, onClose, onEdit, onCopy }: {
  t: WaTemplateRow; type: string; onClose: () => void; onEdit?: () => void; onCopy: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const comps = t.components ?? [];
  const body = comps.find(c => c.type === "BODY");
  const header = comps.find(c => c.type === "HEADER");
  const carousel = comps.find(c => c.type === "CAROUSEL");
  const buttons = buttonsFromMeta(comps.find(c => c.type === "BUTTONS")?.buttons ?? []);
  const samples = samplesFromMeta(body);
  const tokens = templatePlaceholders(body?.text);
  const cards: TplCard[] = (carousel?.cards ?? []).map(card => {
    const cc = card.components ?? [];
    const h = cc.find(x => x.type === "HEADER");
    return { ...newTplCard(),
      headerFormat: h?.format === "VIDEO" ? "VIDEO" : "IMAGE",
      previewUrl: h?.example?.header_handle?.[0] ?? "",
      bodyText: cc.find(x => x.type === "BODY")?.text ?? "",
      buttons: buttonsFromMeta(cc.find(x => x.type === "BUTTONS")?.buttons ?? []),
    };
  });
  const status = t.status === "APPROVED" ? "bg-brand-50 text-brand-700 border-brand-200"
    : ["REJECTED", "PAUSED", "DISABLED", "IN_APPEAL"].includes(t.status) ? "bg-red-50 text-red-600 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  const chip = "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border";
  const sectionTitle = "text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]";

  return (
    <>
      <div className="fixed inset-0 bg-ink-950/20 z-40" onClick={onClose} />
      <aside role="dialog" aria-label={`Template ${t.name}`} className="fixed inset-y-0 right-0 w-[440px] max-w-full bg-white border-l border-line shadow-2xl z-50 overflow-y-auto">
        <div className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="font-mono text-sm font-bold text-brand-dark break-all">{t.name}</p>
              <div className="flex flex-wrap gap-1.5">
                <span className={`${chip} ${status}`}>{t.status.toLowerCase()}</span>
                <span className={`${chip} border-line text-slate-500`}>{t.category.toLowerCase()}</span>
                <span className={`${chip} border-line text-slate-500`}>{type}</span>
                <span className={`${chip} border-line text-slate-500 normal-case`}>{t.language}</span>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>

          {t.status === "REJECTED" && t.rejected_reason && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">
              Rejected by Meta: {t.rejected_reason.replaceAll("_", " ").toLowerCase()}
            </p>
          )}

          <TplPreview label="Preview"
            mode={carousel ? "carousel" : "standard"}
            headerType={(header?.format as TplHeaderType) ?? "NONE"} headerText={header?.format === "TEXT" ? header.text ?? "" : ""}
            headerExample={header?.example?.header_text?.[0] ?? ""}
            headerPreviewUrl={header?.example?.header_handle?.[0] ?? ""} headerFileName=""
            bodyText={body?.text ?? ""} footerText={comps.find(c => c.type === "FOOTER")?.text ?? ""}
            examples={samples} buttons={buttons} cards={cards} />

          {tokens.length > 0 && (
            <div className="space-y-1.5">
              <p className={sectionTitle}>Variables</p>
              {tokens.map((v, i) => (
                <div key={v} className="flex items-baseline gap-2 text-xs">
                  <span className="font-mono font-semibold text-brand-dark shrink-0">{`{{${v}}}`}</span>
                  <span className="text-slate-400">sample:</span>
                  <span className="text-slate-600 break-words">{samples[/^\d+$/.test(v) ? Number(v) - 1 : i] || "—"}</span>
                </div>
              ))}
            </div>
          )}

          {buttons.length > 0 && (
            <div className="space-y-1.5">
              <p className={sectionTitle}>Buttons</p>
              {buttons.map((b, i) => (
                <div key={i} className="text-xs flex items-baseline gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase w-20 shrink-0">{b.type === "QUICK_REPLY" ? "Quick reply" : b.type === "URL" ? "Link" : b.type === "PHONE_NUMBER" ? "Call" : "Copy code"}</span>
                  <span className="font-semibold text-slate-700 shrink-0">{b.type === "COPY_CODE" ? "Copy code" : b.text}</span>
                  {(b.type === "URL" || b.type === "PHONE_NUMBER") && <span className="text-slate-400 break-all">{b.type === "URL" ? b.url : b.phoneNumber}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {onEdit && (
              <button onClick={onEdit} className="px-3 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Edit</button>
            )}
            <button onClick={onCopy} className="px-3 py-2 rounded-lg border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
            {t.id && <span className="ml-auto text-[10px] text-slate-400 font-mono">ID {t.id}</span>}
          </div>
        </div>
      </aside>
    </>
  );
}


export default TemplatesTab;
