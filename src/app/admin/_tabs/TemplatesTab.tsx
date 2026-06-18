"use client";

// WhatsApp message templates (builder + library) — extracted from admin/page.tsx,
// lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { Copy, FileText, GalleryHorizontalEnd, Loader2, MessageSquare, MousePointerClick, Phone, Plus, RefreshCw, Star, Trash2, UploadCloud, Video, Image as ImageIcon, Link2, X } from "lucide-react";
import { inp, ChannelSelect } from "../_shared";

// ── Templates ─────────────────────────────────────────────────────────────────
type WaTplComponent = {
  type: string; format?: string; text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string; example?: unknown }[];
  cards?: { components?: WaTplComponent[] }[];
};
type WaTemplateRow = {
  id?: string; name: string; status: string; language: string; category: string;
  rejected_reason?: string | null;
  components?: WaTplComponent[];
};

type TplBtnType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";
type TplButton = { type: TplBtnType; text: string; url: string; phoneNumber: string; example: string };
type TplCard = { headerFormat: "IMAGE" | "VIDEO"; headerHandle: string; fileName: string; previewUrl: string; bodyText: string; buttons: TplButton[]; uploading: boolean };
type TplHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

const newTplButton = (type: TplBtnType = "QUICK_REPLY"): TplButton =>
  ({ type, text: type === "URL" ? "Visit website" : type === "PHONE_NUMBER" ? "Call us" : "", url: "", phoneNumber: "", example: "" });
const newTplCard = (): TplCard =>
  ({ headerFormat: "IMAGE", headerHandle: "", fileName: "", previewUrl: "", bodyText: "", buttons: [newTplButton("QUICK_REPLY")], uploading: false });

function serializeTplButtons(btns: TplButton[]) {
  return btns.map(b =>
    b.type === "QUICK_REPLY" ? { type: b.type, text: b.text }
    : b.type === "URL" ? { type: b.type, text: b.text, url: b.url }
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

const fillTplVars = (text: string, ex: string[]) =>
  text.replace(/\{\{(\d+)\}\}/g, (_m, n) => ex[Number(n) - 1]?.trim() || `{{${n}}}`);

function SamplePicker({ accept, fileName, uploading, previewUrl, hint, onFile }: {
  accept: string; fileName: string; uploading: boolean; previewUrl: string; hint: string; onFile: (f: File) => void;
}) {
  return (
    <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-dark/50 bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previewUrl ? <img src={previewUrl} alt="" className="w-10 h-10 rounded object-cover" /> : <UploadCloud className="w-5 h-5 text-slate-400 shrink-0" />}
      <span className="text-xs text-slate-500 flex-1 truncate">
        {uploading ? "Uploading sample to Meta…" : fileName ? `✓ ${fileName} — sample uploaded` : hint}
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
        <div key={i} className="flex gap-2 items-center">
          <select className={`${inp} w-32 shrink-0`} value={b.type} onChange={e => set(i, { ...newTplButton(e.target.value as TplBtnType) })}>
            <option value="QUICK_REPLY">Quick reply</option>
            <option value="URL">URL</option>
            <option value="PHONE_NUMBER">Phone</option>
            <option value="COPY_CODE">Copy code</option>
          </select>
          {b.type === "COPY_CODE"
            ? <input className={`${inp} flex-1`} placeholder="Example code, e.g. SAVE20" maxLength={15} value={b.example} onChange={e => set(i, { example: e.target.value })} />
            : <input className={`${inp} w-40 shrink-0`} placeholder="Button text" maxLength={25} value={b.text} onChange={e => set(i, { text: e.target.value })} />}
          {b.type === "URL" && <input className={`${inp} flex-1`} placeholder="https://example.com" value={b.url} onChange={e => set(i, { url: e.target.value })} />}
          {b.type === "PHONE_NUMBER" && <input className={`${inp} flex-1`} placeholder="+919876543210" value={b.phoneNumber} onChange={e => set(i, { phoneNumber: e.target.value })} />}
          <button onClick={() => onChange(btns.filter((_, j) => j !== i))} className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
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
function TplPreview({ mode, headerType, headerText, headerExample, headerPreviewUrl, headerFileName, bodyText, footerText, examples, buttons, cards }: {
  mode: "standard" | "carousel"; headerType: TplHeaderType; headerText: string; headerExample: string;
  headerPreviewUrl: string; headerFileName: string; bodyText: string; footerText: string; examples: string[];
  buttons: TplButton[]; cards: TplCard[];
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
      <p className="text-[10px] font-bold text-slate-600 uppercase mb-2">Live preview</p>
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

  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("wa_tpl_favs") || "[]")); } catch { /* fresh */ } }, []);
  const toggleFav = (n: string) => setFavs(f => {
    const next = f.includes(n) ? f.filter(x => x !== n) : [...f, n];
    localStorage.setItem("wa_tpl_favs", JSON.stringify(next));
    return next;
  });

  // Prefill the builder from an existing template (media samples must be re-uploaded).
  function copyTemplate(t: WaTemplateRow) {
    const comps = t.components ?? [];
    const fromMetaButtons = (bs: NonNullable<WaTplComponent["buttons"]>): TplButton[] => bs.map(b => ({
      ...newTplButton(b.type as TplBtnType), text: b.text ?? "", url: b.url ?? "", phoneNumber: b.phone_number ?? "",
      example: typeof b.example === "string" ? b.example : Array.isArray(b.example) ? String(b.example[0] ?? "") : "",
    }));
    setName(`${t.name}_copy`); setLanguage(t.language);
    setCategory(t.category === "UTILITY" ? "UTILITY" : "MARKETING");
    const body = comps.find(c => c.type === "BODY");
    setBodyText(body?.text ?? "");
    setFooterText(comps.find(c => c.type === "FOOTER")?.text ?? "");
    setExamples("");
    const carousel = comps.find(c => c.type === "CAROUSEL");
    if (carousel?.cards?.length) {
      setMode("carousel");
      setCards(carousel.cards.map(card => {
        const cc = card.components ?? [];
        return { ...newTplCard(),
          headerFormat: (cc.find(x => x.type === "HEADER")?.format === "VIDEO" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO",
          bodyText: cc.find(x => x.type === "BODY")?.text ?? "",
          buttons: fromMetaButtons(cc.find(x => x.type === "BUTTONS")?.buttons ?? []),
        };
      }));
    } else {
      setMode("standard");
      const h = comps.find(c => c.type === "HEADER");
      setHeaderType((h?.format as TplHeaderType) ?? "NONE");
      setHeaderText(h?.format === "TEXT" ? h.text ?? "" : "");
      setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
      setButtons(fromMetaButtons(comps.find(c => c.type === "BUTTONS")?.buttons ?? []));
      setCards([newTplCard(), newTplCard()]);
    }
    setMsg(`Copied "${t.name}" — media samples need a fresh upload before submitting.`);
    setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  async function create() {
    setMsg(null);
    if (!name.trim() || !bodyText.trim()) { setMsg("Name and body are required."); return; }
    const bodyVarCount = Math.max(0, ...[...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])));
    if (bodyVarCount > 0 && exampleList.length < bodyVarCount) { setMsg(`Body uses {{${bodyVarCount}}} — provide ${bodyVarCount} example value(s), one per line.`); return; }
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
      if (clickTracking && buttons.some(b => b.type === "URL")) payload.clickTracking = true;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Failed to submit");
      else {
        setMsg(`Submitted — status ${d.status}. Meta approval usually takes minutes to a few hours; hit Refresh to check.`);
        setName(""); setBodyText(""); setFooterText(""); setExamples(""); setButtons([]); setClickTracking(false);
        setHeaderType("NONE"); setHeaderText(""); setHeaderExample(""); setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
        setCards([newTplCard(), newTplCard()]);
        load();
      }
    } finally { setBusy(false); }
  }

  async function remove(n: string) {
    if (!confirm(`Delete template "${n}" (all languages)? This can't be undone.`)) return;
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
          <button onClick={() => setShowBuilder(v => !v)} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2">
            {showBuilder ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showBuilder ? "Close" : "New"}
          </button>
        </div>
      </div>

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{notice}</div>}

      {showBuilder && <div className="grid lg:grid-cols-[1fr_310px] gap-5 items-start">
        <section className="bg-white rounded-card border border-line p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase">New template</p>
            <div className="flex gap-1.5">
              <button className={segBtn(mode === "standard")} onClick={() => setMode("standard")}><MessageSquare className="w-3.5 h-3.5 inline mr-1" />Standard</button>
              <button className={segBtn(mode === "carousel")} onClick={() => setMode("carousel")}><GalleryHorizontalEnd className="w-3.5 h-3.5 inline mr-1" />Carousel</button>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_7rem_8rem] gap-2">
            <input className={inp} placeholder="name (lowercase_underscores)" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
            <input className={inp} placeholder="en_US" value={language} onChange={e => setLanguage(e.target.value)} />
            <select className={inp} value={category} onChange={e => setCategory(e.target.value as "MARKETING" | "UTILITY")}>
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
            {/\{\{\d+\}\}/.test(bodyText) && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-600">Sample values <span className="font-normal text-slate-400">— one per line, in order ({"{{1}}"} first). Meta reviews these; your customers never see them.</span></p>
                <textarea className={`${inp} w-full font-mono`} rows={2} placeholder={"Asha\ntomorrow 7 PM"} value={examples} onChange={e => setExamples(e.target.value)} />
              </div>
            )}
            {mode === "standard" && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-600">Footer <span className="font-normal text-slate-400">(optional)</span></p>
                <p className="text-[11px] text-slate-500">A small grey line under the message — usually a sign-off or an opt-out note.</p>
                <input className={`${inp} w-full`} placeholder="e.g. Team AnalytixLabs · Reply STOP to opt out" maxLength={60} value={footerText} onChange={e => setFooterText(e.target.value)} />
              </div>
            )}
          </div>

          {mode === "standard" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Buttons <span className="font-normal normal-case">(up to 10 — max 2 URL, 1 phone)</span></p>
              <TplButtonEditor btns={buttons} max={10} onChange={setButtons} />
              {buttons.some(b => b.type === "URL") && (
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

          <div className="flex items-center gap-3 pt-1">
            <button onClick={create} disabled={busy} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Submit to Meta for approval
            </button>
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
          </div>
        </section>

        <TplPreview
          mode={mode} headerType={headerType} headerText={headerText} headerExample={headerExample}
          headerPreviewUrl={headerPreviewUrl} headerFileName={headerFileName}
          bodyText={bodyText} footerText={footerText} examples={exampleList} buttons={buttons} cards={cards}
        />
      </div>}

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
            <div key={`${t.name}-${t.language}`} className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50">
              <div className="w-52 min-w-0 shrink-0">
                <p className="font-mono text-xs font-semibold text-brand-dark truncate">{t.name}</p>
                {t.status === "REJECTED" && t.rejected_reason && <p className="text-[11px] text-red-500 truncate">Rejected: {t.rejected_reason.replaceAll("_", " ").toLowerCase()}</p>}
              </div>
              <span className="w-24 shrink-0 text-[11px] font-bold text-slate-400 uppercase">{t.category}</span>
              <span className={`w-24 shrink-0 text-[11px] font-bold ${t.status === "APPROVED" ? "text-brand-600" : ACTIONABLE.includes(t.status) ? "text-red-500" : "text-amber-500"}`}>{t.status}</span>
              <span className="w-20 shrink-0 text-[11px] font-bold text-slate-500 uppercase">{tplType(t)}</span>
              <span className="w-16 shrink-0 text-[11px] text-slate-400">{t.language}</span>
              <div className="flex-1" />
              <button onClick={() => toggleFav(t.name)} title="Favourite" className={`p-1.5 rounded-lg hover:bg-slate-100 ${favs.includes(t.name) ? "text-amber-400" : "text-slate-300 hover:text-slate-500"}`}>
                <Star className="w-4 h-4" fill={favs.includes(t.name) ? "currentColor" : "none"} />
              </button>
              <button onClick={() => copyTemplate(t)} title="Duplicate into builder" className="p-1.5 text-slate-400 hover:text-brand-dark hover:bg-slate-100 rounded-lg"><Copy className="w-4 h-4" /></button>
              <button onClick={() => remove(t.name)} title="Delete" className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {visibleTemplates.length === 0 && (
            <p className="px-4 py-8 text-center text-slate-400 text-sm">
              {templates.length === 0 ? "No templates yet — hit + New to build your first one." : "Nothing matches this filter."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default TemplatesTab;
