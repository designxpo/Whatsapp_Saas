import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { runChat, type ChatTool, type ChatTurn } from "@/lib/ai/chat";
import { resolveTenantAi, AiKeyMissingError } from "@/lib/ai/keys";
import { planAdCampaign, type AdGoal } from "@/lib/adplanner";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Conversational Meta-ads builder. The client chats; the assistant gathers the
// brief and, when it has enough, calls draft_campaign — which runs the SAME
// planAdCampaign drafter the form uses and returns a plan. The client then
// finishes on the visual review screen (image + previews + explicit publish), so
// this endpoint NEVER touches Meta or spends money.

const DRAFT_TOOL: ChatTool = {
  name: "draft_campaign",
  description: "Draft the Meta ad campaign. Call this ONLY once you know: the goal, what they're advertising, the total budget, and how many days to run. Fill the rest with sensible defaults if unstated.",
  params: [
    { name: "goal", description: "Where the ad sends people: WHATSAPP (WhatsApp chats), MESSENGER (Facebook Messenger chats), or WEBSITE (a landing page)." },
    { name: "product", description: "What they're advertising / the offer, in one sentence." },
    { name: "brief", description: "If the user pasted or uploaded a fuller brief, put its full relevant text here so the copywriter can use every detail (offer, tone, audience, structure)." },
    { name: "budgetTotal", description: "Total budget as a plain number in major units, e.g. 5000." },
    { name: "days", description: "How many days to run, as a plain number." },
    { name: "countries", description: "Comma-separated ISO country codes to target, e.g. IN,US. Default IN." },
    { name: "variants", description: "How many ad sets / audiences to test, 1-10. Default 1." },
    { name: "creativeFormat", description: "The ad creative type: single (one image), carousel (multiple cards), or video (video/reel). Default single. If the user's brief or message specifies one, use it." },
    { name: "websiteUrl", description: "For the WEBSITE goal only: the landing page URL." },
    { name: "audienceNote", description: "Optional free-text audience hint from the user." },
  ],
  required: ["goal", "product", "budgetTotal", "days"],
};

const SYSTEM = [
  "You are a friendly Meta (Facebook/Instagram) ads assistant helping a business owner set up an ad campaign by chatting.",
  "Learn, through short natural questions, what you need: the GOAL (WhatsApp chats / Messenger chats / website visits), WHAT they're advertising, their TOTAL BUDGET and how many DAYS to run, which COUNTRIES, and whether they want to test MULTIPLE audiences (ad sets).",
  "Ask only for what's still missing — one or two things at a time, never a long interrogation. Suggest sensible defaults (countries: India; audiences: 1) and move on.",
  "As SOON as you know the goal, what they're advertising, a budget, and a duration, CALL the draft_campaign function — do not keep asking for nice-to-haves. For the WEBSITE goal you also need the landing-page URL.",
  "Keep every reply to 1-3 short sentences. Never invent performance numbers, reach, or results.",
].join("\n");

const NAME_TO_ISO: Record<string, string> = {
  india: "IN", "united states": "US", usa: "US", us: "US", uk: "GB", "united kingdom": "GB", britain: "GB",
  uae: "AE", "united arab emirates": "AE", canada: "CA", australia: "AU", singapore: "SG", "saudi arabia": "SA", ksa: "SA",
};
function toIso(list: string): string[] {
  const out = list.split(/[,;/]+/).map(s => s.trim()).filter(Boolean).map(s => {
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
    return NAME_TO_ISO[s.toLowerCase()] ?? "";
  }).filter(Boolean);
  return out.length ? Array.from(new Set(out)) : ["IN"];
}
function toGoal(v: unknown): AdGoal {
  const s = String(v ?? "").toUpperCase();
  return s === "MESSENGER" || s === "WEBSITE" ? s : "WHATSAPP";
}
function toFormat(v: unknown): "single" | "carousel" | "video" {
  const s = String(v ?? "").toLowerCase();
  return s === "carousel" || s === "video" ? s : "single";
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let b: { messages?: { role?: string; content?: string }[]; currency?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const history = Array.isArray(b.messages) ? b.messages.filter(m => m?.content?.trim()).slice(-20) : [];
  if (!history.length) return NextResponse.json({ error: "Say what you'd like to advertise to get started." }, { status: 400 });

  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const currency = (b.currency || "INR").toUpperCase();
    let ai;
    try { ai = await resolveTenantAi(tid); }
    catch (err) {
      if (err instanceof AiKeyMissingError) return NextResponse.json({ reply: "Add your AI key first (AI Hub) so I can help draft the campaign." });
      throw err;
    }

    const turns: ChatTurn[] = history.map(m => (m.role === "assistant" ? { role: "assistant", text: m.content!.trim() } : { role: "user", text: m.content!.trim() }));
    const res = await runChat({ provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system: SYSTEM, turns, tools: [DRAFT_TOOL], maxTokens: 700 });

    const call = res.toolCalls.find(c => c.name === "draft_campaign");
    if (call) {
      const a = call.args as Record<string, unknown>;
      const goal = toGoal(a.goal);
      const plan = await planAdCampaign({
        goal,
        product: String(a.product ?? "").trim() || "our offer",
        brief: a.brief ? String(a.brief).trim().slice(0, 8000) : undefined,
        budgetTotal: Number(String(a.budgetTotal ?? "").replace(/[^0-9.]/g, "")) || 0,
        days: Number(String(a.days ?? "").replace(/[^0-9]/g, "")) || 7,
        currency,
        countries: toIso(String(a.countries ?? "IN")),
        variants: Number(String(a.variants ?? "1").replace(/[^0-9]/g, "")) || 1,
        creativeFormat: toFormat(a.creativeFormat),
        websiteUrl: a.websiteUrl ? String(a.websiteUrl).trim() : undefined,
        audienceNote: a.audienceNote ? String(a.audienceNote).trim() : undefined,
      }, tid);
      const reply = `Done — I've drafted "${plan.campaignName}": ${plan.adSets.length} ad set${plan.adSets.length === 1 ? "" : "s"}, ${currency} ${plan.dailyBudget}/day for ${plan.days} days. Review it, add an image, and publish on the panel that just opened. 👉`;
      return NextResponse.json({ reply, plan });
    }

    return NextResponse.json({ reply: (res.text || "Could you tell me a bit more?").trim() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
