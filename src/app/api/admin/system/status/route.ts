import { NextResponse } from "next/server";
import { countContacts, listDocuments, listConversations } from "@/lib/store";
import { lsqConfigured } from "@/lib/leadsquared";
import { routerEnabled } from "@/lib/router";
import { faqCount } from "@/lib/router/faq";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";

export const dynamic = "force-dynamic";

const isReal = (v: string | undefined) => Boolean(v && v !== "test" && v !== "test-verify" && v !== "test-secret");

// GET — single source of truth for "is the platform set up?". Drives the
// Home tab checklist so a new user can see exactly what works and what's left.
export async function GET() {
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  // Light health probes — each independent, none may throw the whole route.
  const [dbOk, kbDocs, convs] = await Promise.all([
    countContacts(tid).then(n => ({ ok: true, contacts: n })).catch(() => ({ ok: false, contacts: 0 })),
    listDocuments(tid).catch(() => []),
    listConversations({ limit: 200, tenantId: tid }).catch(() => []),
  ]);

  const readyDocs = kbDocs.filter(d => d.status === "ready");
  const steps = {
    database: {
      ok: dbOk.ok,
      label: "Database (Supabase)",
      detail: dbOk.ok ? `Connected — ${dbOk.contacts} contacts` : "Unreachable — check NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY",
    },
    ai: {
      ok: isReal(process.env.GEMINI_API_KEY),
      label: "AI brain (Gemini)",
      detail: isReal(process.env.GEMINI_API_KEY) ? "API key set" : "Add GEMINI_API_KEY (aistudio.google.com/apikey)",
    },
    knowledge: {
      ok: readyDocs.length > 0,
      label: "Knowledge base",
      detail: readyDocs.length > 0 ? `${readyDocs.length} document(s) ready` : "Add at least one document in AI Assistant → Knowledge",
    },
    whatsapp: {
      ok: isReal(process.env.META_WA_ACCESS_TOKEN) && isReal(process.env.META_WA_PHONE_NUMBER_ID),
      label: "WhatsApp (Meta Cloud API)",
      detail: isReal(process.env.META_WA_ACCESS_TOKEN)
        ? "Credentials set"
        : "Add META_WA_ACCESS_TOKEN + PHONE_NUMBER_ID + WABA_ID (SETUP.md §2)",
    },
    webhook: {
      ok: isReal(process.env.META_WA_WEBHOOK_SECRET) && isReal(process.env.META_WA_WEBHOOK_VERIFY_TOKEN),
      label: "Inbound webhook",
      detail: isReal(process.env.META_WA_WEBHOOK_SECRET)
        ? "Secrets set — register /api/webhooks/whatsapp in Meta"
        : "Set META_WA_WEBHOOK_SECRET + VERIFY_TOKEN, then register the URL in Meta",
    },
    crm: {
      ok: lsqConfigured(),
      label: "LeadSquared CRM (optional)",
      detail: lsqConfigured() ? "Timeline sync active" : "Optional — set LSQ_* keys to sync chats to the CRM",
    },
  };

  const required = [steps.database, steps.ai, steps.knowledge, steps.whatsapp, steps.webhook];
  return NextResponse.json({
    steps,
    completed: required.filter(s => s.ok).length,
    totalRequired: required.length,
    live: required.every(s => s.ok),
    router: { enabled: routerEnabled(), faqEntries: faqCount() },
    counts: {
      contacts: dbOk.contacts,
      kbDocuments: kbDocs.length,
      conversations: convs.length,
      needsAttention: convs.filter(c => c.status === "escalated").length,
    },
  });
}
