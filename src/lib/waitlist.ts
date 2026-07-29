// Pre-launch waitlist — prospects who left their details + desired plan on the
// marketing site. Created publicly (no auth) via /api/waitlist; read + managed
// by the platform owner in the Owner Portal. NOT tenant-scoped (prospects).

import { db } from "./supabase";

export type WaitlistStatus = "new" | "contacted" | "converted" | "archived";
export const WAITLIST_STATUSES: WaitlistStatus[] = ["new", "contacted", "converted", "archived"];

export interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  plan: string | null;
  channels: string[];
  message: string | null;
  source: string;
  status: WaitlistStatus;
  createdAt: string;
  updatedAt: string;
}

function mapEntry(r: Record<string, unknown>): WaitlistEntry {
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    email: (r.email as string) ?? "",
    phone: (r.phone as string | null) ?? null,
    company: (r.company as string | null) ?? null,
    plan: (r.plan as string | null) ?? null,
    channels: Array.isArray(r.channels) ? (r.channels as string[]) : [],
    message: (r.message as string | null) ?? null,
    source: (r.source as string) ?? "marketing",
    status: ((r.status as WaitlistStatus) ?? "new"),
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? (r.created_at as string),
  };
}

export interface WaitlistInput {
  name?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  plan?: string | null;
  channels?: string[];
  message?: string | null;
  source?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public create — validates lightly and caps field lengths (untrusted input).
// Returns null when the payload is unusable (no valid email or name).
export async function createWaitlistEntry(input: WaitlistInput): Promise<WaitlistEntry | null> {
  const email = (input.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = (input.name ?? "").trim().slice(0, 120);
  if (!EMAIL_RE.test(email) || !name) return null;
  const row = {
    name,
    email,
    phone: (input.phone ?? "").toString().trim().slice(0, 40) || null,
    company: (input.company ?? "").toString().trim().slice(0, 160) || null,
    plan: (input.plan ?? "").toString().trim().slice(0, 60) || null,
    channels: (Array.isArray(input.channels) ? input.channels : []).map(c => String(c).trim().slice(0, 40)).filter(Boolean).slice(0, 10),
    message: (input.message ?? "").toString().trim().slice(0, 2000) || null,
    source: (input.source ?? "marketing").toString().trim().slice(0, 40) || "marketing",
    status: "new",
  };
  const { data, error } = await db().from("wa_waitlist").insert(row).select().single();
  if (error) throw error;
  return mapEntry(data as Record<string, unknown>);
}

export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const { data } = await db().from("wa_waitlist").select("*").order("created_at", { ascending: false }).limit(1000);
  return (data ?? []).map(r => mapEntry(r as Record<string, unknown>));
}

export async function updateWaitlistStatus(id: string, status: WaitlistStatus): Promise<void> {
  const { error } = await db().from("wa_waitlist").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteWaitlistEntry(id: string): Promise<void> {
  const { error } = await db().from("wa_waitlist").delete().eq("id", id);
  if (error) throw error;
}
