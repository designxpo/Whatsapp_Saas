// Platform announcements + global banner (owner → all tenants).

import { db } from "./supabase";

export interface Announcement { id: string; title: string; body: string; level: "info" | "success" | "warning"; pinned: boolean; active: boolean; createdAt: string }

function mapA(r: Record<string, unknown>): Announcement {
  return {
    id: r.id as string, title: r.title as string, body: (r.body as string) ?? "",
    level: (r.level as Announcement["level"]) ?? "info", pinned: (r.pinned as boolean) ?? false,
    active: (r.active as boolean) ?? true, createdAt: r.created_at as string,
  };
}

export async function listAnnouncements(): Promise<Announcement[]> {
  const { data } = await db().from("wa_announcements").select("*").order("created_at", { ascending: false });
  return (data ?? []).map(r => mapA(r as Record<string, unknown>));
}

// The single active+pinned banner shown to every tenant (latest wins).
export async function getActiveBanner(): Promise<Announcement | null> {
  try {
    const { data } = await db().from("wa_announcements").select("*").eq("active", true).eq("pinned", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data ? mapA(data as Record<string, unknown>) : null;
  } catch { return null; }
}

export async function saveAnnouncement(p: { id?: string; title: string; body?: string; level?: Announcement["level"]; pinned?: boolean; active?: boolean }): Promise<Announcement> {
  const row = { title: p.title.trim(), body: (p.body ?? "").trim(), level: p.level ?? "info", pinned: p.pinned ?? false, active: p.active ?? true };
  const q = p.id ? db().from("wa_announcements").update(row).eq("id", p.id).select().single()
                 : db().from("wa_announcements").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapA(data as Record<string, unknown>);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await db().from("wa_announcements").delete().eq("id", id);
}
