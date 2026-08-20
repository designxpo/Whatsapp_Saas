// Public changelog — customer-facing entries only. Written from what shipped
// (see git log), but in plain outcome language, not commit messages. Add a
// new entry at the TOP each time something customer-visible ships; don't log
// internal refactors, security patches, or fixes with no visible behavior change.

export type ChangeTag = "New" | "Improved" | "Fixed";
export type ChangeEntry = { tag: ChangeTag; text: string };
export type ChangelogDay = { date: string; title: string; entries: ChangeEntry[] };

export const CHANGELOG: ChangelogDay[] = [
  {
    date: "2026-08-20",
    title: "Talko Copilot Chrome extension",
    entries: [
      { tag: "New", text: "Talko Copilot — a free Chrome extension that puts your WhatsApp, Instagram, Messenger and web-chat inbox in a side panel on any tab, with customer lookup, catalog search, payment links, AI-drafted replies, and one-click lead capture from any webpage. Find it on the Chrome Web Store or from the new Extension page." },
    ],
  },
  {
    date: "2026-08-02",
    title: "Self-serve setup guides",
    entries: [
      { tag: "New", text: "Step-by-step guides for connecting every channel and setting up your AI key and first chatbot flow — no developer needed. Find them under Guides." },
    ],
  },
  {
    date: "2026-07-31",
    title: "Smarter CRM lead source",
    entries: [
      { tag: "Improved", text: "Leads captured from Messenger, Instagram, and website chat now carry the correct channel as their CRM lead source, so your pipeline reports show exactly where each conversation started." },
    ],
  },
  {
    date: "2026-07-30",
    title: "YouTube and Google Reviews automation, plus a reorganized portal",
    entries: [
      { tag: "New", text: "YouTube comment automation — auto-reply to comments on your videos, moderate spam, and let AI take over a thread when someone replies back." },
      { tag: "New", text: "Google Business Profile reviews — AI drafts or auto-posts replies to your reviews, warm for great ones, calm and empathetic for the tough ones." },
      { tag: "Improved", text: "The portal's left navigation is reorganized into task-based groups (Channels, Messages, AI & Automation, Grow & Sell) instead of one long list, with a hint on every item." },
      { tag: "Improved", text: "Talko AI is no longer just a Meta-ecosystem tool — WhatsApp, Instagram, Messenger, YouTube, Google Reviews and website chat all live in the same inbox now." },
    ],
  },
  {
    date: "2026-07-29",
    title: "Comment automation gets a lot more capable",
    entries: [
      { tag: "New", text: "AI review-reply engine goes live — the foundation for Google Business Profile automation." },
      { tag: "New", text: "Reply-only comment automation: post a public reply to a comment without sending a DM, when that's all a comment needs." },
      { tag: "Improved", text: "Comment rules support multiple trigger words and rotating public-reply variants, so responses don't look copy-pasted." },
      { tag: "Improved", text: "Facebook Page comment automation reaches the same feature set as Instagram, including an option to like the comment when a rule fires." },
      { tag: "Improved", text: "After a comment rule replies, AI can take over the rest of that thread automatically instead of going quiet." },
      { tag: "Improved", text: "The owner portal moved to a sidebar-navigation layout, split into clear sections instead of one long scrolling page." },
    ],
  },
  {
    date: "2026-07-26",
    title: "AI campaign builder for ads",
    entries: [
      { tag: "New", text: "Describe a campaign in chat — budget, goal, audience — and the AI builder drafts a ready-to-approve ad campaign, including multiple ad sets for audience testing." },
      { tag: "Improved", text: "The campaign builder now grounds its plans in your real connected ad account data instead of generic assumptions." },
    ],
  },
  {
    date: "2026-07-24",
    title: "Sell inside the conversation",
    entries: [
      { tag: "New", text: "In-chat catalog, cart, and checkout for WhatsApp — customers can browse, add to cart, and pay without leaving the conversation." },
      { tag: "New", text: "Cross-channel cart support for Instagram and Facebook Messenger, driven by AI." },
      { tag: "New", text: "A dedicated order admin view to see, fulfil, cancel, or refund in-chat orders." },
      { tag: "Improved", text: "Paid orders get an automatic WhatsApp confirmation message, and each business's payment webhook is now isolated per tenant." },
    ],
  },
  {
    date: "2026-07-22",
    title: "A more polished, more accessible portal",
    entries: [
      { tag: "Improved", text: "A design pass across the whole portal: refined press feedback, materials, and motion, plus accessibility improvements throughout." },
      { tag: "Improved", text: "Tab switches feel instant now — chunks prefetch on hover and a skeleton loader replaces the old blank-screen flash." },
      { tag: "Fixed", text: "A visual artifact behind the brand logo, and a support-widget icon that could fail to load, are both cleaned up." },
    ],
  },
];
