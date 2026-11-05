// Feedback themes — what customers keep mentioning, from their own words.
//
// Deliberately simple and transparent: each theme is a list of words and
// phrases (English, Hindi and Hinglish). A review "mentions" a theme when it
// contains one. Whether the mention is positive or negative is read from the
// review's star rating (4–5 positive, 1–2 negative, 3 mixed) — not guessed —
// and every theme shows how many reviews support it plus real examples. These
// are summaries of what customers said, not verified facts about the business.
// With too few reviews nothing is summarised: no trends from a handful.
// Pure: no I/O.

export interface ThemeDef { key: string; label: string; words: RegExp[] }

export const THEMES: ThemeDef[] = [
  { key: "staff", label: "Staff and service", words: [/\b(staff|waiters?|receptionist|manager|team|owner|behaviou?r|polite|rude|friendly|helpful|attitude|courteous|hospitality|service was)\b/i, /(स्टाफ|व्यवहार|बदतमीज)/] },
  { key: "speed", label: "Waiting and speed", words: [/\b(wait(ed|ing)?|slow|quick(ly)?|fast|late|delay(ed)?|on time|took (an hour|\d+ ?min(ute)?s?)|jaldi|der se)\b/i, /(देर|जल्दी|इंतज़ार|इंतजार)/] },
  { key: "quality", label: "Food, product or treatment quality", words: [/\b(food|taste|tasty|delicious|bland|fresh|stale|quality|product|haircut|treatment|result|dish(es)?|meal|khana|swad|biryani|coffee)\b/i, /(स्वाद|खाना|क्वालिटी)/] },
  { key: "cleanliness", label: "Cleanliness", words: [/\b(clean(liness)?|dirty|hygien(e|ic)|smell(y|s)?|washroom|toilet|filthy|neat|saaf|ganda)\b/i, /(साफ|गंदा|गंदगी)/] },
  { key: "pricing", label: "Price and value", words: [/\b(price[ds]?|pricing|expensive|over-?priced|cheap|affordable|value for money|worth (it|the)|costly|reasonable|mehe?nga|sasta|bill)\b/i, /(महंगा|सस्ता|कीमत|दाम)/] },
  { key: "availability", label: "Booking and availability", words: [/\b(appointments?|booking|booked|slots?|availab(le|ility)|reservations?|waiting list|schedul(e|ing)|walk-?in)\b/i, /(अपॉइंटमेंट|बुकिंग)/] },
  { key: "teaching", label: "Teaching and guidance", words: [/\b(teach(er|ers|ing)|faculty|classes|lectures?|doubts?|notes|mentor|explain(ed|s)?|padhai|sir|ma'?am)\b/i, /(पढ़ाई|शिक्षक|अध्यापक)/] },
  { key: "facilities", label: "Place and facilities", words: [/\b(parking|ambien(c|t)e|seating|a\.?c\.?|air[- ]?condition\w*|music|space|decor|facilit(y|ies)|equipment|wi-?fi|location|interior)\b/i, /(पार्किंग|माहौल)/] },
];

/** At least this many reviews in the period before anything is summarised. */
export const MIN_REVIEWS = 10;
/** A theme is shown only when at least this many reviews mention it. */
export const MIN_MENTIONS = 3;

export interface ThemeReview { id: string; rating: number; text: string; author?: string; date?: string | null }
export interface ThemeExample { id: string; rating: number; author: string; snippet: string; date: string | null }
export interface ThemeResult {
  key: string; label: string;
  mentions: number; positive: number; negative: number; mixed: number;
  examples: { positive: ThemeExample[]; negative: ThemeExample[] };
}
export interface ThemeSummary {
  reviewsRead: number;
  /** Fewer than MIN_REVIEWS reviews with text: nothing is summarised. */
  insufficient: boolean;
  themes: ThemeResult[];
}

/** The sentence (or a slice around it) where the theme is mentioned. */
function snippet(text: string, re: RegExp): string {
  const sentences = text.split(/(?<=[.!?।])\s+/);
  const hit = sentences.find(s => re.test(s)) ?? text;
  return hit.length > 180 ? `${hit.slice(0, 177).trimEnd()}…` : hit;
}

export function summarizeThemes(reviews: ThemeReview[]): ThemeSummary {
  const withText = reviews.filter(r => r.text.trim().length > 0);
  if (withText.length < MIN_REVIEWS) return { reviewsRead: withText.length, insufficient: true, themes: [] };
  const themes: ThemeResult[] = [];
  for (const t of THEMES) {
    const res: ThemeResult = { key: t.key, label: t.label, mentions: 0, positive: 0, negative: 0, mixed: 0, examples: { positive: [], negative: [] } };
    for (const r of withText) {
      const re = t.words.find(w => w.test(r.text));
      if (!re) continue;
      res.mentions++;
      const ex: ThemeExample = { id: r.id, rating: r.rating, author: r.author || "A customer", snippet: snippet(r.text, re), date: r.date ?? null };
      if (r.rating >= 4) { res.positive++; if (res.examples.positive.length < 2) res.examples.positive.push(ex); }
      else if (r.rating >= 1 && r.rating <= 2) { res.negative++; if (res.examples.negative.length < 2) res.examples.negative.push(ex); }
      else res.mixed++;
    }
    if (res.mentions >= MIN_MENTIONS) themes.push(res);
  }
  themes.sort((a, b) => b.mentions - a.mentions);
  return { reviewsRead: withText.length, insufficient: false, themes };
}
