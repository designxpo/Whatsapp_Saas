// Conversation Memory — Layer 3 of the Knowledge Router. Per-conversation,
// server-side (wa_conversations.memory jsonb). Resolves follow-ups ("tell me
// more", "more details") without invoking RAG, and feeds the FAQ matcher a
// category boost so short topical follow-ups stay on-topic.

import { db } from "@/lib/supabase";
import { getFaqById, type FaqEntry } from "./faq";

export interface ConvMemory {
  lastFaqId?: number;
  lastCategory?: string;
  lastIntent?: string;
  lastAwayAt?: string;   // last time the away-message was sent (webhook dedup)
  updatedAt?: string;
}

const FOLLOW_UP_RE = /^\s*(tell me more|more details?|more info(rmation)?|elaborate|explain( more)?|go on|continue|details?( please)?|and then|what else|anything else|aur batao|aur bata|ok( tell me)?( more)?)\s*[?.!]*\s*$/i;

export async function loadMemory(conversationId: string): Promise<ConvMemory> {
  const { data } = await db().from("wa_conversations").select("memory").eq("id", conversationId).maybeSingle();
  return ((data?.memory as ConvMemory) ?? {});
}

export async function saveMemory(conversationId: string, mem: ConvMemory): Promise<void> {
  try {
    await db().from("wa_conversations")
      .update({ memory: { ...mem, updatedAt: new Date().toISOString() } })
      .eq("id", conversationId);
  } catch (e) {
    console.error("[router] saveMemory failed:", e);
  }
}

// Resolve a pure follow-up against the last matched FAQ.
export function resolveFollowUp(message: string, mem: ConvMemory): FaqEntry | null {
  if (!FOLLOW_UP_RE.test(message)) return null;
  if (!mem.lastFaqId) return null;
  return getFaqById(mem.lastFaqId) ?? null;
}
