// Marketing-site content for Talko AI. Single source of truth for all copy
// so pages stay consistent. Pure data — no JSX — usable from server components.

export const SITE = {
  name: "Talko AI",
  tagline: "AI conversations for WhatsApp, Instagram, Facebook, YouTube, Google Reviews & web chat",
};

export const NAV: { label: string; href: string }[] = [
  { label: "Features", href: "/features" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

export const HERO = {
  eyebrow: "WhatsApp · Instagram · Messenger · YouTube · Web chat",
  title: "Turn every chat into a customer",
  titleAccent: "a customer", // rendered with the brand→violet gradient

  subtitle:
    "AI that replies, qualifies and sells everywhere your customers show up — WhatsApp, Instagram, Facebook, YouTube and your website — and keeps your Google reviews answered. One inbox, on autopilot.",
  primary: { label: "Start free trial", href: "/signup" },
  secondary: { label: "See pricing", href: "/pricing" },
  note: "14-day free trial · No credit card · Bring your own AI key",
};

export const LOGOS = ["D2C brands", "EdTech", "Real estate", "Healthcare", "Travel", "Agencies"];

export const STATS: { value: string; label: string }[] = [
  { value: "98%", label: "message open rate on WhatsApp" },
  { value: "3×", label: "faster first response with AI" },
  { value: "24/7", label: "always-on automated replies" },
  { value: "60s", label: "to connect a number & go live" },
];

export type Feature = { title: string; body: string; icon: string };
export const FEATURES: Feature[] = [
  { icon: "bot", title: "AI replies in your voice", body: "On-brand answers from your knowledge base — on your own AI key." },
  { icon: "megaphone", title: "Broadcasts that land", body: "Template campaigns to thousands — scheduled, tracked, ban-safe." },
  { icon: "workflow", title: "No-code chatbot flows", body: "Drag-and-build flows that qualify, book and answer 24/7." },
  { icon: "repeat", title: "Drip sequences", body: "Automated follow-ups triggered by any event — set once, runs forever." },
  { icon: "shopping", title: "Catalog & checkout", body: "Show products, build carts and recover them — right in chat." },
  { icon: "instagram", title: "Instagram, done right", body: "Auto-reply to DMs and comments — fully within Meta's rules." },
  { icon: "messenger", title: "Facebook Messenger", body: "Auto-reply to Page DMs and turn comments into private replies — same AI, same inbox." },
  { icon: "comment", title: "Comment automation", body: "Turn Instagram & Facebook comments into DMs or public replies — multiple link buttons, keyword triggers, and rotating replies that stay ban-safe." },
  { icon: "youtube", title: "YouTube comment automation", body: "Auto-reply to comments on your videos, moderate spam, and let AI take over the thread when someone replies — all paced to stay safe from spam strikes." },
  { icon: "star", title: "AI review replies", body: "Connect your Google Business Profile and reply on autopilot — warm for 5★, empathetic recovery for the tough ones, drafted for your approval below your threshold." },
  { icon: "sparkles", title: "Conversation intelligence", body: "Every chat auto-summarised — who they are, what they want, and the single best next step." },
  { icon: "webchat", title: "Website web chat", body: "Drop a live-chat bubble on your site with one line of code — visitors chat with your AI instantly." },
  { icon: "inbox", title: "One unified inbox", body: "WhatsApp, Instagram, Messenger and web chat — every conversation in one live inbox, with team assignment and labels." },
  { icon: "shield", title: "Multi-tenant & secure", body: "Per-business isolation, encrypted vaults and audit trails by design." },
];

export type Step = { n: string; title: string; body: string };
export const STEPS: Step[] = [
  { n: "01", title: "Connect your channels", body: "Link WhatsApp, Instagram and Facebook Messenger — or drop a web-chat widget on your site — in a couple of clicks. Each gets its own AI persona and flows." },
  { n: "02", title: "Teach your AI", body: "Upload docs, FAQs and product info. Add your own AI key and Talko AI grounds every reply on your business." },
  { n: "03", title: "Automate & broadcast", body: "Turn on auto-replies, launch broadcasts, build flows and sequences — then watch conversations convert." },
];

// Annual billing discount. Lives here, not in the pricing component, because
// prose on the pricing page quotes this number — a copy that says "20% off"
// beside a table computing 15% is the kind of mismatch nobody notices until a
// customer does.
export const ANNUAL_DISCOUNT = 0.2;

export type Tier = {
  name: string; priceMonthly: number | null; customLabel?: string; tagline: string;
  features: string[]; cta: string; href: string; highlighted?: boolean;
};
export const TIERS: Tier[] = [
  {
    name: "Starter", priceMonthly: 1999, tagline: "For solo founders getting started",
    features: ["1 WhatsApp number", "Website web-chat widget", "YouTube comment automation", "1,000 conversations / mo", "AI auto-replies (your key)", "Comment-to-DM automation", "Broadcasts & templates", "Unified inbox", "2 team seats"],
    cta: "Start free trial", href: "/signup?plan=Starter",
  },
  {
    name: "Growth", priceMonthly: 5999, tagline: "For growing teams that automate", highlighted: true,
    features: ["WhatsApp, Instagram, Messenger & web chat", "10,000 conversations / mo", "Chatbot flows & drip sequences", "Comment automation — buttons, rotating & reply-only", "YouTube comment automation & moderation", "AI review replies — Google Business Profile", "AI conversation briefs", "Catalog & cart recovery", "Growth tools & ad → chat", "10 team seats"],
    cta: "Start free trial", href: "/signup?plan=Growth",
  },
  {
    name: "Scale", priceMonthly: null, customLabel: "Custom", tagline: "For high-volume & multi-brand",
    features: ["Every channel, unlimited numbers", "Custom message volume", "Multiple YouTube channels", "Google review management, multi-location", "Priority support & onboarding", "Dedicated success manager", "Advanced roles & audit logs", "Custom integrations"],
    cta: "Talk to sales", href: "/contact",
  },
];

// Instagram-first plans for creators & influencers — no WhatsApp business stack,
// just the DM/comment automation creators actually need.
export const CREATOR_TIERS: Tier[] = [
  {
    name: "Creator", priceMonthly: 999, tagline: "For individual creators & influencers",
    features: ["1 Instagram account", "3,000 conversations / mo", "AI auto-replies (your key)", "Comment-to-DM, keyword & rotating replies", "Lead capture / link-in-bio", "Basic chatbot flows", "Merch catalog & checkout", "2 team seats"],
    cta: "Start free trial", href: "/signup?plan=Creator",
  },
  {
    name: "Creator Pro", priceMonthly: 2999, tagline: "For creator-led brands & agencies", highlighted: true,
    features: ["Up to 3 Instagram accounts", "Messenger & website web chat", "1 YouTube channel — comment automation", "10,000 conversations / mo", "Reply-only & multi-button comment automation", "AI review replies + conversation briefs", "Drip sequences & WhatsApp Forms", "Meta Ads & AI Hub", "5 team seats", "Priority support"],
    cta: "Start free trial", href: "/signup?plan=Creator Pro",
  },
];

// ── "How your chatbot flow works" — node graph ───────────────────────────────
export type FlowBranch = { title: string; body: string; tone: "sky" | "lavender" | "peach"; icon: string };
export const CHAT_FLOW = {
  trigger: { title: "Customer message", body: "Arrives on WhatsApp, Instagram, Messenger or web chat", icon: "message" },
  brain: { title: "AI Assistant", body: "Understands intent & routes instantly", icon: "bot" },
  branches: [
    { tone: "sky", icon: "book", title: "Answer from knowledge base", body: "Grounded, on-brand reply in seconds — no human needed." },
    { tone: "lavender", icon: "user", title: "Capture the lead", body: "Collects name, email and intent, saved to the contact." },
    { tone: "peach", icon: "handoff", title: "Hand off to a human", body: "Escalates cleanly to your team when it matters." },
  ] as FlowBranch[],
};

// ── "How drip sequences work" — process timeline ─────────────────────────────
export type SeqStep = { n: string; title: string; body: string; meta: string; icon: string };
export const SEQUENCE_FLOW: SeqStep[] = [
  { n: "1", icon: "zap", title: "Trigger fires", body: "A new lead, keyword, opt-in or abandoned cart kicks off the sequence.", meta: "Instant" },
  { n: "2", icon: "send", title: "Welcome message", body: "An instant intro goes out in your brand voice to open the conversation.", meta: "0 min" },
  { n: "3", icon: "clock", title: "Smart follow-up", body: "If there's no reply, a nudge lands later — automatically, never pushy.", meta: "+1 day" },
  { n: "4", icon: "cart", title: "Convert", body: "Send the offer and a checkout link, then hand hot leads to your team.", meta: "+3 days" },
];

export type Testimonial = { quote: string; name: string; role: string };
export const TESTIMONIALS: Testimonial[] = [
  { quote: "We replaced three tools with Talko AI. AI replies handle 70% of our DMs and our team finally has one inbox.", name: "Aisha Khan", role: "Founder, Bloom D2C" },
  { quote: "Broadcasts with 95%+ open rates and flows that book demos overnight. Our cost per lead dropped by half.", name: "Rohit Verma", role: "Growth Lead, EduPrime" },
  { quote: "Setup took an afternoon. Bringing our own AI key meant predictable costs and full control over the model.", name: "Sara Mathew", role: "Ops Head, Nest Realty" },
];

export type Faq = { q: string; a: string };
export const FAQS: Faq[] = [
  { q: "What is Talko AI?", a: "Talko AI is an AI-powered customer conversation platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat. It replies, qualifies leads and sells across every channel from one inbox, using AI grounded on your own knowledge base and billed to your own AI provider key." },
  { q: "How do I get started with Talko AI?", a: "Start a free 14-day trial, connect WhatsApp, Instagram, Messenger or your website chat in a few clicks, add your own AI key, and Talko AI starts replying, qualifying and selling immediately across every channel — no credit card required and no developer needed." },
  { q: "Do I need my own WhatsApp Business account?", a: "For WhatsApp, Instagram and Messenger, yes — Talko AI connects your own number, Instagram account and Facebook Page through Meta's official APIs, so your brand stays yours. The website web-chat widget needs no Meta account at all — just paste one line of code on your site." },
  { q: "What does 'bring your own AI key' mean?", a: "AI replies run on your own Gemini, OpenAI or Anthropic key, which you add in settings. Usage is billed to your provider account, so costs are transparent and fully under your control." },
  { q: "Is there a free trial?", a: "Every plan starts with a 14-day free trial. No credit card required to start — explore the full platform and only subscribe when you're ready." },
  { q: "Is my data secure?", a: "Each business is fully isolated with row-level security, your channel tokens are encrypted at rest, and we run on dedicated infrastructure. You own your data and can export or delete it anytime." },
  { q: "Which channels does Talko AI support?", a: "WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and a website web-chat widget — all through the same unified inbox, AI engine, flows and sequences. Each is a channel, not a separate product, so your AI, knowledge base and team work identically everywhere. We're not a Meta-only tool — the same platform covers Google's ecosystem too, with more channels on the roadmap." },
  { q: "Do you have a plan for creators & influencers?", a: "Yes — our Creator and Creator Pro plans are Instagram-first, built for creators who don't need the WhatsApp business stack. You get AI auto-replies, comment-to-DM and keyword automation, link-in-bio lead capture, basic flows and a merch catalog from ₹999/mo. Creator Pro adds Messenger, multiple Instagram accounts, YouTube comment automation, ads and more volume." },
  { q: "Can my whole team use it?", a: "Absolutely. Assign conversations, set roles, use shared quick replies and keep a full activity log across your team." },
];

// Short glossary of the platform's core concepts — rendered as a <dl> so each
// term is a real, machine-extractable "X is a..." definition, not just prose.
export type GlossaryTerm = { term: string; definition: string };
export const GLOSSARY: GlossaryTerm[] = [
  { term: "AI reply", definition: "An automated response written by your connected AI model (Gemini, OpenAI or Anthropic), grounded on your own knowledge base so it stays accurate and on-brand." },
  { term: "Broadcast", definition: "A scheduled, tracked message sent to a segment of your contacts using an approved template — with delivery, read and click tracking built in." },
  { term: "Chatbot flow", definition: "A no-code, drag-and-build conversation path that qualifies leads, answers questions or books appointments without a human on the other end." },
  { term: "Drip sequence", definition: "A series of automated follow-up messages triggered by an event, like a new lead or an abandoned cart, sent on a schedule you define once." },
  { term: "Comment automation", definition: "A rule that turns a public comment on Instagram, Facebook or YouTube into an automatic reply, a private DM, or a moderation action." },
];

// A post body is a small set of typed blocks — mirrors `LegalBlock` above.
// Plain strings can't carry real H2/H3 structure or lists, and both matter for
// how a long-form post actually ranks and gets scanned. `text` in "p" and list
// items supports one inline form, `[label](/path)`, parsed by the post page —
// enough for internal links without pulling in a Markdown renderer.
export type PostBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "list"; items: string[] };
const p = (text: string): PostBlock => ({ type: "p", text });
const h2 = (text: string): PostBlock => ({ type: "h2", text });
const list = (items: string[]): PostBlock => ({ type: "list", items });

export type Post = {
  slug: string; title: string; excerpt: string; date: string; category: string; readTime: string;
  dateModified?: string;   // freshness signal; falls back to `date` when unset
  body: PostBlock[];
  faqs?: Faq[];                                            // rendered with PageFaq (adds FAQPage schema)
  sources?: { label: string; href: string; note?: string }[]; // rendered with SourceList
  keyTakeaway?: string[];                                  // "In short" — rendered with KeyTakeaway
};
export const POSTS: Post[] = [
  {
    slug: "automate-google-review-replies",
    title: "Automate Google Review Replies Without Sounding Fake",
    excerpt: "Reply to every Google review fast, in your own voice — a rating-based AI framework so automated replies never read like a generic template.",
    date: "August 15, 2026", category: "Playbook", readTime: "9 min read",
    // "In short" — the bottom-line answer + who it's for, rendered right under
    // the H1 via KeyTakeaway. Answer-engine extraction and human skimmers both
    // read this before anything else, so it has to stand alone.
    keyTakeaway: [
      "The bottom line: automate replies to reviews at or above a rating you trust (4★+ works well), route anything below that to a human for approval, and always ground the reply in what the review actually says — not just its star count.",
      "This is for local and multi-location businesses getting enough reviews that answering every one by hand no longer scales.",
    ],
    body: [
      p("Most local businesses either answer every Google review by hand, late at night, in a hurry — or don't answer at all. Neither holds up once you're getting a dozen reviews a week across two or three locations. AI can close that gap, but done carelessly it produces exactly the kind of generic, corporate-sounding reply that damages trust rather than building it. Here's how to automate review replies well: what to hand to AI, what to still write yourself, and how to keep every drafted reply sounding like an actual person read the review."),

      h2("Why ignoring reviews costs more than a bad look"),
      p("It costs real customers, not just a bad impression. In BrightLocal's Local Consumer Review Survey, 89% of consumers read a business's responses to reviews, and 42% say they're unlikely to use a business that never responds at all. Consumers also expect speed: 81% want a reply within a week, and expectations keep tightening every year the survey runs."),
      p("So a review with no reply isn't neutral — it's a small, visible signal that nobody's home. Multiply that by every review your competitors down the street are answering, and the gap compounds."),

      h2("Reviews are a ranking signal, not just a trust signal"),
      p("Google's own Business Profile guidance recommends replying to every review, and treats the reply as part of the profile — it appears publicly under your name, labelled \"Response from the owner.\" Google doesn't publish the exact weighting of any single factor in local ranking, but independent local-SEO research consistently finds a correlation between how consistently a business responds and how it performs in the Local Pack, alongside proximity and review volume. Whichever way that causation runs, showing up and replying is the one part of it fully within your control."),

      h2("Why the manual approach breaks down"),
      p("The math is unforgiving at scale. Forty reviews a month across three locations is nearly 1,500 a year — each one deserving a reply that actually reads the review, not a copy-paste line. In practice, the reviews that need the most care are exactly the ones that sit unanswered longest: a rushed owner will happily bang out \"Thanks so much!\" on a 5-star review, but a 2-star complaint takes real thought to answer well, so it waits. And it's the 2-star reply, sitting unanswered for a week, that a prospective customer reads right before deciding whether to book."),

      h2("The trap: AI replies that sound like AI replies"),
      p("This is where automation usually goes wrong. Point a generic AI tool at your reviews and it defaults to safe, forgettable phrasing — \"Thank you for your feedback, we value all our customers\" — that could be pasted under any review, for any business, on any day. BrightLocal's survey found that 50% of consumers are put off specifically by generic or templated review responses. A bot-sounding reply doesn't just fail to help; it actively signals that nobody read what the customer actually wrote."),
      p("The fix isn't to avoid AI — it's to ground it. A good reply references the specific thing the reviewer mentioned: the product they bought, the staff member they named, the wait time they complained about. That single detail is the difference between a reply that reads as personal and one that reads as auto-generated, and it's exactly what a well-built tool should extract from the review text before drafting anything."),

      h2("A rating-based reply framework that actually works"),
      p("The tone that lands on a 5-star review is entirely wrong for a 1-star one, which is exactly why one blanket template collapses under real use. A simple framework, branched by rating:"),
      list([
        "5★ — thank them by name and echo back the specific detail they praised. A light, non-pushy invite to return works well here.",
        "4★ — thank them, then acknowledge the specific gap they noted without getting defensive about it. Note that it's being looked at.",
        "3★ — lead with empathy, skip the excuses, give one concrete next step, and invite them to continue the conversation privately.",
        "1–2★ — empathy first, own anything factual without arguing the point publicly, and move to a phone number or email immediately. Never share the customer's personal details in the public reply, and never get defensive in public — the reply is being read by everyone who hasn't decided yet, not just the reviewer.",
      ]),

      h2("How much should actually run on autopilot"),
      p("A star-based approval threshold, not full auto-post and not full manual review — neither extreme holds up in practice. Replies above a rating you're comfortable with (say, 4 stars and up) can post automatically, while anything at or below that threshold gets drafted for a human to read and approve before it goes live. That one rule protects you from the one scenario that actually matters — a factual claim in a public, permanent reply that turns out to be wrong — while still clearing the bulk of your review volume without anyone typing a word."),
      p("If you manage more than one location, the same threshold should apply everywhere, so the tone and judgment calls don't drift between whoever's running each site."),

      h2("What actually makes an AI reply sound human"),
      p("Grounding it in the review's real details, not the star count alone. In practice that comes down to a handful of habits:"),
      list([
        "It references specifics from the review — the product, the person, the detail — not just the star count.",
        "It roughly matches the reviewer's own tone: a short, casual review earns a short, casual reply; a detailed, considered one earns a bit more substance back.",
        "It avoids the stock phrases readers have learned to skim past — \"we take this very seriously,\" \"your feedback is important to us.\" If a phrase could sit under any review from any business, cut it.",
        "It replies in the language the review was written in, not a default that assumes every customer writes in English.",
        "It stays short. Two to four sentences beats a paragraph almost every time — a long reply reads as defensive, not thorough.",
      ]),

      h2("A checklist for choosing review-reply automation"),
      p("Whether you build this in-house or buy it, the same list separates a tool that actually works from one that just spams the same reply under everything:"),
      list([
        "Branches by star rating — not one template applied everywhere.",
        "Supports a draft-and-approve mode, not only full auto-post.",
        "Grounds every reply in the review's actual text, not just its rating.",
        "Covers every location from one place, so tone stays consistent across a multi-location business.",
        "Replies in the customer's own language.",
        "Doesn't lock reviews away in a separate tool — reviews are one more conversation with a customer you may already be talking to on WhatsApp, Instagram or your website, and treating it that way keeps your voice consistent everywhere.",
      ]),

      p("Reviews are a conversation, the same as a WhatsApp message or an Instagram DM — just a public one. The businesses that handle every channel with the same care (fast, specific, and unmistakably human) are the ones customers keep choosing, and, as far as the evidence points, the ones Google keeps showing. Talko AI treats Google reviews as one more channel in the same inbox as WhatsApp, Instagram, Messenger and YouTube, with exactly this kind of rating-based approval threshold built in — see [how AI review replies work](/features) or [compare plans](/pricing)."),
    ],
    faqs: [
      { q: "Is it against Google's rules to use AI to reply to reviews?", a: "No. Google's own guidance for owner responses focuses on being personal, professional and timely — it doesn't require that a human typed every word. What Google does prohibit is fake reviews and incentivized reviews, not automated replies to real ones. That said, keep a human reviewing anything below a comfortable star threshold, since a wrong factual claim in a public reply can't be quietly taken back." },
      { q: "Should I reply to every review, even short 5-star ones with no comment?", a: "Yes, if you can keep it up. Most consumers read a business's responses, and profiles that reply consistently — not just to complaints — read as more attentive. A short, genuine \"Thanks, Priya!\" costs almost nothing and keeps your response rate high." },
      { q: "What's the single biggest mistake businesses make with negative reviews?", a: "Arguing publicly, or getting defensive. The reply is read by every future customer deciding whether to book, not just the person who left the review — so acknowledge what's true, skip the excuses, and take the details offline." },
      { q: "How fast does a reply actually need to go out?", a: "Consumer surveys put the expectation at within a week, but same-day (24–48 hours) has become the practical standard for businesses that treat reviews as a real channel rather than an afterthought." },
      { q: "Can one team manage replies across multiple locations?", a: "That's precisely where automation earns its keep — a single rating-based approval rule, applied consistently across every location, replaces a dozen managers each replying (or not replying) in their own voice." },
    ],
    sources: [
      { label: "Manage customer reviews — Google Business Profile Help", href: "https://support.google.com/business/answer/3474050?hl=en", note: "Google's own guidance on replying to reviews" },
      { label: "Local Consumer Review Survey — BrightLocal", href: "https://www.brightlocal.com/research/local-consumer-review-survey/", note: "Consumer behaviour data on reading and reacting to review responses" },
      { label: "Local Search Ranking Factors report — Whitespark", href: "https://whitespark.ca/local-search-ranking-factors/", note: "Annual survey of local-SEO practitioners on what correlates with Local Pack ranking" },
    ],
  },
  {
    slug: "whatsapp-automation-guide",
    title: "How automation is transforming customer messaging",
    excerpt: "WhatsApp and Instagram are now the front door to your business. Here's how automation turns them into your best sales channel.",
    date: "June 12, 2026", category: "Playbook", readTime: "6 min read",
    body: [
      p("Messaging has quietly become the primary way customers reach brands. The average person opens a WhatsApp message within minutes — a response rate email and ads can only dream of. Yet most businesses still treat chat as an afterthought, answering manually, slowly, and only during office hours."),
      p("Automation changes the economics. With grounded AI replies, the moment a customer asks a question — about pricing, availability, or your return policy — they get an accurate answer instantly, in your brand's voice, at any hour. The conversations that genuinely need a human are escalated cleanly, so your team spends time where it matters."),
      p("The compounding wins come from the layers on top: broadcasts that re-engage past customers, drip sequences that nurture leads, and flows that qualify and book without a single human touch. Done well, a single conversation becomes a repeatable, measurable funnel."),
      p("The key is doing it within the rules. Official APIs, opt-in respected, no cold outreach, and a clear escalation path. That's the difference between a channel that scales and one that gets your number blocked."),
    ],
  },
  {
    slug: "bring-your-own-ai-key",
    title: "Why we let you bring your own AI key",
    excerpt: "Predictable costs, full model control, and no lock-in. Here's the thinking behind per-account AI keys.",
    date: "June 5, 2026", category: "Product", readTime: "4 min read",
    body: [
      p("Most platforms bundle AI into an opaque per-message fee. It feels simple until volume grows and the bill becomes impossible to predict — or you're stuck on a model you didn't choose."),
      p("We took the opposite approach. You add your own Gemini, OpenAI or Anthropic key, and Talko AI uses it for your replies. Usage is billed directly to your provider account, so you see exactly what you spend and can pick the model that fits your budget and quality bar."),
      p("It also means no lock-in. Switch models or providers whenever you like — your flows, knowledge base and inbox stay exactly the same. Your key is encrypted at rest and never leaves our vault."),
    ],
  },
  {
    slug: "instagram-dm-best-practices",
    title: "Instagram DMs: what's allowed, and what gets you blocked",
    excerpt: "A practical guide to automating Instagram messaging without breaking Meta's rules.",
    date: "May 28, 2026", category: "Compliance", readTime: "5 min read",
    body: [
      p("Instagram is a goldmine for conversational commerce — but Meta's rules are strict, and ignoring them is the fastest way to lose access. The good news: the rules are sensible, and you can automate aggressively while staying fully compliant."),
      p("The core constraints are simple. You can reply to anyone who messaged you within a 24-hour window. You can turn a comment into a single private reply when someone comments on your post. What you cannot do is send cold DMs to people who never interacted with you."),
      p("Talko AI enforces these guardrails in code — the 24-hour window, comment-to-DM as a single message, per-account pacing, and opt-out handling are all built in. You get the automation upside without the risk of a ban."),
    ],
  },
];

// ── n8n-style agent canvas — "what one automation looks like" ────────────────
// A horizontal node graph: trigger → AI Agent (with model/memory/tool sub-nodes)
// → router → channel actions. Mirrors the builder so the marketing site shows the
// actual product capability, not a static mock.
export type CanvasNode = { id: string; icon: string; title: string; sub?: string; accent?: boolean };
export const AGENT_CANVAS = {
  trigger: { id: "trigger", icon: "zap", title: "Customer messages", sub: "WhatsApp · IG · Messenger · web" },
  agent: { id: "agent", icon: "bot", title: "AI Agent", sub: "Understands & decides", accent: true },
  // Sub-nodes that hang beneath the agent (the n8n "model / memory / tool" row).
  attachments: [
    { id: "model", icon: "sparkles", title: "Your AI model", sub: "Gemini · OpenAI · Anthropic" },
    { id: "memory", icon: "history", title: "Conversation memory", sub: "Full context, per contact" },
    { id: "kb", icon: "book", title: "Knowledge base", sub: "Your docs & FAQs" },
    { id: "catalog", icon: "shopping", title: "Catalog & tools", sub: "Products, orders, CRM" },
  ] as CanvasNode[],
  router: { id: "router", icon: "split", title: "Is it a hot lead?" },
  branches: {
    yes: [
      { id: "capture", icon: "user", title: "Capture the lead", sub: "Save name, intent, tags" },
      { id: "notify", icon: "bell", title: "Notify your team", sub: "Assign in the inbox" },
    ] as CanvasNode[],
    no: [
      { id: "answer", icon: "message", title: "Answer instantly", sub: "Grounded, on-brand reply" },
      { id: "nurture", icon: "repeat", title: "Add to a sequence", sub: "Automated follow-ups" },
    ] as CanvasNode[],
  },
};

// ── Interactive use-case flows ───────────────────────────────────────────────
// Each business problem maps to a small n8n-style 2D graph: a trigger → an AI
// brain (with conceptual "context" nodes hanging beneath it) → two outcome
// branches. Kept conceptual (business-outcome nodes, not a build recipe) — it
// shows WHAT we solve and how fast, without exposing the implementation.
export type FlowNodeDef = { icon: string; title: string; sub: string };
export type UseCase = {
  key: string; tab: string; problem: string; outcome: string;
  trigger: FlowNodeDef;
  brain: FlowNodeDef;                                  // the accent AI node
  context: FlowNodeDef[];                              // sub-nodes under the brain (1–2)
  branches: { label: string; node: FlowNodeDef }[];    // two outcomes
};
export const USE_CASES: UseCase[] = [
  {
    key: "leads",
    tab: "Capture & qualify leads",
    problem: "Leads message after hours and go cold before sales replies",
    outcome: "Every lead captured, qualified and routed in seconds — 24/7, no rep online.",
    trigger: { icon: "zap", title: "New enquiry", sub: "WhatsApp · IG · Messenger · web" },
    brain: { icon: "bot", title: "AI qualifies", sub: "Intent, budget, timeline" },
    context: [
      { icon: "book", title: "Knowledge base", sub: "Answers on the spot" },
      { icon: "user", title: "CRM + tags", sub: "Saved & scored" },
    ],
    branches: [
      { label: "hot", node: { icon: "bell", title: "Alert sales", sub: "Assigned in the inbox" } },
      { label: "warm", node: { icon: "repeat", title: "Nurture sequence", sub: "Auto follow-ups" } },
    ],
  },
  {
    key: "support",
    tab: "Answer support 24/7",
    problem: "Customers wait hours for a reply to simple questions",
    outcome: "Most questions resolved instantly; only the tricky ones reach your team.",
    trigger: { icon: "message", title: "Customer asks", sub: "Any hour, any channel" },
    brain: { icon: "bot", title: "AI answers", sub: "Grounded on your KB" },
    context: [
      { icon: "book", title: "Knowledge base", sub: "Docs & FAQs" },
      { icon: "history", title: "Past chats", sub: "Full context" },
    ],
    branches: [
      { label: "solved", node: { icon: "check", title: "Resolved instantly", sub: "On-brand reply" } },
      { label: "complex", node: { icon: "handoff", title: "Escalate to team", sub: "Clean hand-off" } },
    ],
  },
  {
    key: "carts",
    tab: "Recover abandoned carts",
    problem: "Carts are abandoned with no way to follow up in chat",
    outcome: "Win back revenue automatically — inside the chat they already use.",
    trigger: { icon: "shopping", title: "Cart abandoned", sub: "Checkout left" },
    brain: { icon: "bot", title: "AI re-engages", sub: "Personalized nudge" },
    context: [
      { icon: "clock", title: "Smart timing", sub: "The right moment" },
      { icon: "card", title: "Your catalog", sub: "Items & prices" },
    ],
    branches: [
      { label: "buys", node: { icon: "card", title: "Checkout link", sub: "One tap to pay" } },
      { label: "later", node: { icon: "repeat", title: "Follow-up later", sub: "Gentle reminder" } },
    ],
  },
  {
    key: "broadcasts",
    tab: "Re-engage with broadcasts",
    problem: "Re-marketing campaigns get your number flagged or banned",
    outcome: "Reach thousands compliantly — opt-in respected, quality auto-protected.",
    trigger: { icon: "user", title: "Pick a segment", sub: "Tags & activity" },
    brain: { icon: "shield", title: "Consent & tier check", sub: "Opted-in, within limits" },
    context: [
      { icon: "megaphone", title: "Approved template", sub: "Scheduled send" },
      { icon: "chart", title: "Live tracking", sub: "Delivery & reads" },
    ],
    branches: [
      { label: "healthy", node: { icon: "megaphone", title: "Send at scale", sub: "Thousands, safely" } },
      { label: "risk", node: { icon: "shield", title: "Auto-pause", sub: "On any quality dip" } },
    ],
  },
  {
    key: "booking",
    tab: "Book appointments",
    problem: "Booking takes endless back-and-forth and staff time",
    outcome: "Fill your calendar on autopilot, with reminders that cut no-shows.",
    trigger: { icon: "message", title: "Enquiry arrives", sub: "“Can I book?”" },
    brain: { icon: "bot", title: "AI collects details", sub: "Service, date, contact" },
    context: [
      { icon: "calendar", title: "Your calendar", sub: "Live availability" },
      { icon: "book", title: "Service info", sub: "Hours & options" },
    ],
    branches: [
      { label: "booked", node: { icon: "calendar", title: "Slot booked", sub: "Synced & confirmed" } },
      { label: "remind", node: { icon: "bell", title: "Auto reminders", sub: "Cut no-shows" } },
    ],
  },
];

// ── Business problem → one-platform solution ─────────────────────────────────
export type ProblemSolution = { problem: string; solution: string; icon: string };
export const PROBLEMS: ProblemSolution[] = [
  { icon: "clock", problem: "Leads message after hours and go cold before anyone replies.", solution: "AI replies in seconds, 24/7, in your brand voice — and books or escalates the ones that matter." },
  { icon: "inbox", problem: "Conversations are scattered across WhatsApp, Instagram, Messenger and your website.", solution: "One unified inbox with team assignment, labels and quick replies across every channel." },
  { icon: "megaphone", problem: "Broadcasts get the number flagged or banned by Meta.", solution: "Opt-in respected, 24h-window enforced, quality auto-pause and per-tier pacing baked in." },
  { icon: "shopping", problem: "Carts get abandoned and there's no way to follow up in chat.", solution: "Catalog, checkout and automated cart-recovery sequences — all inside the chat they already use." },
  { icon: "workflow", problem: "Every tool needs a developer and they don't talk to each other.", solution: "No-code flows, sequences and growth tools in one platform — launch in an afternoon, no engineers." },
  { icon: "shield", problem: "Customer data is spread across vendors with no real isolation.", solution: "Per-business isolation, encrypted token vault and RLS-backed separation by design." },
];

// ── Comparison: Talko AI vs the global leaders ───────────────────────────────
// Columns are well-known players, each strong in one lane (WATI / AiSensy /
// Interakt → WhatsApp Business API, Respond.io → omnichannel inbox, ManyChat →
// IG/Messenger, Tidio → website chat) — all Meta/web-chat tools; none extend to
// YouTube or Google Business Profile. Cells reflect publicly available
// capabilities as of July 2026 and are a positioning snapshot, not a spec sheet
// — Talko's edge is covering the full Meta AND Google ecosystem in one
// platform, on your own AI key. The summary row (count of ✓) is derived in the
// component, so adding/removing a row or column keeps the score honest.
export const COMPARE_COLS = ["Talko AI", "WATI", "AiSensy", "Interakt", "Respond.io", "ManyChat", "Tidio"] as const;
export type CompareRow = { feature: string; values: (boolean | string)[] };
export const COMPARE_ROWS: CompareRow[] = [
  { feature: "WhatsApp, Instagram, Messenger & website chat — one inbox", values: [true, "WhatsApp only", "WhatsApp only", "WhatsApp only", true, "No web chat", "Web-first"] },
  { feature: "YouTube comment automation & Google review replies", values: [true, false, false, false, false, false, false] },
  { feature: "AI replies grounded on your own knowledge base", values: [true, "Add-on", "Add-on", "Add-on", "Add-on", "Basic", true] },
  { feature: "Bring your own AI key — no per-message AI markup", values: [true, false, false, false, false, false, false] },
  { feature: "No-code chatbot flows & drip sequences", values: [true, true, true, "Basic", true, true, "Flows only"] },
  { feature: "Catalog & in-chat checkout / cart recovery", values: [true, "Add-on", "Add-on", true, false, "Via apps", "Shopify only"] },
  { feature: "Meta anti-ban guardrails (opt-in · 24h · auto-pause)", values: [true, "Partial", "Partial", "Partial", "Partial", "Partial", false] },
  { feature: "Multi-tenant isolation & encrypted key vault", values: [true, "Varies", "Varies", "Varies", "Varies", "Varies", "Varies"] },
  { feature: "Predictable pricing — no per-contact fees", values: [true, "Per-conversation", "Per-conversation", "Per-conversation", "Per-seat + AI", "Per-contact", "Per-seat + AI"] },
];
export const COMPARE_NOTE =
  "Based on publicly available information as of July 2026. Each tool is excellent in its core lane — Talko AI's advantage is covering every channel, including YouTube and Google reviews, in one platform on your own AI key. Capabilities change; check each provider for current details.";

// ── /vs comparison landing pages ─────────────────────────────────────────────
// One SEO page per competitor ("Talko AI vs WATI", "WATI alternative"), targeting
// high-intent bottom-funnel search. `name` MUST match a COMPARE_COLS entry exactly
// — the focused two-column table is derived from COMPARE_ROWS by that column index,
// so the claims stay in sync with the honest, hedged capability matrix above.
// Positioning is deliberately fair ("X is excellent at Y") — the only edge we
// assert is all-channels-in-one + bring-your-own-AI-key, which the matrix backs up.
export type CompetitorFaq = { q: string; a: string };
export type Competitor = {
  slug: string;        // url segment: /vs/<slug>
  name: string;        // MUST equal a COMPARE_COLS label (column lookup)
  lane: string;        // their core strength, stated fairly
  category: string;    // short chip label
  headline: string;    // the page <h1>
  summary: string;     // intro paragraph — fair to them, clear on our edge
  whySwitch: { title: string; body: string }[];
  faqs: CompetitorFaq[];
};

export const COMPETITORS: Competitor[] = [
  {
    slug: "wati", name: "WATI", category: "WhatsApp API inbox",
    lane: "a popular WhatsApp Business API shared inbox built for team collaboration",
    headline: "Talko AI vs WATI: the all-channel, own-AI-key alternative",
    summary: "WATI is a well-liked WhatsApp Business API inbox, strong on team collaboration and broadcast. But it lives on WhatsApp alone, and its AI is a paid add-on billed per message. Talko AI runs WhatsApp, Instagram, Messenger and website chat from one inbox — with AI replies grounded on your own knowledge base, on your own AI key, so there's no per-message markup.",
    whySwitch: [
      { title: "Every channel, one inbox", body: "WhatsApp, Instagram, Messenger and web chat land in a single inbox — not WhatsApp in isolation." },
      { title: "Your AI key, your margins", body: "Bring your own Gemini, OpenAI or Anthropic key. AI replies aren't marked up per message the way an add-on is." },
      { title: "Predictable pricing", body: "Plans that don't stack per-conversation fees as your volume grows." },
    ],
    faqs: [
      { q: "Is Talko AI a good WATI alternative?", a: "Yes. Talko AI covers the same WhatsApp Business API use cases — shared inbox, broadcasts, no-code flows — and adds Instagram, Messenger and website chat, plus AI replies grounded on your own knowledge base and billed to your own AI key." },
      { q: "Can I switch from WATI to Talko AI?", a: "Yes. You keep your WhatsApp Business number — connect it to Talko AI, rebuild your flows in the no-code builder, and add Instagram, Messenger and web chat alongside it." },
      { q: "How does Talko AI pricing compare to WATI?", a: "Talko AI plans start at ₹999/mo with predictable pricing, and you bring your own AI key so AI replies aren't marked up per message. See the pricing page for current plans." },
    ],
  },
  {
    slug: "aisensy", name: "AiSensy", category: "WhatsApp marketing",
    lane: "a WhatsApp broadcast and marketing platform popular with Indian businesses",
    headline: "Talko AI vs AiSensy: broadcasts plus every channel and your own AI",
    summary: "AiSensy is a solid WhatsApp broadcast and marketing tool. But it's WhatsApp-only, its AI is an add-on, and billing is per-conversation. Talko AI keeps the broadcasts — with a full sent → delivered → read → clicked → replied funnel — and adds Instagram, Messenger and web chat, plus AI grounded on your knowledge base running on your own key.",
    whySwitch: [
      { title: "Broadcasts with a real funnel", body: "Every send tracked step by step, with click attribution built in — across more than just WhatsApp." },
      { title: "Own your AI costs", body: "Bring your own AI key instead of paying an AI add-on on top of per-conversation fees." },
      { title: "One platform, every channel", body: "Run Instagram, Messenger and website chat from the same inbox, not a separate tool." },
    ],
    faqs: [
      { q: "Is Talko AI a good AiSensy alternative?", a: "Yes. Talko AI does WhatsApp broadcasts with full delivery tracking and adds Instagram, Messenger and web chat, plus knowledge-base-grounded AI on your own key." },
      { q: "Can I move my WhatsApp broadcasts from AiSensy to Talko AI?", a: "Yes. Connect your WhatsApp Business number, upload your approved templates, and send broadcasts by tag or segment with per-day audience charts and click tracking." },
      { q: "How does Talko AI pricing compare to AiSensy?", a: "Talko AI starts at ₹999/mo with predictable pricing and bring-your-own-AI-key billing, so AI usage isn't marked up. Check the pricing page for current plans." },
    ],
  },
  {
    slug: "interakt", name: "Interakt", category: "WhatsApp commerce",
    lane: "a WhatsApp commerce platform with catalog and order features",
    headline: "Talko AI vs Interakt: sell in chat on every channel, on your own AI",
    summary: "Interakt is a capable WhatsApp commerce tool with catalog and order flows. But it stays on WhatsApp, and its AI and chatbot depth are limited. Talko AI brings product cards, in-chat checkout and abandoned-cart recovery to WhatsApp, Instagram, Messenger and web chat — with AI replies grounded on your knowledge base and billed to your own key.",
    whySwitch: [
      { title: "Sell across every channel", body: "Catalog and in-chat checkout on Instagram and Messenger too, not WhatsApp alone." },
      { title: "AI that quotes your own docs", body: "Replies grounded on your knowledge base — prices, policies, catalog — not a bolt-on." },
      { title: "Bring your own AI key", body: "Predictable AI costs billed to your own key, no per-message markup." },
    ],
    faqs: [
      { q: "Is Talko AI a good Interakt alternative?", a: "Yes. Talko AI supports WhatsApp catalog and in-chat checkout like Interakt, and extends it to Instagram, Messenger and web chat with knowledge-base-grounded AI on your own key." },
      { q: "Can I switch from Interakt to Talko AI?", a: "Yes. Keep your WhatsApp Business number, import your catalog, and rebuild your commerce flows with the no-code builder — then turn on the same experience across your other channels." },
      { q: "How does Talko AI pricing compare to Interakt?", a: "Talko AI plans start at ₹999/mo with predictable pricing and your own AI key, so AI replies aren't marked up per message. See the pricing page for details." },
    ],
  },
  {
    slug: "respond-io", name: "Respond.io", category: "Omnichannel inbox",
    lane: "a strong omnichannel inbox for routing conversations across channels",
    headline: "Talko AI vs Respond.io: omnichannel, with your own AI and in-chat sales",
    summary: "Respond.io is a strong omnichannel inbox with solid routing. But its AI is an add-on with no bring-your-own-key option, it has no native catalog or in-chat checkout, and pricing is per-seat plus AI. Talko AI covers the same channels, grounds its AI on your knowledge base with your own key, and lets you sell right inside the conversation.",
    whySwitch: [
      { title: "Your AI key, no add-on", body: "Bring your own Gemini, OpenAI or Anthropic key instead of paying a separate AI add-on per seat." },
      { title: "Sell inside the chat", body: "Native catalog, in-chat checkout and cart recovery — not just an inbox." },
      { title: "Pricing that doesn't scale by seat", body: "Predictable plans rather than per-seat plus AI stacking up as the team grows." },
    ],
    faqs: [
      { q: "Is Talko AI a good Respond.io alternative?", a: "Yes. Talko AI is omnichannel across WhatsApp, Instagram, Messenger and web chat, and adds knowledge-base-grounded AI on your own key plus native catalog and in-chat checkout." },
      { q: "Can I switch from Respond.io to Talko AI?", a: "Yes. Connect your WhatsApp number and social channels, rebuild your routing and flows in the no-code builder, and bring your team into one inbox." },
      { q: "How does Talko AI pricing compare to Respond.io?", a: "Talko AI starts at ₹999/mo with predictable pricing and bring-your-own-AI-key billing, rather than per-seat plus a separate AI charge. See the pricing page for current plans." },
    ],
  },
  {
    slug: "manychat", name: "ManyChat", category: "IG & Messenger bots",
    lane: "a well-known Instagram and Messenger automation tool",
    headline: "Talko AI vs ManyChat: add WhatsApp, web chat and your own AI",
    summary: "ManyChat is great at Instagram and Messenger flow automation. But it has no website chat, its AI is basic, and pricing is per-contact. Talko AI keeps the Instagram and Messenger automation and adds WhatsApp and website chat in the same inbox — with AI replies grounded on your knowledge base and billed to your own AI key.",
    whySwitch: [
      { title: "WhatsApp and web chat too", body: "Not just Instagram and Messenger — WhatsApp and a website widget in the same inbox." },
      { title: "AI grounded on your business", body: "Replies quote your own docs, prices and policies, on your own AI key — beyond basic keyword bots." },
      { title: "No per-contact pricing", body: "Predictable plans instead of costs that climb with every contact added." },
    ],
    faqs: [
      { q: "Is Talko AI a good ManyChat alternative?", a: "Yes. Talko AI does Instagram and Messenger automation like ManyChat and adds WhatsApp and website chat, plus knowledge-base-grounded AI on your own key." },
      { q: "Can I switch from ManyChat to Talko AI?", a: "Yes. Connect your Instagram and Messenger accounts, rebuild your flows in the no-code builder, and add WhatsApp and a website widget alongside them." },
      { q: "How does Talko AI pricing compare to ManyChat?", a: "Talko AI plans start at ₹999/mo with predictable pricing — not per-contact — and you bring your own AI key. See the pricing page for current plans." },
    ],
  },
  {
    slug: "tidio", name: "Tidio", category: "Website live chat",
    lane: "a web-first live chat and chatbot tool",
    headline: "Talko AI vs Tidio: website chat plus WhatsApp, Instagram and Messenger",
    summary: "Tidio is a strong website live-chat and chatbot tool. But it's web-first, its AI is billed on top, there's no bring-your-own-key option, and catalog is Shopify-only. Talko AI keeps the website widget and adds deep WhatsApp, Instagram and Messenger — with AI grounded on your knowledge base, on your own AI key, and catalog across every channel.",
    whySwitch: [
      { title: "Beyond the website", body: "Deep WhatsApp, Instagram and Messenger support, not a web-first tool with messaging bolted on." },
      { title: "Your own AI key", body: "Bring your own Gemini, OpenAI or Anthropic key instead of paying for AI on top per seat." },
      { title: "Catalog on every channel", body: "Product cards and in-chat checkout everywhere — not limited to a single store integration." },
    ],
    faqs: [
      { q: "Is Talko AI a good Tidio alternative?", a: "Yes. Talko AI includes a website chat widget like Tidio and adds full WhatsApp, Instagram and Messenger, plus knowledge-base-grounded AI on your own key." },
      { q: "Can I switch from Tidio to Talko AI?", a: "Yes. Add the Talko AI website widget, connect your WhatsApp number and social channels, and rebuild your bots in the no-code flow builder." },
      { q: "How does Talko AI pricing compare to Tidio?", a: "Talko AI starts at ₹999/mo with predictable pricing and bring-your-own-AI-key billing, rather than per-seat plus a separate AI charge. See the pricing page for details." },
    ],
  },
];

export const SOCIAL_PROOF = "Trusted by 2,000+ growing businesses";

// Integrations we provide, grouped by category for the logo wall.
// slug = Simple Icons id (cdn.simpleicons.org); omit slug to render the name as
// a wordmark (e.g. brands without a Simple Icon). Single source of truth — the
// flat INTEGRATIONS strip below is derived from it.
// src = explicit logo URL (e.g. an official SVG in /public/brand); slug = Simple
// Icons id; iconify = Iconify "logos" id (for brands Simple Icons dropped, e.g.
// Slack/Teams/Pipedrive); none → the name renders as a wordmark.
export type IntegrationBrand = { name: string; slug?: string; iconify?: string; src?: string; wordmark?: boolean };
export type IntegrationCategory = { title: string; blurb: string; items: IntegrationBrand[] };

// Every logo is self-hosted in /public/brand/logos so ad-blockers (which
// commonly block icon CDNs) can never degrade the wall to plain text. slug /
// iconify remain as network fallbacks only.
export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  { title: "Channels", blurb: "Meet customers where they already are.", items: [
    { name: "WhatsApp", src: "/brand/logos/whatsapp.svg", slug: "whatsapp" },
    { name: "Instagram", src: "/brand/logos/instagram.svg", slug: "instagram" },
    { name: "Messenger", src: "/brand/logos/messenger.svg", slug: "messenger" },
    { name: "YouTube", src: "/brand/logos/youtube.svg", slug: "youtube" },
    { name: "Google Reviews", src: "/brand/logos/google.svg", slug: "google" },
    { name: "Website web chat", src: "/brand/favicon-96.png" },
  ] },
  { title: "AI models", blurb: "Bring your own key — full control over cost and model.", items: [
    { name: "Gemini", src: "/brand/logos/googlegemini.svg", slug: "googlegemini" },
    { name: "OpenAI", src: "/brand/logos/openai.svg", iconify: "logos:openai-icon" },
    { name: "Anthropic", src: "/brand/logos/anthropic.svg", slug: "anthropic" },
  ] },
  { title: "CRM", blurb: "New leads sync to whichever CRM you already use.", items: [
    { name: "HubSpot", src: "/brand/logos/hubspot.svg", slug: "hubspot" },
    { name: "LeadSquared", src: "/brand/logos/leadsquared.png" },
    { name: "Pipedrive", src: "/brand/logos/pipedrive.svg", iconify: "logos:pipedrive", wordmark: true },
  ] },
  { title: "Payments", blurb: "Send a pay link and get paid inside the chat.", items: [
    { name: "Razorpay", src: "/brand/logos/razorpay.svg", slug: "razorpay" },
    { name: "Stripe", src: "/brand/logos/stripe.svg", slug: "stripe" },
  ] },
  { title: "E-commerce", blurb: "Import your product catalog in one click.", items: [
    { name: "Shopify", src: "/brand/logos/shopify.svg", slug: "shopify" },
    { name: "WooCommerce", src: "/brand/logos/woocommerce.svg", slug: "woocommerce", wordmark: true },
  ] },
  { title: "Scheduling", blurb: "Customers book a meeting without leaving chat.", items: [
    { name: "Cal.com", src: "/brand/logos/caldotcom.svg", slug: "caldotcom", wordmark: true },
  ] },
  { title: "Automation & alerts", blurb: "Pipe events into 5,000+ apps and your team's tools.", items: [
    { name: "Zapier", src: "/brand/logos/zapier.svg", slug: "zapier" },
    { name: "Make", src: "/brand/logos/make.svg", slug: "make" },
    { name: "n8n", src: "/brand/logos/n8n.svg", slug: "n8n" },
    { name: "Slack", src: "/brand/logos/slack.svg", iconify: "logos:slack-icon" },
    { name: "Microsoft Teams", src: "/brand/logos/msteams.svg", iconify: "logos:microsoft-teams" },
  ] },
];

// Flat list for the marquee strip (derived — keep one source of truth).
export const INTEGRATIONS: IntegrationBrand[] = INTEGRATION_CATEGORIES.flatMap(c => c.items);

// "Why teams choose Talko AI" — pastel benefit cards. Tones span three colour
// families (green / violet / amber) so the section isn't a wall of blue.
export type Benefit = { title: string; body: string; tone: "mint" | "violet" | "peach" };
export const WHY: Benefit[] = [
  { tone: "mint", title: "Replies in your brand voice", body: "Grounded AI answers from your own knowledge base — accurate, on-brand, and instant, not generic canned text." },
  { tone: "violet", title: "Compliant, data-driven automation", body: "Official Meta and Google APIs, opt-in respected, guardrails in code. Scale conversations without risking your number, channel or listing." },
  { tone: "peach", title: "Save time and money", body: "Bring your own AI key for predictable costs, replace a stack of tools, and let automation handle the busywork." },
];

export const CTA_BULLETS = [
  "Connect a number and go live in under an hour",
  "Bring your own AI key — predictable, transparent costs",
];

export const ABOUT = {
  eyebrow: "About us",
  // Shares "About", "Talko AI", "built", "conversation" and "platform" with the
  // page title so the two describe the same subject, while still leading with
  // the mission rather than a bare label.
  title: "About Talko AI — the conversation platform we built for business growth",
  intro:
    "Talko AI was built on a simple belief: the messaging apps your customers already love should be your most powerful sales and support channel — not your most manual one.",
  // Plain-language definition of the thing this company makes. Stated once, in
  // full, so it can be quoted standalone — an answer engine asked "what is
  // Talko AI" should not have to assemble one from marketing fragments.
  what: [
    "Talko AI is a customer conversation platform. It connects the places people already message businesses — WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and a chat widget on your own website — into a single inbox, and puts AI in front of them that answers using your knowledge base rather than a generic model's assumptions.",
    "Practically, that means an enquiry arriving at 11pm gets an accurate answer about your pricing, stock or policy immediately; a lead gets qualified and booked by a flow without anyone typing; a public comment turns into a private DM; and the conversations that genuinely need a person are handed over with the full history attached.",
  ],
  // First-hand account of why the product exists. Concrete and specific on
  // purpose — this is the section that distinguishes a real operator's page
  // from a template, and it is the only part no competitor can copy.
  story: [
    "We started by watching what businesses were actually doing to cope. A jewellery brand had two people copying WhatsApp order details into a spreadsheet by hand. A coaching institute answered the same eight questions about fees and batch timings hundreds of times a week. A clinic lost bookings overnight because nobody was awake to confirm a slot. None of them had a messaging problem — they had a repetition problem that messaging made visible.",
    "The tools available to them made a specific trade. Cheap ones automated through unofficial clients and got numbers banned. Serious ones covered WhatsApp properly and ignored Instagram, YouTube and Google reviews entirely, so the same customer arrived as three unrelated strangers. And nearly all of them resold AI credits at a markup, which meant the busier you got, the less the economics worked.",
    "So we built the version we wanted to exist: every channel on its owner's official API, one contact record across all of them, and AI that runs on your own provider key so the cost of a reply is a line in your dashboard rather than a number we choose. That is the whole thesis, and every decision below follows from it.",
  ],
  values: [
    { title: "Customer-obsessed", body: "Every feature starts with a real conversation a business is struggling to handle at scale." },
    { title: "Compliant by design", body: "Official APIs, opt-in respected, guardrails in code. We grow channels, we don't get them blocked." },
    { title: "Transparent & open", body: "Bring your own AI key, own your data, no lock-in. Your business runs on your terms." },
    { title: "Built to scale", body: "Multi-tenant isolation, encrypted vaults and infrastructure that grows from one number to thousands." },
  ],
  // Named audiences with the situation each one is in — the "who is this for"
  // that a values list implies but never actually says.
  audience: [
    { who: "D2C & retail brands", body: "Taking orders, answering stock and delivery questions, and re-engaging past buyers — in chat rather than on a website nobody returns to." },
    { who: "Service & local businesses", body: "Clinics, salons, real estate, travel and repair: booking appointments, confirming slots, and keeping Google reviews answered." },
    { who: "Education & healthcare", body: "High-volume, repetitive enquiries about fees, batches, availability and eligibility, answered accurately from your own material." },
    { who: "Agencies & creators", body: "Agencies running isolated client accounts side by side, and creators whose Instagram DMs and comments are the business itself." },
  ],
  // Verifiable commitments, each tied to the published rule it follows. Written
  // as promises we can be held to, not adjectives.
  commitments: [
    { title: "Official APIs only", body: "Every channel runs on the platform owner's documented API — Meta's WhatsApp Cloud API, Instagram Platform and Messenger Platform, the YouTube Data API, Google Business Profile. No unofficial clients, no browser scraping, because those are what get an account banned." },
    { title: "Opt-in respected", body: "Broadcasts go to contacts who opted in, using templates approved by Meta, inside the windows Meta's own messaging policy defines. The platform enforces this in code rather than trusting a checkbox." },
    { title: "Your key, your costs", body: "AI replies run on your Gemini, OpenAI or Anthropic key. We do not resell tokens, so there is no incentive for us to make replies longer or more frequent than they need to be." },
    { title: "Your data, exportable", body: "Each business is isolated with row-level security and encrypted channel tokens. Contacts, conversations and flows can be exported or deleted at any time, without asking us." },
  ],
};
