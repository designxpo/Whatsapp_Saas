export const maxDuration = 30;
import { NextResponse, after } from "next/server";
import {
  upsertContacts, getOrCreateConversation, appendConvMessage, touchOutbound,
  setBotEnabled, optoutSet,
} from "@/lib/store";
import { sendText, sendTemplateSingle } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { crmAuthorized } from "@/lib/crm";
import { pushWaActivity } from "@/lib/leadsquared";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

// POST — send a WhatsApp message to a lead from the CRM (LeadSquared).
//
// Body: {
//   phone:          string  — lead's phone (any format; digits are extracted)
//   name?:          string  — lead name, used to upsert the contact
//   message?:       string  — free-form text (only valid inside the 24h window)
//   templateName?:  string  — approved template (required when window is closed)
//   templateLang?:  string  — template language code (default "en")
//   templateParams?: string[] — fills {{1}}..{{n}}
//   agent?:         string  — agent name/email, recorded on the thread
//   pauseBot?:      boolean — default true: human took over, stop the AI bot
// }
//
// Inside 24h window  → message is sent as free-form text.
// Outside the window → templateName is required (Meta policy); message is ignored.
export async function POST(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    phone?: string; name?: string; message?: string;
    templateName?: string; templateLang?: string; templateParams?: string[];
    agent?: string; pauseBot?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const phone = (body.phone ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const message = (body.message ?? "").trim();
  const templateName = (body.templateName ?? "").trim();
  if (!message && !templateName) return NextResponse.json({ error: "message or templateName required" }, { status: 400 });

  try {
    // Opt-out suppression — CRM sends must respect STOP too.
    if ((await optoutSet()).has(last10(phone))) {
      return NextResponse.json({ error: "Recipient has opted out", optedOut: true }, { status: 422 });
    }

    await upsertContacts([{ phone, name: body.name ?? "" }], "crm").catch(() => undefined);
    const conv = await getOrCreateConversation(phone, body.name);
    const channel = await credsFor(conv.channelId);    // stay on the chat's number

    const windowOpen = !!conv.lastInboundAt && Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;

    let sent: { id?: string; error?: string };
    let logged: string;
    if (windowOpen && message) {
      sent = await sendText(phone, message, channel);
      logged = message;
    } else if (templateName) {
      sent = await sendTemplateSingle(phone, templateName, body.templateLang || "en", body.templateParams ?? [], channel);
      logged = `[template: ${templateName}]${(body.templateParams ?? []).length ? " " + (body.templateParams ?? []).join(" | ") : ""}`;
    } else {
      return NextResponse.json({
        error: "24h window closed — pass templateName (an approved template) to reach this lead",
        window: "closed",
      }, { status: 422 });
    }

    if (sent.error) return NextResponse.json({ error: sent.error, window: windowOpen ? "open" : "closed" }, { status: 502 });

    const agentTag = (body.agent ?? "").trim();
    const threadBody = agentTag ? `${logged}\n— ${agentTag}` : logged;
    await appendConvMessage({ conversationId: conv.id, role: "assistant", body: threadBody, metaId: sent.id, source: "agent" });
    await touchOutbound(conv.id, logged);

    // A human is talking to this lead now — pause the AI bot unless told otherwise.
    if (body.pauseBot !== false && conv.botEnabled) await setBotEnabled(conv.id, false);

    after(() => pushWaActivity({ phone, direction: "outbound", body: logged, via: "crm" }));

    return NextResponse.json({
      success: true,
      messageId: sent.id,
      conversationId: conv.id,
      window: windowOpen ? "open" : "closed",
      sentAs: windowOpen && message ? "text" : "template",
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
