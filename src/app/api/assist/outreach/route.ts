import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { generateOutreachOpener } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call

// POST /api/assist/outreach — draft a SHORT private-DM opener for a lead the
// tenant found themselves (e.g. the browser extension's "Find leads" page scan
// on Reddit/X/LinkedIn/Discord). The tenant copies and sends it themselves in
// that platform's own DM UI — nothing is sent from here. Grounded ONLY in the
// supplied text; never invents facts or pitches a product in the opener.
// Auth: Authorization: Bearer <ak_live_… key>.
//
// Body: { text, author?, platform?, category? }
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  let body: { text?: string; author?: string; platform?: string; category?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "text too long" }, { status: 400 });

  try {
    const opener = await generateOutreachOpener(
      { text, author: body.author, platform: body.platform, category: body.category },
      tenantId,
    );
    return NextResponse.json({ opener });
  } catch (err) {
    const busy = err instanceof Error && /AI_BUSY/.test(err.message);
    const msg = err instanceof AiKeyMissingError ? "AI isn't configured for this workspace."
      : busy ? "AI is busy right now (model overloaded) — try again."
      : "Could not draft an opener.";
    return NextResponse.json({ error: msg }, { status: busy ? 503 : 500 });
  }
}
