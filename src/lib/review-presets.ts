// Reply presets by kind of business. Each is a starting point the owner edits:
// what the business is, what replies should and shouldn't say for that trade.
// Pure and client-safe — the settings screen and the AI prompt both read it.

export type BusinessType = "restaurant" | "salon" | "gym" | "clinic" | "education" | "retail" | "hotel" | "services" | "other";
export type ReplyLanguage = "match" | "en" | "hi" | "hinglish";

export interface BusinessPreset { label: string; describe: string; guidance: string }

export const BUSINESS_PRESETS: Record<BusinessType, BusinessPreset> = {
  restaurant: {
    label: "Restaurant or café",
    describe: "e.g. A family restaurant in Indiranagar serving North Indian and Mughlai food, dine-in and delivery.",
    guidance: "Mention the specific dish or moment they enjoyed. For complaints about food, wait times or hygiene, apologise without arguing and ask them to contact us privately so the manager can look into it. Never promise free meals or discounts in public.",
  },
  salon: {
    label: "Salon, spa or wellness",
    describe: "e.g. A unisex salon offering haircuts, colour, skin and nail care.",
    guidance: "Thank them for the specific service and, if named, the stylist or therapist. For any reaction, burn or injury, express concern and ask them to contact us privately straight away. Never discuss treatments or skin conditions in public.",
  },
  gym: {
    label: "Gym or fitness centre",
    describe: "e.g. A 24-hour gym with personal training and group classes.",
    guidance: "Acknowledge their training goals or the trainer they mention. For membership, billing or refund concerns, invite them to the front desk or a private message. Never comment on anyone's body, health or results in public.",
  },
  clinic: {
    label: "Clinic or professional practice",
    describe: "e.g. A dental clinic offering general and cosmetic dentistry.",
    guidance: "Keep replies general and respectful. Never confirm that the reviewer is a patient, and never mention a diagnosis, treatment, appointment or any health detail. For concerns, invite them to contact the clinic directly so it can be handled privately.",
  },
  education: {
    label: "Coaching centre or education",
    describe: "e.g. A coaching institute for JEE and NEET preparation.",
    guidance: "Thank them for feedback about teaching, faculty or results. Never share marks, ranks or details about any student. For fee or refund questions, invite them to contact the office privately.",
  },
  retail: {
    label: "Retail shop",
    describe: "e.g. A store selling home décor and gifts, in-store and online.",
    guidance: "Mention the product or service they liked. For defects, returns or billing, apologise and invite them to contact the store with their bill so the team can help. Never promise a refund or replacement in public.",
  },
  hotel: {
    label: "Hotel or hospitality",
    describe: "e.g. A 40-room boutique hotel near the airport.",
    guidance: "Thank them for staying and echo what they enjoyed (the room, the staff, the breakfast). For cleanliness, noise or billing issues, apologise and invite them to contact the front office privately. Never mention room numbers, dates or booking details.",
  },
  services: {
    label: "Consultant or professional service",
    describe: "e.g. A chartered accountancy firm handling tax filing and audits.",
    guidance: "Keep the tone professional. Never confirm client relationships or discuss any matter, document or fee in public. Invite concerns to a private email or call.",
  },
  other: {
    label: "Other",
    describe: "Describe what the business does and who its customers are.",
    guidance: "Reply to what the review actually says. Invite anything that needs details to a private conversation.",
  },
};

export const BUSINESS_TYPES = Object.keys(BUSINESS_PRESETS) as BusinessType[];
export const isBusinessType = (v: unknown): v is BusinessType => typeof v === "string" && v in BUSINESS_PRESETS;

export const LANGUAGE_LABELS: Record<ReplyLanguage, string> = {
  match: "Match the review's language",
  en: "English",
  hi: "Hindi",
  hinglish: "Hinglish (Hindi in Roman letters, mixed with English)",
};
export const isReplyLanguage = (v: unknown): v is ReplyLanguage => typeof v === "string" && v in LANGUAGE_LABELS;

/** The instruction the AI gets for the reply language. Pure. */
export function languageRule(lang: ReplyLanguage): string {
  switch (lang) {
    case "en": return "Write the reply in English.";
    case "hi": return "Write the reply in Hindi (Devanagari script).";
    case "hinglish": return "Write the reply in Hinglish: Hindi words in Roman letters mixed naturally with English, the way people text in India.";
    default: return "Write the reply in the same language and script as the review (English, Hindi, or Hinglish in Roman letters). If unsure, use English.";
  }
}
