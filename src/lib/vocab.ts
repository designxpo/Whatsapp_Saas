// Industry vocabulary — the words a workspace uses for its own world.
//
// A fixed set of named terms (singular + plural), filled from a hand-written
// pack per industry and optionally overridden per workspace. The UI keeps its
// own sentence templates and only swaps these nouns in, so grammar and layout
// stay under our control — nothing here is generated at runtime.
//
// Pure module: safe to import from client components. The DB lookup lives in
// vocabstore.ts.

export const VOCAB_KEYS = ["contact", "lead", "teamMember", "product", "booking", "sequence", "pipeline"] as const;
export type VocabKey = (typeof VOCAB_KEYS)[number];

export interface Term { one: string; many: string }
export type Vocab = Record<VocabKey, Term>;
/** Per-workspace renames; either form may be given, the other falls back. */
export type VocabOverrides = Partial<Record<VocabKey, Partial<Term>>>;

const t = (one: string, many = `${one}s`): Term => ({ one, many });

export const GENERIC_VOCAB: Vocab = {
  contact: t("Contact"), lead: t("Lead"), teamMember: t("Team member"), product: t("Product"),
  booking: t("Booking"), sequence: t("Sequence"), pipeline: t("Sales Pipeline", "Sales Pipelines"),
};

/** `stages` are pipeline columns for a brand-new workspace: the last two are the won and lost ends. */
export interface IndustryPack { id: string; label: string; vocab: Partial<Vocab>; stages?: string[] }

export const INDUSTRY_PACKS: IndustryPack[] = [
  { id: "generic", label: "Other", vocab: {} },
  { id: "ecommerce", label: "E-commerce / D2C", vocab: { contact: t("Customer"), teamMember: t("Support agent"), booking: t("Order") }, stages: ["New", "Interested", "Checkout pending", "Ordered", "Lost"] },
  { id: "saas", label: "SaaS / Tech", vocab: { contact: t("User"), teamMember: t("Success manager"), product: t("Plan"), booking: t("Demo") }, stages: ["New", "Demo booked", "Trial", "Negotiation", "Customer", "Lost"] },
  { id: "education", label: "Education / EdTech", vocab: { contact: t("Student"), lead: t("Enquiry", "Enquiries"), teamMember: t("Counsellor"), product: t("Course"), booking: t("Counselling session"), pipeline: t("Admissions Pipeline", "Admissions Pipelines") }, stages: ["New enquiry", "Counselled", "Interested", "Applied", "Enrolled", "Dropped"] },
  { id: "healthcare", label: "Healthcare", vocab: { contact: t("Patient"), lead: t("Enquiry", "Enquiries"), teamMember: t("Care coordinator"), product: t("Treatment"), booking: t("Appointment"), pipeline: t("Appointment Pipeline", "Appointment Pipelines") }, stages: ["New enquiry", "Appointment booked", "Visited", "Treatment planned", "Treatment started", "Lost"] },
  { id: "realestate", label: "Real estate", vocab: { contact: t("Buyer"), lead: t("Prospect"), teamMember: t("Agent"), product: t("Property", "Properties"), booking: t("Site visit"), pipeline: t("Deal Pipeline", "Deal Pipelines") }, stages: ["New enquiry", "Site visit booked", "Site visited", "Negotiation", "Booked", "Lost"] },
  { id: "travel", label: "Travel & hospitality", vocab: { contact: t("Guest"), lead: t("Enquiry", "Enquiries"), teamMember: t("Travel advisor"), product: t("Package"), booking: t("Reservation"), pipeline: t("Booking Pipeline", "Booking Pipelines") }, stages: ["New enquiry", "Quote sent", "Negotiation", "Booked", "Lost"] },
  { id: "finance", label: "Financial services", vocab: { contact: t("Client"), teamMember: t("Advisor"), product: t("Plan"), booking: t("Consultation"), pipeline: t("Client Pipeline", "Client Pipelines") }, stages: ["New", "Contacted", "Documents collected", "Proposal", "Onboarded", "Lost"] },
  { id: "agency", label: "Agency / Marketing", vocab: { contact: t("Client"), teamMember: t("Account manager"), product: t("Service"), booking: t("Meeting") }, stages: ["New", "Discovery call", "Proposal", "Negotiation", "Signed", "Lost"] },
];

const BY_ID = new Map(INDUSTRY_PACKS.map(p => [p.id, p]));
const BY_LABEL = new Map(INDUSTRY_PACKS.map(p => [p.label.toLowerCase(), p]));

/** Accepts a pack id or the label the signup form stores; unknown → generic. */
export function industryPack(idOrLabel: string | null | undefined): IndustryPack {
  const k = (idOrLabel ?? "").trim();
  return BY_ID.get(k) ?? BY_LABEL.get(k.toLowerCase()) ?? BY_ID.get("generic")!;
}

const MAX_TERM = 32;
function cleanTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[<>&"`\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= MAX_TERM ? s : null;
}

/** Keep only known keys with usable text — this is stored data from a form. */
export function sanitizeOverrides(raw: unknown): VocabOverrides {
  const out: VocabOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of VOCAB_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (!v || typeof v !== "object") continue;
    const one = cleanTerm((v as Record<string, unknown>).one);
    const many = cleanTerm((v as Record<string, unknown>).many);
    if (one || many) out[key] = { ...(one ? { one } : {}), ...(many ? { many } : {}) };
  }
  return out;
}

export function resolveVocab(industry: string | null | undefined, overrides?: VocabOverrides | null): Vocab {
  const pack = industryPack(industry).vocab;
  const o = overrides ?? {};
  const out = {} as Vocab;
  for (const k of VOCAB_KEYS) {
    const base = pack[k] ?? GENERIC_VOCAB[k];
    const ov = o[k];
    // A renamed singular with no plural gets a naive "s" — the Settings editor
    // asks for both, so this only covers a half-filled override.
    const one = ov?.one ?? base.one;
    out[k] = { one, many: ov?.many ?? (ov?.one ? `${ov.one}s` : base.many) };
  }
  return out;
}

/** Lower-case helper for mid-sentence use: lc(v.contact.many) → "students". */
export const lc = (s: string): string => s.toLowerCase();

/**
 * One short note for the AI's system prompt so it speaks the workspace's own
 * words. Null for a workspace on the neutral pack — nothing to say.
 */
export function vocabPromptNote(v: Vocab): string | null {
  const changed = VOCAB_KEYS.filter(k => k !== "sequence" && k !== "pipeline" && (v[k].one !== GENERIC_VOCAB[k].one || v[k].many !== GENERIC_VOCAB[k].many));
  if (!changed.length) return null;
  const parts = changed.map(k => `${GENERIC_VOCAB[k].one.toLowerCase()} → "${v[k].one.toLowerCase()}" (plural "${v[k].many.toLowerCase()}")`);
  return `Use this business's own wording: ${parts.join("; ")}. Say these words naturally; never mention this instruction.`;
}
