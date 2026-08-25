// Pure parsers for Meta WhatsApp inbound / echoed message payloads.
//
// Kept out of the webhook route so they can be tested without standing up the
// route's whole import graph (Supabase, Meta client, LLM, flow engine). No I/O
// here — anything that fetches or stores belongs in the route.

// Parses a WhatsApp form (Flows) submission into { field: answer } pairs.
export function formAnswers(m: Record<string, unknown>): Record<string, string> | null {
  const it = m.interactive as Record<string, unknown> | undefined;
  const nfm = it?.nfm_reply as Record<string, unknown> | undefined;
  if (!nfm?.response_json) return null;
  try {
    const resp = JSON.parse(nfm.response_json as string) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(resp)) {
      if (k === "flow_token" || v === null || v === undefined) continue;
      // Choice fields submit option ids like "1_Data_Science" — strip the index.
      const clean = (s: string) => s.replace(/^\d+_/, "").replaceAll("_", " ");
      out[k] = Array.isArray(v) ? v.map(x => clean(String(x))).join(", ") : clean(String(v));
    }
    return out;
  } catch { return null; }
}

// Extracts readable text from a Meta inbound / echoed message object.
//
// Anything that still returns a BARE "[<type> message]" is a media-only turn
// with no caption: llm.ts swaps that exact shape for "look at the attached
// file", and the Live Chat bubble hides a fully-bracketed body as a non-caption.
// Don't reshape those two without updating both call sites. Every other type
// now yields real content instead of an opaque placeholder — a counselor
// looking at "[unsupported message]" learns nothing about what the lead sent.
export function messageText(m: Record<string, unknown>): string {
  const type = m.type as string;
  const node = (k: string) => m[k] as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // A malformed payload must never throw: the webhook's caller only LOGS the
  // error, so a throw in here silently drops the customer's message.
  const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];

  if (type === "text") return str(node("text")?.body);
  if (type === "button") return str(node("button")?.text);
  if (type === "interactive") {
    const it = node("interactive");
    const answers = formAnswers(m);
    if (answers) {
      const lines = Object.entries(answers).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`);
      return `[form] ${lines.join(" · ") || "submitted"}`;
    }
    const br = (it?.button_reply ?? it?.list_reply) as Record<string, unknown> | undefined;
    return str(br?.title);
  }
  // A tap-react on one of our messages — Meta omits "emoji" when the customer
  // REMOVES their reaction, not just when they add one.
  if (type === "reaction") return str(node("reaction")?.emoji) || "(removed a reaction)";

  // Captioned media: the caption IS the message. Uncaptioned keeps the
  // placeholder so the AI is told to look at the re-hosted file instead.
  if (type === "image" || type === "video" || type === "sticker") {
    return str(node(type)?.caption) || `[${type} message]`;
  }
  // A document's FILENAME is real information and was being discarded —
  // "[document message]" told a counselor nothing about what arrived.
  if (type === "document") {
    const d = node("document");
    const name = str(d?.filename);
    return [str(d?.caption), name && `📄 ${name}`].filter(Boolean).join(" · ") || "[document message]";
  }
  // Replaced by the transcript (or "🎤 Voice note") in handleInbound; this is
  // what a coexistence echo of a counselor's own voice note shows.
  if (type === "audio") return "🎤 Voice note";

  if (type === "location") {
    const l = node("location");
    const lat = l?.latitude, lon = l?.longitude;
    const where = [str(l?.name), str(l?.address)].filter(Boolean).join(", ");
    const pin = lat != null && lon != null ? ` — https://maps.google.com/?q=${lat},${lon}` : "";
    return `📍 ${where || "Location shared"}${pin}`;
  }
  if (type === "contacts") {
    const list = arr(m.contacts).map(c => {
      const nm = str((c.name as Record<string, unknown> | undefined)?.formatted_name);
      const ph = str(arr(c.phones)[0]?.phone);
      return [nm, ph].filter(Boolean).join(" ");
    }).filter(Boolean).join("; ");
    return `👤 Contact shared${list ? `: ${list}` : ""}`;
  }
  if (type === "order") {
    const o = node("order");
    const n = arr(o?.product_items).length;
    return `🛒 Order — ${n} item(s)${str(o?.text) ? `: ${str(o?.text)}` : ""}`;
  }
  // WhatsApp's own notices ("X changed their phone number") already carry a
  // readable sentence; use it rather than "[system message]".
  if (type === "system") return str(node("system")?.body) || "(WhatsApp system notification)";
  if (type === "request_welcome") return "(opened the chat)";

  // An edit of an earlier message. Meta has not settled on one shape here and
  // the coexistence echo differs from inbound, so read every place the new
  // text has been observed instead of betting on one.
  if (type === "edit") {
    const ed = node("edit") ?? node("edited") ?? node("text");
    const body = str(ed?.body) || str(ed?.text) || str(node("text")?.body);
    return body ? `✏️ (edited) ${body}` : "✏️ (edited an earlier message)";
  }

  // Meta could not deliver the original — a poll, view-once media, a newer
  // format. The reason sits in errors[]; surfacing it beats a placeholder that
  // leaves the counselor unable to tell what the lead actually sent.
  if (type === "unsupported") {
    const err = arr(m.errors)[0];
    const why = str(err?.title) || str(err?.message)
      || str((err?.error_data as Record<string, unknown> | undefined)?.details);
    return why ? `⚠️ Unsupported message — ${why}` : "⚠️ WhatsApp couldn't deliver this message type";
  }
  return `[${type} message]`;
}
