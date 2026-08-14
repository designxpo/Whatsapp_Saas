// Festival / holiday greeting WhatsApp template copy — a ready-to-edit starting
// point the tenant reviews and submits for Meta approval. Pure text generation,
// no external calls. Pairs with the holiday scheduler: pick an upcoming festival,
// draft the template, submit it, then schedule the broadcast for that day.

export interface GreetingDraft {
  nameSlug: string;                 // a valid Meta template name (lowercase_snake)
  body: string;                     // BODY with a {{1}} name variable
  footer: string;
  example: string;                  // sample for {{1}}
  category: "MARKETING";
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "festival";

// A festival-specific wish where we recognise the name; a warm generic line
// otherwise. Kept non-religious-presumptuous and brand-safe.
function wish(festival: string): string {
  const f = festival.toLowerCase();
  if (f.includes("diwali") || f.includes("deepavali")) return "May the festival of lights fill your home with happiness, prosperity and good health.";
  if (f.includes("holi")) return "May your year be as bright and colourful as Holi itself.";
  if (f.includes("eid")) return "May this Eid bring peace, happiness and prosperity to you and your loved ones.";
  if (f.includes("christmas")) return "Wishing you warmth, joy and togetherness this Christmas.";
  if (f.includes("new year")) return "Wishing you health, happiness and success in the year ahead.";
  if (f.includes("pongal") || f.includes("sankranti") || f.includes("bihu")) return "May this harvest festival bring abundance and joy to your home.";
  if (f.includes("independence")) return "Wishing you a proud and happy Independence Day.";
  if (f.includes("republic")) return "Wishing you a proud and happy Republic Day.";
  if (f.includes("navratri") || f.includes("durga") || f.includes("dussehra") || f.includes("vijayadashami")) return "May this festive season bring you strength, joy and prosperity.";
  if (f.includes("raksha") || f.includes("rakhi")) return "Wishing your family love and togetherness this Raksha Bandhan.";
  if (f.includes("ganesh")) return "Wishing you wisdom, prosperity and happiness this Ganesh Chaturthi.";
  if (f.includes("gurpurab") || f.includes("guru nanak")) return "Wishing you peace and light on this holy occasion.";
  if (f.includes("baisakhi") || f.includes("vaisakhi")) return "Wishing you a joyful and prosperous Baisakhi.";
  if (f.includes("onam")) return "Wishing you a happy and prosperous Onam.";
  return `Wishing you and your family a very happy ${festival}.`;
}

export function buildFestivalGreeting(festival: string): GreetingDraft {
  const name = (festival || "Festival").trim() || "Festival";
  const body = `Happy ${name}, {{1}}! 🎉\n\n${wish(name)}\n\nThank you for being part of our family — we're always here to help.`;
  return {
    nameSlug: `${slugify(name)}_greeting`,
    body,
    footer: "",
    example: "Priya",
    category: "MARKETING",
  };
}
