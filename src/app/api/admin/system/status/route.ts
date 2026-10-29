import { NextResponse } from "next/server";
import { countContacts, listDocuments, listConversations } from "@/lib/store";
import { verifyLsq } from "@/lib/leadsquared";
import { routerEnabled } from "@/lib/router";
import { faqCount } from "@/lib/router/faq";
import { currentTenantId, isPlatformOwner, DEFAULT_TENANT_ID } from "@/lib/auth";

export const dynamic = "force-dynamic";

const isReal = (v: string | undefined) => Boolean(v && v !== "test" && v !== "test-verify" && v !== "test-secret");

// GET — the Home tab's counts and router state for everyone, and for the
// platform owner alone the "is the platform set up?" checklist on /admin/setup.
//
// The checklist describes the PLATFORM's configuration — its environment
// variables by name, its Meta and Gemini credentials — so a business on it has
// no use for it and should not see it. What Home reads (counts, router) stays
// in every answer: leaving router out once crashed the portal for everyone who
// was not the owner.
export async function GET() {
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const owner = await isPlatformOwner().catch(() => false);
  // Light health probes — each independent, none may throw the whole route.
  const [dbOk, kbDocs, convs] = await Promise.all([
    countContacts(tid).then(n => ({ ok: true, contacts: n })).catch(() => ({ ok: false, contacts: 0 })),
    listDocuments(tid).catch(() => []),
    listConversations({ limit: 200, tenantId: tid }).catch(() => []),
  ]);
  const counts = {
    contacts: dbOk.contacts,
    kbDocuments: kbDocs.length,
    conversations: convs.length,
    needsAttention: convs.filter(c => c.status === "escalated").length,
  };
  const router = { enabled: routerEnabled(), faqEntries: faqCount() };
  if (!owner) return NextResponse.json({ counts, router });

  const readyDocs = kbDocs.filter(d => d.status === "ready");
  const lsq = await verifyLsq(tid).catch(() => ({ ok: false, detail: "LeadSquared health check failed." }));
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
      ok: lsq.ok,
      label: "LeadSquared CRM (optional)",
      detail: lsq.detail,
    },
  };

  const required = [steps.database, steps.ai, steps.knowledge, steps.whatsapp, steps.webhook];
  return NextResponse.json({
    steps,
    completed: required.filter(s => s.ok).length,
    totalRequired: required.length,
    live: required.every(s => s.ok),
    router,
    counts,
  });
}
