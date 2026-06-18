"use client";

// Shared surface for the admin dashboard — extracted from the former
// 8.3k-line page.tsx so each tab can live in its own lazy-loaded module
// (src/app/admin/_tabs/*) while still sharing these primitives. Logic is
// unchanged; this is a pure relocation.

import { useState, useEffect } from "react";
import { Loader2, UploadCloud, ArrowRight } from "lucide-react";

export { DEFAULT_TENANT_ID } from "@/lib/tenant";

// The set of dashboard tabs (sidebar keys). The shell owns the active-tab state
// and passes `goTo` to tabs for cross-tab navigation.
export type Tab = "home" | "livechat" | "broadcast" | "ads" | "instagram" | "assistant" | "flows" | "sequences" | "catalog" | "growth" | "aihub" | "templates" | "forms" | "analytics" | "contacts" | "campaigns" | "optouts" | "settings" | "setup" | "integrations";

// ── Shared style tokens ──────────────────────────────────────────────────────
export const inp = "border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400";
export const btnPrimary = "px-4 py-2 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white text-[13px] font-semibold flex items-center gap-2 transition-colors disabled:opacity-60";
export const railLoading = <Loader2 className="w-4 h-4 animate-spin text-slate-300" />;

// Status pill classes (kb docs, conversations, templates) — shared by the
// Assistant tab and the Live Chat ChatView.
export function statusBadge(s: string): string {
  const map: Record<string, string> = {
    ready: "bg-brand-green/15 text-brand-dark", active: "bg-brand-green/15 text-brand-dark",
    processing: "bg-amber-100 text-amber-700", paused: "bg-slate-100 text-slate-600",
    failed: "bg-red-100 text-red-700", escalated: "bg-red-100 text-red-700",
  };
  return `px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[s] ?? "bg-slate-100 text-slate-600"}`;
}

// ── Multi-number channels (shared across broadcast/templates/forms/ads/etc.) ──
export type ChannelRow = { id: string; kind?: "whatsapp" | "instagram"; name: string; phoneId: string; wabaId: string; igUserId?: string | null; pageId?: string | null; token: string; appId: string | null; agentId: string | null; active: boolean; isDefault: boolean };
let CHANNELS_CACHE: ChannelRow[] | null = null;
export async function loadChannelList(force = false): Promise<ChannelRow[]> {
  if (!CHANNELS_CACHE || force) {
    CHANNELS_CACHE = await fetch("/api/admin/channels").then(r => r.json()).then(d => d.channels ?? []).catch(() => []);
  }
  return CHANNELS_CACHE ?? [];
}
// Keep the shared pickers in sync after a channels mutation (replaces direct
// reassignment of the module-private cache, which ESM imports can't do).
export function setChannelCache(list: ChannelRow[]) { CHANNELS_CACHE = list; }
export function useChannelList() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  useEffect(() => { loadChannelList().then(setChannels); }, []);
  return channels;
}
// Number picker — renders nothing in single-number (env) mode.
export function ChannelSelect({ value, onChange, allLabel, className }: { value: string | null; onChange: (v: string | null) => void; allLabel?: string; className?: string }) {
  const channels = useChannelList();
  if (!channels.length) return null;
  return (
    <select className={className ?? inp} value={value ?? ""} onChange={e => onChange(e.target.value || null)} title="WhatsApp number">
      <option value="">{allLabel ?? "Default number"}</option>
      {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// ── Shared conversation type (live chat / analytics / contacts) ──────────────
export type Conversation = { id: string; phone: string; name?: string | null; status: "active" | "paused" | "escalated"; botEnabled: boolean; lastMessage?: string | null; lastInboundAt?: string | null; lastOutboundAt?: string | null; needsReply?: boolean; labels?: string[]; assignedTo?: string | null; agentId?: string | null; channelId?: string | null; platform?: "whatsapp" | "instagram"; avatarUrl?: string | null; isComment?: boolean };

// Analytics payload — used by both the Analytics tab and the Home/Broadcast rails'
// useAnalytics() hook, so it lives here rather than inside the analytics module.
export type AnalyticsData = {
  contacts: { active: number; optedOut: number; new14d: number };
  campaigns: { total: number; automations: number };
  conversations: { total: number; active: number; escalated: number; needsReply: number; botOn: number; whatsapp: number; instagram: number };
  kb: { documents: number; ready: number };
  messaging: { sentToday: number; totals: { sent: number; delivered: number; read: number; failed: number }; replied14d: number; aiReplies14d: number };
  automation: { flows: number; flowsActive: number; sequences: number; sequencesActive: number; activeEnrollments: number };
  recentCampaigns: { name: string; sent: number; total: number; status: string }[];
  daily: { date: string; sent: number; delivered: number; read: number; failed: number }[];
};

// Analytics fetch hook — used by the Home / Broadcast / Knowledge sidebar rails.
export function useAnalytics(): AnalyticsData | null {
  const [a, setA] = useState<AnalyticsData | null>(null);
  useEffect(() => { fetch("/api/admin/analytics").then(r => r.json()).then(d => setA(d.analytics ?? null)).catch(() => {}); }, []);
  return a;
}

// Flow + AI-Hub types — shared because the Home/Knowledge rails (FlowsRail,
// AiHubRail) render these alongside the Flows / AI-Hub tabs themselves.
export type FlowSummary = { id: string; name: string; active: boolean; platform?: "whatsapp" | "instagram"; triggerKeywords: string[]; updatedAt: string; graph: { nodes: unknown[] } };
export type AiAgentT = { id?: string; name: string; description: string; persona: string; constraintsText: string; productInfo: string; model: string | null; active: boolean; routingKeywords?: string };
export type AiParamT = { name: string; description: string; required: boolean; saveToAttribute: string };
export type AiFunctionT = { id?: string; name: string; description: string; parameters: AiParamT[]; webhookUrl: string | null; escalate: boolean; active: boolean };
export type AiPromptT = { id: string; name: string; prompt: string; active: boolean; sort: number };

// ── Shared mini-components ───────────────────────────────────────────────────
export function ImageUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-sm cursor-pointer ${busy ? "opacity-60" : ""}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Upload
      <input type="file" accept="image/*" className="hidden" onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return; setBusy(true);
        try { const fd = new FormData(); fd.append("file", f); const r = await fetch("/api/upload", { method: "POST", body: fd }); const d = await r.json(); if (d.url) onUploaded(d.url); } finally { setBusy(false); e.currentTarget.value = ""; }
      }} />
    </label>
  );
}

// Avatar that shows the profile image when available, falling back to the
// initial if there's no image or it fails to load (IG image URLs can expire).
export function ConvAvatar({ url, label, size = 36 }: { url?: string | null; label: string; size?: number }) {
  const [err, setErr] = useState(false);
  const initial = (label || "?").slice(0, 1).toUpperCase();
  if (url && !err) return <img src={url} alt="" onError={() => setErr(true)} className="rounded-full object-cover bg-canvas" style={{ width: size, height: size }} />;
  return <div className="rounded-full bg-gradient-to-br from-brand-600 to-brand-900 text-white flex items-center justify-center font-bold shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>{initial}</div>;
}

export function ImgFallback({ url, imgClass, boxClass, icon }: { url: string; imgClass: string; boxClass: string; icon: React.ReactNode }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [url]);
  if (url && !err) return <img src={url} alt="" className={imgClass} onError={() => setErr(true)} />;
  return <div className={boxClass}>{icon}</div>;
}

// ── Sidebar rail primitives (home + per-tab rails) ───────────────────────────
export function RailCard({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-card border border-line p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">{title}</p>
        {action && <button onClick={onAction} className="text-[11px] font-bold text-brand-700 hover:underline flex items-center gap-0.5">{action} <ArrowRight className="w-3 h-3" /></button>}
      </div>
      {children}
    </section>
  );
}

export function StatRow({ label, value, tone, onClick }: { label: string; value: React.ReactNode; tone?: "warn" | "bad"; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`flex items-center justify-between py-0.5 ${onClick ? "cursor-pointer hover:bg-canvas rounded-md px-1 -mx-1" : ""}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-bold ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-ink-900"}`}>{value}</span>
    </div>
  );
}

export function RailBar({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="font-semibold text-ink-700">{label}</span>
        <span className="text-slate-400">{count.toLocaleString()} · {pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-canvas overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}
