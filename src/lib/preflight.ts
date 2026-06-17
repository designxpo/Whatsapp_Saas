// Shared template preflight — catches the common "looked like a backend bug but
// was a usage mistake" cases (the carousel lesson) and explains them in plain
// English BEFORE a send hits Meta. Used by broadcasts; the same checks back the
// flow Template node and template builder so the rules stay consistent.

export interface TemplateLike {
  name?: string;
  status?: string;
  components?: { type?: string; format?: string; text?: string; cards?: unknown[] }[];
}

export interface TemplateSupplied {
  bodyParams?: string[];          // values for {{1}}.. in the body
  headerImageUrl?: string | null; // for an image/video/document header
  cards?: unknown[];              // carousel cards (with media) being sent
}

// blocking[] = the send WILL fail at Meta (stop and explain).
// warnings[]  = probably a mistake, but allowed.
// Empty arrays = good to send.
export function templateIssues(
  tpl: TemplateLike | null | undefined,
  supplied: TemplateSupplied = {},
  context: "broadcast" | "flow" = "broadcast",
): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!tpl) { blocking.push("That template wasn't found — pick an approved template."); return { blocking, warnings }; }
  const name = tpl.name ? `"${tpl.name}"` : "This template";

  if (tpl.status && tpl.status !== "APPROVED") {
    blocking.push(`${name} isn't approved yet (status: ${tpl.status}) — only approved templates can be sent.`);
  }

  const comps = tpl.components ?? [];

  // Carousel templates need per-card media, sent via the carousel path.
  if (comps.some(c => c.type === "CAROUSEL")) {
    if (context === "broadcast") {
      blocking.push(`${name} is a carousel template — broadcasts can't send carousel cards. Send it from a chatbot flow's “Carousel template” node (where you set each card's image), or pick a standard template.`);
    } else if ((supplied.cards ?? []).length < 2) {
      blocking.push(`${name} is a carousel template — add at least 2 cards, each with an image or video.`);
    }
    return { blocking, warnings };
  }

  // Body placeholders {{1}}..{{n}} must all be filled.
  const body = comps.find(c => c.type === "BODY")?.text ?? "";
  const need = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), m => Number(m[1])));
  const have = (supplied.bodyParams ?? []).filter(v => (v ?? "").trim()).length;
  if (need.size > have) {
    blocking.push(`${name} needs ${need.size} value${need.size === 1 ? "" : "s"} for its placeholder${need.size === 1 ? "" : "s"} ({{1}}…{{${need.size}}}) — you've filled ${have}.`);
  }

  // Media header needs its link.
  const header = comps.find(c => c.type === "HEADER");
  const fmt = (header?.format ?? "").toUpperCase();
  if (header && (fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT") && !supplied.headerImageUrl?.trim()) {
    blocking.push(`${name} has a ${fmt.toLowerCase()} header — add the ${fmt.toLowerCase()} link before sending.`);
  }

  return { blocking, warnings };
}
