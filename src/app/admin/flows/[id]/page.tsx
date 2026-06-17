"use client";

// Drag-and-drop chatbot flow builder (React Flow canvas).
// Toolbox → drag a block onto the canvas → connect handles → Save. Test in the
// simulator without WhatsApp. Off-script messages fall through to the AI.

import { createContext, use, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, Handle, Position, useReactFlow,
  BaseEdge, EdgeLabelRenderer, getBezierPath,
  type Node, type Edge, type Connection, type NodeProps, type EdgeProps, type FinalConnectionState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Loader2, Play, Save, Trash2, FlaskConical, Search, MessageSquare, Send,
  Image as ImageIcon, HelpCircle, GitBranch, Clock, Tag as TagIcon, Webhook as WebhookIcon,
  ShoppingBag, Bot, Headset, Flag, List as ListIcon, MousePointerClick, Copy, ChevronDown,
  AlertTriangle, X, Layers, BellRing, ClipboardList, LayoutGrid, GalleryHorizontalEnd, LayoutTemplate,
  UploadCloud, CalendarClock,
} from "lucide-react";

type NodeData = Record<string, unknown>;

// Per-node validation problems, provided by the editor so each block can show
// its own red outline + plain-English fix text.
const IssuesContext = createContext<Record<string, string[]>>({});
const inp = "nodrag border border-line rounded-lg px-2 py-1.5 text-xs w-full bg-white text-ink-900 placeholder:text-ink-400";
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Inline "Upload" button for a node's media field — uploads to public storage and
// hands the resulting URL back, so users never have to host an image themselves.
function NodeUpload({ onUploaded, accept = "image/*" }: { onUploaded: (url: string) => void; accept?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`nodrag shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-line text-xs text-ink-600 cursor-pointer hover:border-brand-500 hover:text-brand-700 ${busy ? "opacity-60" : ""}`} title="Upload an image">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />} Upload
      <input type="file" accept={accept} className="hidden" onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return; setBusy(true);
        try { const fd = new FormData(); fd.append("file", f); const r = await fetch("/api/upload", { method: "POST", body: fd }); const d = await r.json(); if (d.url) onUploaded(d.url); } finally { setBusy(false); e.currentTarget.value = ""; }
      }} />
    </label>
  );
}

// ── Block metadata (toolbox + node chrome share this) ─────────────────────────
const BLOCKS: Record<string, { label: string; icon: React.ReactNode; hint: string }> = {
  message: { label: "Message", icon: <MessageSquare className="w-[18px] h-[18px]" />, hint: "Send a text message" },
  sequence: { label: "Multi-send", icon: <Layers className="w-[18px] h-[18px]" />, hint: "Several messages in one go" },
  media: { label: "Media", icon: <ImageIcon className="w-[18px] h-[18px]" />, hint: "Image, video or PDF" },
  template: { label: "Template", icon: <LayoutTemplate className="w-[18px] h-[18px]" />, hint: "Send an approved template" },
  product: { label: "Product", icon: <ShoppingBag className="w-[18px] h-[18px]" />, hint: "Catalog product card" },
  productlist: { label: "Product carousel", icon: <LayoutGrid className="w-[18px] h-[18px]" />, hint: "Several catalog products, swipeable" },
  carouseltpl: { label: "Carousel template", icon: <GalleryHorizontalEnd className="w-[18px] h-[18px]" />, hint: "Approved 2–10 card template" },
  buttons: { label: "Buttons", icon: <MousePointerClick className="w-[18px] h-[18px]" />, hint: "Up to 3 reply buttons" },
  list: { label: "List menu", icon: <ListIcon className="w-[18px] h-[18px]" />, hint: "Menu of up to 10 options" },
  ask: { label: "Ask", icon: <HelpCircle className="w-[18px] h-[18px]" />, hint: "Collect a free-text answer" },
  waform: { label: "WhatsApp form", icon: <ClipboardList className="w-[18px] h-[18px]" />, hint: "Native in-chat form" },
  condition: { label: "Condition", icon: <GitBranch className="w-[18px] h-[18px]" />, hint: "Branch on an attribute" },
  hours: { label: "Hours", icon: <Clock className="w-[18px] h-[18px]" />, hint: "Open / closed branch" },
  tag: { label: "Add tag", icon: <TagIcon className="w-[18px] h-[18px]" />, hint: "Tag this contact" },
  webhook: { label: "Webhook", icon: <WebhookIcon className="w-[18px] h-[18px]" />, hint: "Notify your system" },
  agent: { label: "AI agent", icon: <Bot className="w-[18px] h-[18px]" />, hint: "Switch AI persona" },
  book: { label: "Book meeting", icon: <CalendarClock className="w-[18px] h-[18px]" />, hint: "Cal.com slot picker + booking" },
  handoff: { label: "Handoff", icon: <Headset className="w-[18px] h-[18px]" />, hint: "Escalate to a human" },
  end: { label: "End", icon: <Flag className="w-[18px] h-[18px]" />, hint: "Close the flow" },
};

const TOOLBOX_GROUPS: { group: string; types: string[] }[] = [
  { group: "Send", types: ["message", "template", "sequence", "media", "product", "productlist", "carouseltpl"] },
  { group: "Collect", types: ["buttons", "list", "ask", "waform"] },
  { group: "Logic", types: ["condition", "hours"] },
  { group: "Actions", types: ["tag", "webhook", "agent", "book", "handoff", "end"] },
];

// ── Node chrome ───────────────────────────────────────────────────────────────
function Shell({ id, type, selected, children, target = true, foot }: {
  id: string; type: string; selected?: boolean; children?: React.ReactNode; target?: boolean; foot?: string;
}) {
  const meta = BLOCKS[type];
  const problems = useContext(IssuesContext)[id] ?? [];
  const { getNode, addNodes, deleteElements } = useReactFlow();
  const duplicate = () => {
    const n = getNode(id);
    if (!n) return;
    addNodes({ ...n, id: `n${Date.now()}`, position: { x: n.position.x + 40, y: n.position.y + 48 }, selected: false, data: JSON.parse(JSON.stringify(n.data ?? {})) });
  };
  const border = problems.length
    ? "border-red-400 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]"
    : selected ? "border-brand-600 shadow-[0_0_0_3px_rgba(22,163,74,0.12)]" : "border-line shadow-sm";
  return (
    <div className={`group bg-white rounded-xl border w-60 transition-colors ${border}`}>
      {target && <Handle type="target" position={Position.Left} className="!bg-ink-400 !border-white !w-3 !h-3" />}
      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${problems.length ? "bg-red-50 text-red-500" : "bg-brand-50 text-brand-700"}`}>{meta?.icon}</div>
        <p className="text-xs font-semibold text-ink-900 flex-1">{meta?.label}</p>
        <button title="Duplicate" onClick={duplicate} className="nodrag opacity-0 group-hover:opacity-100 p-1 text-ink-400 hover:text-ink-900"><Copy className="w-3.5 h-3.5" /></button>
        <button title="Delete" onClick={() => deleteElements({ nodes: [{ id }] })} className="nodrag opacity-0 group-hover:opacity-100 p-1 text-ink-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      <div className="p-2.5 space-y-1.5">{children}</div>
      {foot && <p className="px-2.5 pb-2 -mt-1 text-[10px] text-ink-400">{foot}</p>}
      {problems.length > 0 && (
        <div className="mx-2 mb-2 rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 space-y-0.5">
          {problems.map((p, i) => <p key={i} className="text-[10px] leading-snug text-red-600">⚠ {p}</p>)}
        </div>
      )}
    </div>
  );
}

// Optional "no reply → nudge" config shared by the waiting blocks (buttons/list/ask).
function ReminderFields({ data, set }: { data: NodeData; set: (p: NodeData) => void }) {
  const mins = Number(data.reminderMinutes ?? 0);
  return (
    <div className="border-t border-line pt-1.5 mt-1.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <BellRing className="w-3 h-3 text-ink-400" />
        <span className="text-[10px] font-bold text-ink-400">If no reply in</span>
        <input type="number" min={0} max={1380} className={`${inp} !w-14 !py-0.5`} placeholder="off"
          value={mins || ""} onChange={e => set({ reminderMinutes: Math.max(0, parseInt(e.target.value || "0", 10)) })} />
        <span className="text-[10px] text-ink-400">min, send:</span>
      </div>
      {mins > 0 && (
        <input className={inp} maxLength={1024} placeholder="Reminder message, e.g. Still there? Pick an option 👆"
          value={str(data.reminderText)} onChange={e => set({ reminderText: e.target.value })} />
      )}
    </div>
  );
}
function OptionRow({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center">
      <div className="flex-1">{children}</div>
      <Handle type="source" position={Position.Right} id={id} className="!bg-brand-500 !border-white" style={{ right: -16 }} />
    </div>
  );
}
function useSet(id: string) {
  const { updateNodeData } = useReactFlow();
  return (patch: NodeData) => updateNodeData(id, patch);
}
function Counter({ value, max }: { value: string; max: number }) {
  if (!value) return null;
  return <p className={`text-right text-[9px] -mt-1 ${value.length >= max ? "text-red-500 font-bold" : "text-ink-400"}`}>{value.length}/{max}</p>;
}

// ── Node types ────────────────────────────────────────────────────────────────
function StartNode() {
  return (
    <div className="bg-gradient-to-br from-brand-600 to-brand-900 text-white rounded-xl px-4 py-3 shadow w-44">
      <p className="text-xs font-bold flex items-center gap-1.5"><Play className="w-3.5 h-3.5" /> Flow start</p>
      <p className="text-[10px] text-white/70 mt-0.5">Fires on the trigger keywords set in the top bar.</p>
      <Handle type="source" position={Position.Right} className="!bg-white !border-brand-700" />
    </div>
  );
}
function MessageNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected}>
      <textarea className={inp} rows={3} maxLength={4096} placeholder="Text to send…" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      <Counter value={str(data.text)} max={4096} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
type SeqPart = { kind: "text" | "image" | "video" | "document"; text?: string; url?: string; caption?: string };
function SequenceNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const parts = (data.parts as SeqPart[]) ?? [{ kind: "text" }];
  const setPart = (i: number, patch: Partial<SeqPart>) => set({ parts: parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Shell id={id} type={type} selected={selected} foot="All parts send back-to-back, top to bottom — no reply needed in between.">
      {parts.map((p, i) => (
        <div key={i} className="border border-line rounded-lg p-1.5 space-y-1 bg-canvas/50">
          <div className="flex items-center gap-1.5">
            <select className={`${inp} !w-auto !py-0.5`} value={p.kind} onChange={e => setPart(i, { kind: e.target.value as SeqPart["kind"] })}>
              <option value="text">Text</option><option value="image">Image</option><option value="video">Video</option><option value="document">Document</option>
            </select>
            <span className="text-[9px] text-ink-400 flex-1 text-right">part {i + 1}</span>
            {parts.length > 1 && <button className="nodrag p-0.5 text-ink-400 hover:text-red-500" onClick={() => set({ parts: parts.filter((_, j) => j !== i) })}><X className="w-3 h-3" /></button>}
          </div>
          {p.kind === "text"
            ? <textarea className={inp} rows={2} maxLength={4096} placeholder="Text to send…" value={p.text ?? ""} onChange={e => setPart(i, { text: e.target.value })} />
            : <>
                <div className="flex items-center gap-1.5">
                  <input className={`${inp} flex-1`} placeholder="Public URL or upload →" value={p.url ?? ""} onChange={e => setPart(i, { url: e.target.value })} />
                  <NodeUpload accept={p.kind === "video" ? "video/*" : p.kind === "document" ? "" : "image/*"} onUploaded={url => setPart(i, { url })} />
                </div>
                <input className={inp} maxLength={1024} placeholder="Caption (optional)" value={p.caption ?? ""} onChange={e => setPart(i, { caption: e.target.value })} />
              </>}
        </div>
      ))}
      {parts.length < 10 && (
        <button className="nodrag text-[10px] font-bold text-brand-700 hover:underline" onClick={() => set({ parts: [...parts, { kind: "text" }] })}>+ add part</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function ButtonsNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const buttons = (data.buttons as { id: string; title: string }[]) ?? [{ id: "btn1", title: "" }, { id: "btn2", title: "" }, { id: "btn3", title: "" }];
  return (
    <Shell id={id} type={type} selected={selected} foot="Meta: max 3 buttons, 20 chars each. Connect each button →">
      <textarea className={inp} rows={2} maxLength={1024} placeholder="Question text…" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      {buttons.map((b, i) => (
        <OptionRow key={b.id} id={b.id}>
          <input className={inp} maxLength={20} placeholder={`Button ${i + 1}`} value={b.title}
            onChange={e => set({ buttons: buttons.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} />
        </OptionRow>
      ))}
      <ReminderFields data={data} set={set} />
    </Shell>
  );
}
function ListNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const rows = (data.rows as { id: string; title: string }[]) ?? Array.from({ length: 4 }, (_, i) => ({ id: `row${i + 1}`, title: "" }));
  return (
    <Shell id={id} type={type} selected={selected} foot="Meta: max 10 options, 24 chars each.">
      <textarea className={inp} rows={2} maxLength={1024} placeholder="Question text…" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      <input className={inp} maxLength={20} placeholder="List button label (e.g. View options)" value={str(data.buttonText)} onChange={e => set({ buttonText: e.target.value })} />
      {rows.map((r, i) => (
        <OptionRow key={r.id} id={r.id}>
          <input className={inp} maxLength={24} placeholder={`Option ${i + 1}`} value={r.title}
            onChange={e => set({ rows: rows.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} />
        </OptionRow>
      ))}
      <div className="flex gap-2">
        <button className="nodrag text-[10px] font-bold text-brand-700 hover:underline" onClick={() => rows.length < 10 && set({ rows: [...rows, { id: `row${rows.length + 1}`, title: "" }] })}>+ add option</button>
        {rows.length > 1 && <button className="nodrag text-[10px] font-bold text-ink-400 hover:text-red-500" onClick={() => set({ rows: rows.slice(0, -1) })}>− remove last</button>}
      </div>
      <ReminderFields data={data} set={set} />
    </Shell>
  );
}
function MediaNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected}>
      <select className={inp} value={str(data.kind) || "image"} onChange={e => set({ kind: e.target.value })}>
        <option value="image">Image</option><option value="video">Video</option><option value="document">Document</option>
      </select>
      <div className="flex items-center gap-1.5">
        <input className={`${inp} flex-1`} placeholder="Public URL or upload →" value={str(data.url)} onChange={e => set({ url: e.target.value })} />
        <NodeUpload accept={str(data.kind) === "video" ? "video/*" : str(data.kind) === "document" ? "" : "image/*"} onUploaded={url => set({ url })} />
      </div>
      <input className={inp} maxLength={1024} placeholder="Caption (optional)" value={str(data.caption)} onChange={e => set({ caption: e.target.value })} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function AskNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected} foot="The customer's reply is saved to the attribute, then the flow continues.">
      <textarea className={inp} rows={2} maxLength={1024} placeholder="What do you want to ask?" value={str(data.question)} onChange={e => set({ question: e.target.value })} />
      <input className={inp} placeholder="Save answer to attribute (e.g. city)" value={str(data.attribute)} onChange={e => set({ attribute: e.target.value })} />
      <ReminderFields data={data} set={set} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
// Module-level published-forms list, fetched once and shared by all WaFormNode instances.
let FORM_CACHE: { id: string; name: string }[] | null = null;
async function loadForms(): Promise<{ id: string; name: string }[]> {
  if (!FORM_CACHE) {
    FORM_CACHE = await fetch("/api/admin/waforms").then(r => r.json())
      .then(d => ((d.forms ?? []) as { id: string; name: string; status: string }[])
        .filter(f => f.status === "PUBLISHED").map(f => ({ id: f.id, name: f.name })))
      .catch(() => []);
  }
  return FORM_CACHE ?? [];
}
function WaFormNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { loadForms().then(setForms); }, []);
  return (
    <Shell id={id} type={type} selected={selected} foot="Waits for the submission — answers are saved to contact attributes. Build forms in the WhatsApp Forms tab.">
      <textarea className={inp} rows={2} maxLength={1024} placeholder="Message above the form button…" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      <select className={inp} value={str(data.formId)} onChange={e => set({ formId: e.target.value })}>
        <option value="">— pick a published form —</option>
        {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <input className={inp} maxLength={20} placeholder="Button label (e.g. Fill form)" value={str(data.cta)} onChange={e => set({ cta: e.target.value })} />
      <ReminderFields data={data} set={set} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function ConditionNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected}>
      <input className={inp} placeholder="Contact attribute (e.g. city)" value={str(data.attribute)} onChange={e => set({ attribute: e.target.value })} />
      <select className={inp} value={str(data.op) || "equals"} onChange={e => set({ op: e.target.value })}>
        <option value="equals">equals</option><option value="contains">contains</option>
      </select>
      <input className={inp} placeholder="Value" value={str(data.value)} onChange={e => set({ value: e.target.value })} />
      <OptionRow id="yes"><p className="text-[10px] font-bold text-brand-600 text-right pr-1">✓ yes</p></OptionRow>
      <OptionRow id="no"><p className="text-[10px] font-bold text-red-500 text-right pr-1">✗ no</p></OptionRow>
    </Shell>
  );
}
function HoursNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <Shell id={id} type={type} selected={selected} foot="Routes by current time (IST) — greet differently after hours.">
      <div className="flex items-center gap-1.5">
        <select className={inp} value={Number(data.start ?? 10)} onChange={e => set({ start: Number(e.target.value) })}>
          {hours.map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
        <span className="text-[10px] text-ink-400">to</span>
        <select className={inp} value={Number(data.end ?? 19)} onChange={e => set({ end: Number(e.target.value) })}>
          {hours.map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
      </div>
      <OptionRow id="open"><p className="text-[10px] font-bold text-brand-600 text-right pr-1">● open</p></OptionRow>
      <OptionRow id="closed"><p className="text-[10px] font-bold text-amber-500 text-right pr-1">○ closed</p></OptionRow>
    </Shell>
  );
}
function TagNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected} foot="Use tags to segment broadcasts and filters (e.g. interested-ds).">
      <input className={inp} placeholder="Tag to add (e.g. hot-lead)" value={str(data.tag)} onChange={e => set({ tag: e.target.value })} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function WebhookNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected} foot="POSTs {phone, name, tags, attributes} to your URL — CRM, sheet, Zapier…">
      <input className={inp} placeholder="https:// endpoint URL" value={str(data.url)} onChange={e => set({ url: e.target.value })} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
// Module-level catalog list, shared by all ProductNode instances (custom-card mode).
let PRODUCT_CACHE: { id: string; name: string; buttonText: string | null; buttonUrl: string | null }[] | null = null;
async function loadProducts(): Promise<NonNullable<typeof PRODUCT_CACHE>> {
  if (!PRODUCT_CACHE) {
    PRODUCT_CACHE = await fetch("/api/admin/products").then(r => r.json())
      .then(d => ((d.products ?? []) as NonNullable<typeof PRODUCT_CACHE>))
      .catch(() => []);
  }
  return PRODUCT_CACHE ?? [];
}
function ProductNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const custom = str(data.cardStyle) === "custom";
  const [prods, setProds] = useState<NonNullable<typeof PRODUCT_CACHE>>([]);
  useEffect(() => { if (custom) loadProducts().then(setProds); }, [custom]);
  const sel = prods.find(p => p.id === str(data.localProductId));
  return (
    <Shell id={id} type={type} selected={selected} foot={custom ? "Custom card: the product image + your text + the button you set in Catalog. Needs a button link on the product." : "Native catalog card — WhatsApp shows its own “View” button (not editable)."}>
      <div className="flex gap-1 rounded-control bg-canvas p-0.5">
        <button onClick={() => set({ cardStyle: "native" })} className={`flex-1 px-2 py-1 rounded-[6px] text-[11px] font-bold ${!custom ? "bg-white shadow-sm text-ink-900" : "text-ink-400"}`}>Catalog card</button>
        <button onClick={() => set({ cardStyle: "custom" })} className={`flex-1 px-2 py-1 rounded-[6px] text-[11px] font-bold ${custom ? "bg-white shadow-sm text-ink-900" : "text-ink-400"}`}>Custom card</button>
      </div>
      <textarea className={inp} rows={2} maxLength={1024} placeholder={custom ? "Message text (defaults to name + price)…" : "Message text…"} value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      {custom ? (
        <>
          <select className={inp} value={str(data.localProductId)} onChange={e => set({ localProductId: e.target.value })}>
            <option value="">{prods.length ? "— pick a product —" : "No products yet — add them in Catalog"}</option>
            {prods.map(p => <option key={p.id} value={p.id}>{p.name}{p.buttonText ? ` · “${p.buttonText}”` : ""}</option>)}
          </select>
          {sel && !sel.buttonUrl && <p className="text-[10px] text-amber-600">This product has no button link — add one in Catalog or it won’t send.</p>}
        </>
      ) : (
        <>
          <input className={inp} placeholder="Catalog ID (Commerce Manager)" value={str(data.catalogId)} onChange={e => set({ catalogId: e.target.value })} />
          <input className={inp} placeholder="Product retailer ID" value={str(data.productId)} onChange={e => set({ productId: e.target.value })} />
        </>
      )}
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function ProductListNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const ids = str(data.products).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  return (
    <Shell id={id} type={type} selected={selected} foot="One swipeable card per product, straight from your Meta catalog (≤30).">
      <input className={inp} maxLength={60} placeholder="Header (e.g. Our plans)" value={str(data.header)} onChange={e => set({ header: e.target.value })} />
      <textarea className={inp} rows={2} maxLength={1024} placeholder="Message text above the cards…" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      <input className={inp} placeholder="Catalog ID (Commerce Manager)" value={str(data.catalogId)} onChange={e => set({ catalogId: e.target.value })} />
      <textarea className={inp} rows={3} placeholder={"Product retailer IDs — one per line\nSKU-101\nSKU-102"} value={str(data.products)} onChange={e => set({ products: e.target.value })} />
      <p className="text-right text-[9px] text-ink-400 -mt-1">{ids.length}/30 products</p>
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
type CarouselCard = { mediaUrl?: string; kind?: "image" | "video"; bodyParams?: string };
function CarouselTemplateNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const cards = (data.cards as CarouselCard[]) ?? [{ kind: "image" }, { kind: "image" }];
  const setCard = (i: number, patch: Partial<CarouselCard>) => set({ cards: cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <Shell id={id} type={type} selected={selected} foot="Pick an APPROVED carousel template. Supply each card's media link (Meta needs it at send) + any {{1}} values.">
      <input className={inp} placeholder="Approved template name" value={str(data.templateName)} onChange={e => set({ templateName: e.target.value })} />
      <div className="flex items-center gap-1.5">
        <input className={`${inp} !w-24`} placeholder="en_US" value={str(data.lang) || ""} onChange={e => set({ lang: e.target.value })} />
        <input className={inp} placeholder="Bubble {{1}},{{2}}… (optional)" value={str(data.bubbleParams)} onChange={e => set({ bubbleParams: e.target.value })} />
      </div>
      {cards.map((c, i) => (
        <div key={i} className="border border-line rounded-lg p-1.5 space-y-1 bg-canvas/50">
          <div className="flex items-center gap-1.5">
            <select className={`${inp} !w-auto !py-0.5`} value={c.kind ?? "image"} onChange={e => setCard(i, { kind: e.target.value as CarouselCard["kind"] })}>
              <option value="image">Image</option><option value="video">Video</option>
            </select>
            <span className="text-[9px] text-ink-400 flex-1 text-right">card {i + 1}</span>
            {cards.length > 2 && <button className="nodrag p-0.5 text-ink-400 hover:text-red-500" onClick={() => set({ cards: cards.filter((_, j) => j !== i) })}><X className="w-3 h-3" /></button>}
          </div>
          <div className="flex items-center gap-1.5">
            <input className={`${inp} flex-1`} placeholder="Card media URL or upload →" value={c.mediaUrl ?? ""} onChange={e => setCard(i, { mediaUrl: e.target.value })} />
            <NodeUpload accept={c.kind === "video" ? "video/*" : "image/*"} onUploaded={url => setCard(i, { mediaUrl: url })} />
          </div>
          <input className={inp} placeholder="Card {{1}},{{2}}… (optional)" value={c.bodyParams ?? ""} onChange={e => setCard(i, { bodyParams: e.target.value })} />
        </div>
      ))}
      {cards.length < 10 && (
        <button className="nodrag text-[10px] font-bold text-brand-700 hover:underline" onClick={() => set({ cards: [...cards, { kind: "image" }] })}>+ add card</button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
// Module-level approved-template list, shared by all TemplateNode instances.
let TEMPLATE_CACHE: { name: string; language: string; status: string; components?: { type: string; format?: string; text?: string }[] }[] | null = null;
async function loadTemplates(): Promise<NonNullable<typeof TEMPLATE_CACHE>> {
  if (!TEMPLATE_CACHE) {
    TEMPLATE_CACHE = await fetch("/api/admin/templates").then(r => r.json())
      .then(d => ((d.templates ?? []) as NonNullable<typeof TEMPLATE_CACHE>).filter(t => t.status === "APPROVED"))
      .catch(() => []);
  }
  return TEMPLATE_CACHE ?? [];
}
function TemplateNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const [tpls, setTpls] = useState<NonNullable<typeof TEMPLATE_CACHE>>([]);
  useEffect(() => { loadTemplates().then(setTpls); }, []);
  const sel = tpls.find(t => t.name === str(data.templateName) && t.language === str(data.lang));
  const bodyText = sel?.components?.find(c => c.type === "BODY")?.text ?? "";
  const varCount = sel ? new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size : 0;
  const needsImage = !!sel?.components?.some(c => c.type === "HEADER" && c.format === "IMAGE");
  // A carousel template (BODY + CAROUSEL) can't be sent like a standard one —
  // Meta needs each card's media at send time. Show the card editor instead.
  const isCarousel = !!sel?.components?.some(c => c.type === "CAROUSEL");
  const params = (data.bodyParams as string[]) ?? [];
  const setParam = (i: number, v: string) => { const next = [...params]; next[i] = v; set({ bodyParams: next }); };
  const cards = (data.cards as CarouselCard[]) ?? [{ kind: "image" }, { kind: "image" }];
  const setCard = (i: number, patch: Partial<CarouselCard>) => set({ cards: cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <Shell id={id} type={type} selected={selected} foot="Sends an APPROVED template. WhatsApp only — create/approve templates in the Templates tab.">
      <select className={inp} value={sel ? `${sel.name}|||${sel.language}` : ""} onChange={e => { const [n, l] = e.target.value.split("|||"); set({ templateName: n, lang: l, bodyParams: [] }); }}>
        <option value="">{tpls.length ? "— pick an approved template —" : "No approved templates yet"}</option>
        {tpls.map(t => <option key={t.name + t.language} value={`${t.name}|||${t.language}`}>{t.name} · {t.language}{t.components?.some(c => c.type === "CAROUSEL") ? " · carousel" : ""}</option>)}
      </select>
      {isCarousel ? (
        <>
          <p className="text-[10px] text-amber-600 leading-snug">Carousel template — add each card&apos;s image/video below (Meta needs it at send time).</p>
          <input className={inp} placeholder="Bubble {{1}},{{2}}… (optional)" value={str(data.bubbleParams)} onChange={e => set({ bubbleParams: e.target.value })} />
          {cards.map((c, i) => (
            <div key={i} className="border border-line rounded-lg p-1.5 space-y-1 bg-canvas/50">
              <div className="flex items-center gap-1.5">
                <select className={`${inp} !w-auto !py-0.5`} value={c.kind ?? "image"} onChange={e => setCard(i, { kind: e.target.value as CarouselCard["kind"] })}>
                  <option value="image">Image</option><option value="video">Video</option>
                </select>
                <span className="text-[9px] text-ink-400 flex-1 text-right">card {i + 1}</span>
                {cards.length > 2 && <button className="nodrag p-0.5 text-ink-400 hover:text-red-500" onClick={() => set({ cards: cards.filter((_, j) => j !== i) })}><X className="w-3 h-3" /></button>}
              </div>
              <div className="flex items-center gap-1.5">
                <input className={`${inp} flex-1`} placeholder="Card media URL or upload →" value={c.mediaUrl ?? ""} onChange={e => setCard(i, { mediaUrl: e.target.value })} />
                <NodeUpload accept={c.kind === "video" ? "video/*" : "image/*"} onUploaded={url => setCard(i, { mediaUrl: url })} />
              </div>
              <input className={inp} placeholder="Card {{1}},{{2}}… (optional)" value={c.bodyParams ?? ""} onChange={e => setCard(i, { bodyParams: e.target.value })} />
            </div>
          ))}
          {cards.length < 10 && <button className="nodrag text-[10px] font-bold text-brand-700 hover:underline" onClick={() => set({ cards: [...cards, { kind: "image" }] })}>+ add card</button>}
        </>
      ) : (
        <>
          {needsImage && (
            <div className="flex items-center gap-1.5">
              <input className={`${inp} flex-1`} placeholder="Header image URL or upload →" value={str(data.headerImageUrl)} onChange={e => set({ headerImageUrl: e.target.value })} />
              <NodeUpload onUploaded={url => set({ headerImageUrl: url })} />
            </div>
          )}
          {Array.from({ length: varCount }).map((_, i) => (
            <input key={i} className={inp} placeholder={`Value for {{${i + 1}}}`} value={params[i] ?? ""} onChange={e => setParam(i, e.target.value)} />
          ))}
          {sel && bodyText && <p className="text-[10px] text-ink-400 line-clamp-2">{bodyText}</p>}
        </>
      )}
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
// Module-level agent list, fetched once and shared by all AgentNode instances.
let AGENT_CACHE: { id: string; name: string }[] | null = null;
async function loadAgents(): Promise<{ id: string; name: string }[]> {
  if (!AGENT_CACHE) {
    AGENT_CACHE = await fetch("/api/admin/ai/agents").then(r => r.json()).then(d => (d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))).catch(() => []);
  }
  return AGENT_CACHE ?? [];
}
function AgentNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { loadAgents().then(setAgents); }, []);
  return (
    <Shell id={id} type={type} selected={selected} foot="All future AI replies in this chat use this persona (manage in AI Hub).">
      <select className={inp} value={str(data.agentId)} onChange={e => set({ agentId: e.target.value })}>
        <option value="">— pick an agent —</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function HandoffNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected} foot="Escalates the chat + turns the AI off until a teammate re-enables it.">
      <textarea className={inp} rows={2} maxLength={1024} placeholder="Message before handoff (optional)" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
    </Shell>
  );
}
function BookNode({ id, type, selected, data }: NodeProps) {
  const set = useSet(id);
  return (
    <Shell id={id} type={type} selected={selected} foot="Shows live Cal.com slots, then books the chosen time. Connect Cal.com in Integrations first. The →  edge runs after a successful booking.">
      <textarea className={inp} rows={2} maxLength={300} placeholder="Prompt (e.g. Pick a time that works for you:)" value={str(data.text)} onChange={e => set({ text: e.target.value })} />
      <input className={inp} placeholder="Timezone (default Asia/Kolkata)" value={str(data.tz)} onChange={e => set({ tz: e.target.value })} />
      <input className={inp} placeholder="If no slots / not connected, say (optional)" value={str(data.fallback)} onChange={e => set({ fallback: e.target.value })} />
      <Handle type="source" position={Position.Right} className="!bg-brand-500 !border-white" />
    </Shell>
  );
}
function EndNode({ id, type, selected }: NodeProps) {
  return <Shell id={id} type={type} selected={selected} foot="Session ends. The next message goes to the AI / can trigger again." />;
}

const nodeTypes = {
  start: StartNode, message: MessageNode, sequence: SequenceNode, buttons: ButtonsNode, list: ListNode,
  media: MediaNode, ask: AskNode, waform: WaFormNode, condition: ConditionNode, hours: HoursNode,
  tag: TagNode, webhook: WebhookNode, product: ProductNode,
  template: TemplateNode, productlist: ProductListNode, carouseltpl: CarouselTemplateNode,
  agent: AgentNode, book: BookNode, handoff: HandoffNode, end: EndNode,
};

// ── Edge with an × button to disconnect ───────────────────────────────────────
function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? "#0553ad" : "#A3A3A3", strokeWidth: selected ? 2 : 1.5 }} />
      <EdgeLabelRenderer>
        <button
          onClick={() => setEdges(es => es.filter(e => e.id !== id))}
          title="Disconnect"
          className="nodrag nopan pointer-events-auto absolute w-4 h-4 rounded-full bg-white border border-line text-ink-400 hover:bg-red-500 hover:border-red-500 hover:text-white text-[10px] leading-none flex items-center justify-center transition-colors"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { deletable: DeletableEdge };

// ── Graph validation (Meta limits + dead config) — plain-English, per block ──
type Issue = { nodeId: string | null; msg: string };
function validateGraph(nodes: Node[], edges: Edge[], keywords: string, active: boolean): Issue[] {
  const issues: Issue[] = [];
  const out = (id: string, handle?: string) => edges.some(e => e.source === id && (handle === undefined || e.sourceHandle === handle));
  if (active && !keywords.trim()) issues.push({ nodeId: null, msg: "This flow is ON but has no trigger keywords. Add keywords in the top bar (e.g. hi, hello) — or bind it to a Meta ad via “Ad triggers” so leads from that campaign start it automatically." });
  const start = nodes.find(n => n.type === "start");
  if (start && !out(start.id)) issues.push({ nodeId: start.id, msg: "Connect the Start block to your first message — drag from its dot to the next block." });
  for (const n of nodes) {
    const d = (n.data ?? {}) as NodeData;
    const add = (msg: string) => issues.push({ nodeId: n.id, msg });
    if (n.type === "message" && !str(d.text).trim()) add("This message is empty — type what you want to send.");
    if (n.type === "sequence") {
      const parts = (d.parts as SeqPart[]) ?? [];
      const ok = parts.some(p => (p.kind === "text" ? p.text?.trim() : p.url?.trim()));
      if (!ok) add("Add at least one part with content — a text or a media link.");
      for (const p of parts) if (p.kind !== "text" && p.url?.trim() && !/^https:\/\//.test(p.url)) add("Media links must start with https:// and be publicly reachable.");
    }
    if (n.type === "buttons") {
      const btns = ((d.buttons as { id: string; title: string }[]) ?? []).filter(b => b.title?.trim());
      if (!btns.length) add("Give at least one button a label — that's what the customer taps.");
      for (const b of btns) if (!out(n.id, b.id)) add(`The “${b.title}” button goes nowhere — drag from its dot to the block that should come next.`);
    }
    if (n.type === "list") {
      const rows = ((d.rows as { id: string; title: string }[]) ?? []).filter(r => r.title?.trim());
      if (!rows.length) add("Add at least one option to the menu.");
    }
    if (n.type === "media" && !/^https:\/\//.test(str(d.url))) add("Paste a public link that starts with https:// — WhatsApp fetches the file from there.");
    if (n.type === "ask" && !str(d.question).trim()) add("Type the question you want to ask the customer.");
    if (n.type === "waform" && !str(d.formId)) add("Pick which published form to send — create one in the WhatsApp Forms tab first.");
    if (n.type === "condition") {
      if (!str(d.attribute).trim()) add("Pick which contact detail to check (e.g. city).");
      if (!out(n.id, "yes") && !out(n.id, "no")) add("Neither the yes nor the no path is connected — the flow stops here.");
    }
    if (n.type === "hours" && !out(n.id, "open") && !out(n.id, "closed")) add("Connect the open and/or closed path so the flow knows where to go.");
    if (n.type === "tag" && !str(d.tag).trim()) add("Type the tag to add to this contact (e.g. hot-lead).");
    if (n.type === "webhook" && !/^https?:\/\//.test(str(d.url))) add("Paste the full URL to notify, starting with https://.");
    if (n.type === "product") {
      if (str(d.cardStyle) === "custom") {
        if (!str(d.localProductId).trim()) add("Pick a product for the custom card (add products in Catalog).");
      } else if (!str(d.catalogId).trim() || !str(d.productId).trim()) add("Fill in both the Catalog ID and the Product ID from Meta Commerce Manager.");
    }
    if (n.type === "template") {
      if (!str(d.templateName).trim()) add("Pick an approved template to send.");
      else {
        // Carousel template: needs ≥2 cards each with media, or Meta rejects it.
        const cs = (d.cards as CarouselCard[] | undefined) ?? [];
        const withMedia = cs.filter(c => str(c.mediaUrl).trim()).length;
        if (cs.length && withMedia < 2) add("This carousel template needs at least 2 cards, each with an image or video.");
      }
    }
    if (n.type === "productlist") {
      const ids = str(d.products).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
      if (!str(d.catalogId).trim()) add("Add the Catalog ID from Meta Commerce Manager.");
      if (!ids.length) add("List at least one product retailer ID — one per line.");
    }
    if (n.type === "carouseltpl") {
      const cards = ((d.cards as { mediaUrl?: string }[]) ?? []).filter(c => str(c.mediaUrl).trim());
      if (!str(d.templateName).trim()) add("Type the exact name of an APPROVED carousel template.");
      if (cards.length < 2) add("A carousel needs at least 2 cards, each with a public media link.");
      for (const c of (d.cards as { mediaUrl?: string }[]) ?? []) if (str(c.mediaUrl).trim() && !/^https:\/\//.test(str(c.mediaUrl).trim())) add("Card media links must start with https:// and be publicly reachable.");
    }
    if (n.type === "agent" && !str(d.agentId)) add("Choose which AI agent should take over from here.");
    if ((n.type === "buttons" || n.type === "list" || n.type === "ask" || n.type === "waform") && Number(d.reminderMinutes ?? 0) > 0 && !str(d.reminderText).trim()) {
      add("You set a reminder time but no reminder message — type what the nudge should say.");
    }
  }
  return issues;
}

// ── Editor ────────────────────────────────────────────────────────────────────
// ── Bind this flow to Meta Ads campaigns / ads ────────────────────────────────
// A CTWA lead from a bound campaign (or ad) auto-starts this flow on their first
// message — no keyword needed. Ad-level binding overrides the campaign default.
type AdTrigger = { scope: "ad" | "campaign"; refId: string; label: string | null };
function AdTriggersPanel({ flowId, onClose }: { flowId: string; onClose: () => void }) {
  const [triggers, setTriggers] = useState<AdTrigger[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"campaign" | "ad">("campaign");
  const [campaignId, setCampaignId] = useState("");
  const [ads, setAds] = useState<{ id: string; name: string }[]>([]);
  const [adId, setAdId] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/flow-triggers?flowId=${flowId}`).then(r => r.json()).then(d => {
      setTriggers(d.triggers ?? []); setCampaigns(d.campaigns ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [flowId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (scope !== "ad" || !campaignId) { setAds([]); return; }
    fetch(`/api/admin/flow-triggers?ads=${campaignId}`).then(r => r.json()).then(d => setAds(d.ads ?? [])).catch(() => {});
  }, [scope, campaignId]);

  const campName = (id: string) => campaigns.find(c => c.id === id)?.name ?? id;
  async function add() {
    const refId = scope === "campaign" ? campaignId : adId;
    if (!refId) return;
    setBusy(true);
    const label = scope === "campaign" ? campName(campaignId) : `${campName(campaignId)} › ${ads.find(a => a.id === adId)?.name ?? adId}`;
    await fetch("/api/admin/flow-triggers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flowId, scope, refId, label }) }).catch(() => {});
    setAdId(""); setBusy(false); reload();
  }
  async function remove(t: AdTrigger) {
    await fetch("/api/admin/flow-triggers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: t.scope, refId: t.refId }) }).catch(() => {});
    reload();
  }

  return (
    <div className="absolute right-0 top-9 w-96 bg-white rounded-control border border-line shadow-float p-3 space-y-3 z-30">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-ink-400 uppercase">Auto-start from a Meta ad</p>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-3.5 h-3.5" /></button>
      </div>
      <p className="text-[11px] text-ink-500 leading-snug">Leads who message from a bound campaign (or specific ad) start this flow on their first message — no keyword needed. An ad binding overrides its campaign.</p>

      {loading ? <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-ink-400" /></div> : (
        <>
          {triggers.length > 0 && (
            <div className="space-y-1">
              {triggers.map(t => (
                <div key={`${t.scope}:${t.refId}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-control bg-canvas">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${t.scope === "ad" ? "bg-ink-950 text-white" : "bg-brand-100 text-brand-700"}`}>{t.scope === "ad" ? "AD" : "CAMPAIGN"}</span>
                  <span className="text-xs text-ink-800 flex-1 truncate" title={t.refId}>{t.label || t.refId}</span>
                  <button onClick={() => remove(t)} className="text-ink-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-line pt-2.5 space-y-2">
            <div className="flex gap-1.5">
              {(["campaign", "ad"] as const).map(k => (
                <button key={k} onClick={() => setScope(k)} className={`flex-1 px-2 py-1 rounded-control border text-[11px] font-bold ${scope === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink-400"}`}>{k === "campaign" ? "Whole campaign" : "Specific ad"}</button>
              ))}
            </div>
            <select className={inp} value={campaignId} onChange={e => { setCampaignId(e.target.value); setAdId(""); }}>
              <option value="">{campaigns.length ? "Pick a campaign…" : "No campaigns found"}</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {scope === "ad" && campaignId && (
              <select className={inp} value={adId} onChange={e => setAdId(e.target.value)}>
                <option value="">{ads.length ? "Pick an ad…" : "Loading ads…"}</option>
                {ads.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <button onClick={add} disabled={busy || (scope === "campaign" ? !campaignId : !adId)} className="w-full px-3 py-1.5 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Bind this flow
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Editor({ flowId }: { flowId: string }) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [active, setActive] = useState(false);
  const [platform, setPlatform] = useState<"whatsapp" | "instagram" | "both">("whatsapp");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [primaryKbTag, setPrimaryKbTag] = useState("");
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [search, setSearch] = useState("");
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [showIssues, setShowIssues] = useState(false);
  const [showAdTriggers, setShowAdTriggers] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [simLog, setSimLog] = useState<{ who: "you" | "flow"; text: string; options?: string[] }[]>([]);
  const [simInput, setSimInput] = useState("");
  // Which chat skin the simulator renders in. Defaults to the flow's platform but
  // can be toggled to preview how the same flow looks on the other channel.
  const [simView, setSimView] = useState<"whatsapp" | "instagram">("whatsapp");
  useEffect(() => { setSimView(platform === "instagram" ? "instagram" : "whatsapp"); }, [platform]);
  const { screenToFlowPosition } = useReactFlow();
  const counter = useRef(1);

  useEffect(() => { fetch("/api/admin/channels").then(r => r.json()).then(d => setChannels((d.channels ?? []).map((c: { id: string; name: string; kind?: string }) => ({ id: c.id, name: c.name, kind: c.kind ?? "whatsapp" })))).catch(() => {}); }, []);
  // Distinct KB topic tags, for the "Primary knowledge" picker.
  useEffect(() => { fetch("/api/admin/kb").then(r => r.json()).then(d => setKbTags([...new Set(((d.documents ?? []) as { tag?: string | null }[]).map(x => x.tag).filter((t): t is string => !!t))].sort())).catch(() => {}); }, []);

  useEffect(() => {
    fetch(`/api/admin/flows/${flowId}`).then(r => r.json()).then(d => {
      if (!d.flow) return;
      setName(d.flow.name); setActive(d.flow.active); setKeywords((d.flow.triggerKeywords ?? []).join(", "));
      setPlatform(d.flow.platform === "instagram" || d.flow.platform === "both" ? d.flow.platform : "whatsapp");
      setChannelId(d.flow.channelId ?? null);
      setPrimaryKbTag(d.flow.primaryKbTag ?? "");
      setNodes((d.flow.graph.nodes ?? []).map((n: { id: string; type: string; position: { x: number; y: number }; data: NodeData }) => ({ ...n, data: n.data ?? {} })));
      setEdges((d.flow.graph.edges ?? []).map((e: Edge) => ({ ...e, animated: true, type: "deletable" })));
      counter.current = (d.flow.graph.nodes?.length ?? 0) + 1;
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [flowId, setNodes, setEdges]);

  const onConnect = useCallback((c: Connection) => setEdges(eds => addEdge({ ...c, animated: true, type: "deletable" }, eds)), [setEdges]);

  // Drop-anywhere connect: releasing a connection on a block (not exactly on a
  // handle) still wires it up — we read the block under the cursor.
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid) return;                                   // landed on a handle — normal path
    if (!state.fromNode || state.fromHandle?.type === "target") return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : event;
    const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest(".react-flow__node");
    const targetId = el?.getAttribute("data-id");
    if (!targetId || targetId === state.fromNode.id) return;
    const source = state.fromNode.id, sourceHandle = state.fromHandle?.id ?? null;
    setEdges(eds => {
      // one edge per source handle — replace any existing one, like a re-drag would
      const rest = eds.filter(e => !(e.source === source && (e.sourceHandle ?? null) === sourceHandle));
      return [...rest, { id: `e${Date.now()}`, source, sourceHandle, target: targetId, animated: true, type: "deletable" }];
    });
  }, [setEdges]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/wa-node");
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes(ns => [...ns, { id: `n${Date.now()}_${counter.current++}`, type, position, data: {} }]);
  }, [screenToFlowPosition, setNodes]);

  const issues = useMemo(() => validateGraph(nodes, edges, keywords, active), [nodes, edges, keywords, active]);
  const issuesByNode = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const i of issues) if (i.nodeId) (m[i.nodeId] = m[i.nodeId] ?? []).push(i.msg);
    return m;
  }, [issues]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/admin/flows/${flowId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Untitled flow",
          active,
          platform,
          channelId,
          primaryKbTag: primaryKbTag || null,
          triggerKeywords: keywords.split(",").map(k => k.trim()).filter(Boolean),
          graph: {
            nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
            edges: edges.map(e => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target })),
          },
        }),
      });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  async function simulate(msg: string) {
    setSimLog(l => [...l, { who: "you", text: msg }]);
    setSimInput("");
    await save();                                     // simulate against the latest graph
    const d = await fetch(`/api/admin/flows/${flowId}/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }),
    }).then(r => r.json()).catch(() => ({ outputs: [], note: "simulator error" }));
    const entries = (d.outputs ?? []).map((o: { kind: string; body: string; options?: string[] }) => ({
      who: "flow" as const,
      text: o.kind === "ai" ? `🤖 ${o.body}` : o.body,
      options: o.options,
    }));
    if (d.note) entries.push({ who: "flow" as const, text: `· ${d.note}`, options: undefined });
    if (entries.length === 0) entries.push({ who: "flow" as const, text: "(no output)" });
    setSimLog(l => [...l, ...entries]);
  }

  if (!loaded) return <div className="h-screen flex items-center justify-center bg-canvas"><Loader2 className="w-6 h-6 animate-spin text-ink-400" /></div>;

  const toggleGroup = (g: string) => setClosedGroups(s => { const next = new Set(s); if (next.has(g)) next.delete(g); else next.add(g); return next; });
  const q = search.trim().toLowerCase();
  const simIg = simView === "instagram";

  return (
    <div className="h-screen flex flex-col bg-canvas">
      {/* Top bar */}
      <header className="px-4 h-14 shrink-0 bg-white border-b border-line flex items-center gap-3 z-20">
        <button onClick={() => router.push("/admin")} className="p-1.5 rounded-lg text-ink-400 hover:bg-canvas hover:text-ink-900"><ArrowLeft className="w-4 h-4" /></button>
        <span className="text-[13px] text-ink-400 hidden sm:block">Flows<span className="mx-1">/</span></span>
        <input className="font-semibold text-sm text-ink-900 border-b border-transparent focus:border-line focus:outline-none w-44 bg-transparent" value={name} onChange={e => setName(e.target.value)} />
        <input className="border border-line rounded-control px-3 py-1.5 text-xs flex-1 max-w-md bg-white text-ink-900 placeholder:text-ink-400" placeholder="Trigger keywords, comma-separated (e.g. hi, hello, menu)" title="A message matching any of these starts the flow. To trigger from a template's quick-reply button, add the button's exact label here." value={keywords} onChange={e => setKeywords(e.target.value)} />
        <select className="border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900 font-medium" value={platform} onChange={e => { setPlatform(e.target.value as "whatsapp" | "instagram" | "both"); setChannelId(null); }} title="Which channel(s) this flow runs on">
          <option value="whatsapp">📱 WhatsApp</option>
          <option value="instagram">📷 Instagram</option>
          <option value="both">📱 + 📷 Both</option>
        </select>
        {channels.filter(c => c.kind === platform).length > 0 && (
          <select className="border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900" value={channelId ?? ""} onChange={e => setChannelId(e.target.value || null)} title={`Which ${platform === "instagram" ? "account" : "number"} this flow runs on`}>
            <option value="">All {platform === "instagram" ? "accounts" : "numbers"}</option>
            {channels.filter(c => c.kind === platform).map(c => <option key={c.id} value={c.id}>{c.name} only</option>)}
          </select>
        )}
        <select className="border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900" value={primaryKbTag} onChange={e => setPrimaryKbTag(e.target.value)} title="AI in this flow answers from KB docs with this tag first, then falls back to the default knowledge base. Tag docs in the AI Assistant tab.">
          <option value="">🧠 Default knowledge</option>
          {kbTags.map(t => <option key={t} value={t}>🧠 {t} first</option>)}
          {primaryKbTag && !kbTags.includes(primaryKbTag) && <option value={primaryKbTag}>🧠 {primaryKbTag} first</option>}
        </select>
        <div className="flex-1" />
        {issues.length > 0 && (
          <div className="relative">
            <button onClick={() => setShowIssues(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold">
              <AlertTriangle className="w-3.5 h-3.5" /> {issues.length} issue{issues.length > 1 ? "s" : ""}
            </button>
            {showIssues && (
              <div className="absolute right-0 top-9 w-80 bg-white rounded-control border border-line shadow-float p-3 space-y-1.5 z-30">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-ink-400 uppercase">Fix before going live</p>
                  <button onClick={() => setShowIssues(false)} className="text-ink-400 hover:text-ink-900"><X className="w-3.5 h-3.5" /></button>
                </div>
                {issues.map((s, i) => <p key={i} className="text-xs text-ink-600">• {s.msg}</p>)}
              </div>
            )}
          </div>
        )}
        <div className="relative">
          <button onClick={() => setShowAdTriggers(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line text-ink-600 hover:bg-canvas text-xs font-bold"><Flag className="w-3.5 h-3.5" /> Ad triggers</button>
          {showAdTriggers && <AdTriggersPanel flowId={flowId} onClose={() => setShowAdTriggers(false)} />}
        </div>
        <button onClick={() => setActive(a => !a)} className={`px-3 py-1.5 rounded-full text-xs font-bold ${active ? "bg-brand-100 text-brand-700" : "bg-canvas text-ink-400"}`}>{active ? "● Active" : "○ Inactive"}</button>
        <button onClick={() => setSimOpen(s => !s)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-xs font-bold border transition-colors ${simOpen ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600 hover:bg-canvas"}`}><FlaskConical className="w-3.5 h-3.5" /> Test</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 transition-colors">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {Date.now() - savedAt < 2500 ? "Saved ✓" : "Save"}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Toolbox */}
        <aside className="w-56 shrink-0 bg-white border-r border-line flex flex-col">
          <div className="p-4 pb-2">
            <p className="text-sm font-bold text-ink-900">Toolbox</p>
            <p className="text-[11px] text-ink-400 mt-0.5 leading-snug">Click and drag a block to the canvas to build a flow.</p>
            <div className="relative mt-3">
              <Search className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input className="w-full border border-line rounded-control pl-8 pr-2 py-1.5 text-xs bg-canvas text-ink-900 placeholder:text-ink-400" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
            {TOOLBOX_GROUPS.map(g => {
              const types = g.types.filter(t => !q || BLOCKS[t].label.toLowerCase().includes(q) || BLOCKS[t].hint.toLowerCase().includes(q));
              if (!types.length) return null;
              const closed = closedGroups.has(g.group) && !q;
              return (
                <div key={g.group}>
                  <button onClick={() => toggleGroup(g.group)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">
                    <ChevronDown className={`w-3 h-3 transition-transform ${closed ? "-rotate-90" : ""}`} /> {g.group} blocks
                  </button>
                  {!closed && (
                    <div className="grid grid-cols-2 gap-2">
                      {types.map(t => (
                        <div key={t} draggable onDragStart={e => e.dataTransfer.setData("application/wa-node", t)} title={BLOCKS[t].hint}
                          className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-control border border-line bg-white text-ink-600 cursor-grab active:cursor-grabbing hover:border-brand-500 hover:text-brand-700 transition-colors">
                          {BLOCKS[t].icon}
                          <span className="text-[11px] font-medium leading-none text-center">{BLOCKS[t].label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-ink-400 leading-relaxed pt-1">Connect the green dots. Delete with ⌫. Off-script replies fall through to the AI assistant.</p>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1" onDrop={onDrop} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <IssuesContext.Provider value={issuesByNode}>
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={onConnect} onConnectEnd={onConnectEnd} connectionRadius={42}
              fitView snapToGrid snapGrid={[8, 8]} deleteKeyCode={["Backspace", "Delete"]}
              defaultEdgeOptions={{ animated: true, type: "deletable" }}
              proOptions={{ hideAttribution: true }}>
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="#D4D4D8" />
              <Controls />
              <MiniMap pannable zoomable nodeColor={() => "#DCE6FF"} nodeStrokeColor={() => "#0553ad"} maskColor="rgba(244,245,247,0.7)" />
            </ReactFlow>
          </IssuesContext.Provider>
        </div>

        {/* Simulator */}
        {simOpen && (
          <aside className="w-80 shrink-0 bg-white border-l border-line flex flex-col">
            <div className="px-3 py-2 border-b border-line flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-ink-600 uppercase flex items-center gap-1.5"><Play className="w-3.5 h-3.5" /> Simulator</p>
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-full bg-canvas p-0.5 border border-line">
                  <button onClick={() => setSimView("whatsapp")} title="WhatsApp view" className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${!simIg ? "bg-[#25d366] text-white" : "text-ink-500 hover:text-ink-900"}`}>WhatsApp</button>
                  <button onClick={() => setSimView("instagram")} title="Instagram view" className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${simIg ? "bg-gradient-to-r from-[#feda75] via-[#d62976] to-[#962fbf] text-white" : "text-ink-500 hover:text-ink-900"}`}>Instagram</button>
                </div>
                <button onClick={async () => { setSimLog([]); await fetch(`/api/admin/flows/${flowId}/simulate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) }); }} title="Reset conversation" className="text-ink-400 hover:text-red-500 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            {/* Chat top bar — mimics the real WhatsApp / Instagram conversation header */}
            <div className={`flex items-center gap-2 px-3 py-2 shrink-0 ${simIg ? "bg-white border-b border-line" : "bg-[#075e54]"}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${simIg ? "bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#962fbf] text-white" : "bg-white/20 text-white"}`}>{simIg ? "@" : "B"}</div>
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${simIg ? "text-ink-900" : "text-white"}`}>{name.trim() || "Your business"}</p>
                <p className={`text-[10px] ${simIg ? "text-ink-400" : "text-white/70"}`}>{simIg ? "Instagram · Active now" : "online"}</p>
              </div>
            </div>
            {/* Conversation thread */}
            <div className={`flex-1 overflow-y-auto p-3 space-y-1.5 ${simIg ? "bg-white" : "bg-[#e5ddd5]"}`}>
              {simLog.length === 0 && <p className="text-xs text-ink-400 text-center pt-8">Type a trigger keyword to start the flow — it saves automatically before each test.</p>}
              {simLog.map((m, i) => {
                const you = m.who === "you";
                const bubble = simIg
                  ? (you ? "bg-[#3797f0] text-white rounded-2xl rounded-br-md ml-auto" : "bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md")
                  : (you ? "bg-[#dcf8c6] text-slate-900 rounded-lg rounded-tr-sm ml-auto" : "bg-white text-slate-900 rounded-lg rounded-tl-sm");
                return (
                  <div key={i} className="space-y-1">
                    <div className={`max-w-[85%] px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words shadow-sm ${bubble}`}>{m.text}</div>
                    {m.options && (
                      <div className="flex flex-col items-start gap-1 max-w-[85%]">
                        {m.options.map(o => <button key={o} onClick={() => simulate(o)} className={simIg
                          ? "px-3 py-1 rounded-full border border-[#3797f0] text-[#3797f0] bg-white text-[11px] font-semibold"
                          : "w-full px-3 py-1.5 rounded-lg bg-white border border-line text-[#075e54] text-[11px] font-semibold text-center shadow-sm"}>{o}</button>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Composer */}
            <div className={`p-2 flex items-center gap-2 shrink-0 ${simIg ? "bg-white border-t border-line" : "bg-[#f0f0f0]"}`}>
              <input className="flex-1 border border-line rounded-full px-3 py-2 text-xs bg-white text-ink-900 placeholder:text-ink-400" placeholder="Type as the customer…" value={simInput}
                onChange={e => setSimInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && simInput.trim()) simulate(simInput.trim()); }} />
              <button onClick={() => simInput.trim() && simulate(simInput.trim())} title="Send" className={`w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 ${simIg ? "bg-[#3797f0]" : "bg-[#25d366]"}`}><Send className="w-4 h-4" /></button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ReactFlowProvider>
      <Editor flowId={id} />
    </ReactFlowProvider>
  );
}
