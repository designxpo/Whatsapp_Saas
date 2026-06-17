export const maxDuration = 60;
import { NextResponse } from "next/server";
import { handleFlowMessage, endSession, drySender, getFlow, type SimOutput } from "@/lib/flowengine";
import { matchFaq } from "@/lib/router/faq";
import { cacheLookup } from "@/lib/router/cache";
import { routerEnabled } from "@/lib/router";
import { generateReply, applyPersonaTone } from "@/lib/llm";
import { resolveAgent } from "@/lib/aihub";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — dry-run one inbound message against this flow (works while inactive).
// Mirrors production end-to-end: if the flow doesn't consume the message, the
// same fallback chain answers it (FAQ → semantic cache → AI agent + RAG), so
// the simulator shows exactly what the customer would receive.
// Body: { message, reset? }. Sessions are keyed sim:<flowId> — nothing is sent
// to WhatsApp and no real conversations are touched.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { message?: string; reset?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const convKey = `sim:${id}`;
  try {
    if (body.reset) await endSession(convKey);
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ outputs: [], handled: false, note: body.reset ? "Simulator reset." : "message required" });

    const outputs: SimOutput[] = [];
    const handled = await handleFlowMessage(convKey, "910000000000", message, {
      sender: drySender(outputs),
      onlyFlowId: id,
      allowInactive: true,
      tenantId: (await currentTenantId()) ?? DEFAULT_TENANT_ID,
    });
    if (handled) return NextResponse.json({ outputs, handled, note: null });

    // Flow didn't consume it — answer like production would.
    try {
      const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
      if (routerEnabled()) {
        const faqHit = matchFaq(message);
        if (faqHit) {
          return NextResponse.json({ outputs: [{ kind: "ai", body: await applyPersonaTone(faqHit.faq.detailedAnswer, message, null, tid) }], handled: false, note: "Answered by the FAQ router (persona-toned)" });
        }
        const { hit } = await cacheLookup(message, null, tid).catch(() => ({ hit: null }));
        if (hit) {
          return NextResponse.json({ outputs: [{ kind: "ai", body: await applyPersonaTone(hit.answer, message, null, tid) }], handled: false, note: "Answered from the semantic cache (persona-toned)" });
        }
      }
      const agent = await resolveAgent(null, tid).catch(() => null);
      const flow = await getFlow(id, tid).catch(() => null);
      const result = await generateReply([{ role: "user", body: message }], undefined, null, tid, flow?.primaryKbTag ?? null);
      if (result.reply) {
        return NextResponse.json({ outputs: [{ kind: "ai", body: result.reply }], handled: false, note: `Answered by the AI assistant${agent ? ` (${agent.name})` : ""}` });
      }
      return NextResponse.json({ outputs: [{ kind: "ai", body: "(escalated to a human — no confident answer)" }], handled: false, note: `AI escalated: ${result.reason ?? ""}` });
    } catch (e) {
      return NextResponse.json({ outputs: [], handled: false, note: `Flow did not consume this message; AI preview unavailable (${errorMessage(e)})` });
    }
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
