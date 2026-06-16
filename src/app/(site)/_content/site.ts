// Marketing-site content for Talko AI. Single source of truth for all copy
// so pages stay consistent. Pure data — no JSX — usable from server components.

export const SITE = {
  name: "Talko AI",
  tagline: "AI conversations for WhatsApp & Instagram",
  domainCta: { trial: "/signup", login: "/login" },
};

export const NAV: { label: string; href: string }[] = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
];

export const HERO = {
  eyebrow: "WhatsApp + Instagram, on autopilot",
  title: "Enhance your customer conversations with Talko AI",
  subtitle:
    "The all-in-one platform to automate WhatsApp & Instagram — AI replies in your own voice, broadcasts, chatbot flows, drip sequences, catalog checkout and growth tools. One inbox, every conversation.",
  primary: { label: "Start free 14-day trial", href: "/signup" },
  secondary: { label: "See pricing", href: "/pricing" },
  note: "No credit card required · Bring your own AI key · Cancel anytime",
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
  { icon: "bot", title: "AI replies in your voice", body: "Grounded auto-replies from your own knowledge base. Bring your own Gemini, OpenAI or Anthropic key — usage stays on your account." },
  { icon: "megaphone", title: "Broadcasts that land", body: "Send template campaigns to thousands, schedule sends, and track delivery, reads and clicks — without tripping spam limits." },
  { icon: "workflow", title: "No-code chatbot flows", body: "Drag-and-build conversation flows that qualify leads, book appointments and answer FAQs around the clock." },
  { icon: "repeat", title: "Drip sequences", body: "Automated follow-ups triggered by keywords, opt-ins, tags, abandoned carts or ad referrals — set once, runs forever." },
  { icon: "shopping", title: "Catalog & checkout", body: "Show products, build carts and recover abandoned ones, all inside the chat your customer already uses." },
  { icon: "instagram", title: "Instagram, done right", body: "Auto-reply to DMs and turn post comments into DMs — fully inside Meta's rules (24-hour window, no cold DMs)." },
  { icon: "inbox", title: "One unified inbox", body: "Every WhatsApp and Instagram conversation in a single live inbox, with team assignment, labels and quick replies." },
  { icon: "shield", title: "Multi-tenant & secure", body: "Per-business isolation, encrypted token vault, RLS-backed data separation and full audit trails by design." },
];

export type Step = { n: string; title: string; body: string };
export const STEPS: Step[] = [
  { n: "01", title: "Connect your channels", body: "Link a WhatsApp number and an Instagram account in a couple of clicks. Each gets its own AI persona and flows." },
  { n: "02", title: "Teach your AI", body: "Upload docs, FAQs and product info. Add your own AI key and Talko AI grounds every reply on your business." },
  { n: "03", title: "Automate & broadcast", body: "Turn on auto-replies, launch broadcasts, build flows and sequences — then watch conversations convert." },
];

export type Tier = {
  name: string; priceMonthly: number | null; customLabel?: string; tagline: string;
  features: string[]; cta: string; href: string; highlighted?: boolean;
};
export const TIERS: Tier[] = [
  {
    name: "Starter", priceMonthly: 1999, tagline: "For solo founders getting started",
    features: ["1 WhatsApp number", "1,000 conversations / mo", "AI auto-replies (your key)", "Broadcasts & templates", "Unified inbox", "2 team seats"],
    cta: "Start free trial", href: "/signup",
  },
  {
    name: "Growth", priceMonthly: 4999, tagline: "For growing teams that automate", highlighted: true,
    features: ["3 channels (WhatsApp + Instagram)", "10,000 conversations / mo", "Chatbot flows & drip sequences", "Catalog & cart recovery", "Growth tools & ad → chat", "10 team seats"],
    cta: "Start free trial", href: "/signup",
  },
  {
    name: "Scale", priceMonthly: null, customLabel: "Custom", tagline: "For high-volume & multi-brand",
    features: ["Unlimited channels", "Custom message volume", "Priority support & onboarding", "Dedicated success manager", "Advanced roles & audit logs", "Custom integrations"],
    cta: "Talk to sales", href: "/signup",
  },
];

// ── "How your chatbot flow works" — node graph ───────────────────────────────
export type FlowBranch = { title: string; body: string; tone: "sky" | "lavender" | "peach"; icon: string };
export const CHAT_FLOW = {
  trigger: { title: "Customer message", body: "Arrives on WhatsApp or Instagram", icon: "message" },
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
  { q: "Do I need my own WhatsApp Business account?", a: "Yes — Talko AI connects your own WhatsApp number and Instagram account through Meta's official APIs, so your brand and number stay yours. We guide you through connecting in minutes." },
  { q: "What does 'bring your own AI key' mean?", a: "AI replies run on your own Gemini, OpenAI or Anthropic key, which you add in settings. Usage is billed to your provider account, so costs are transparent and fully under your control." },
  { q: "Is there a free trial?", a: "Every plan starts with a 14-day free trial. No credit card required to start — explore the full platform and only subscribe when you're ready." },
  { q: "Is my data secure?", a: "Each business is fully isolated with row-level security, your channel tokens are encrypted at rest, and we run on dedicated infrastructure. You own your data and can export or delete it anytime." },
  { q: "Can I use it for both WhatsApp and Instagram?", a: "Yes. Both run through the same unified inbox, AI engine, flows and sequences — Instagram is a channel, not a separate product." },
  { q: "Can my whole team use it?", a: "Absolutely. Assign conversations, set roles, use shared quick replies and keep a full activity log across your team." },
];

export type Post = {
  slug: string; title: string; excerpt: string; date: string; category: string; readTime: string;
  body: string[];
};
export const POSTS: Post[] = [
  {
    slug: "whatsapp-automation-guide",
    title: "How automation is transforming customer messaging",
    excerpt: "WhatsApp and Instagram are now the front door to your business. Here's how automation turns them into your best sales channel.",
    date: "June 12, 2026", category: "Playbook", readTime: "6 min read",
    body: [
      "Messaging has quietly become the primary way customers reach brands. The average person opens a WhatsApp message within minutes — a response rate email and ads can only dream of. Yet most businesses still treat chat as an afterthought, answering manually, slowly, and only during office hours.",
      "Automation changes the economics. With grounded AI replies, the moment a customer asks a question — about pricing, availability, or your return policy — they get an accurate answer instantly, in your brand's voice, at any hour. The conversations that genuinely need a human are escalated cleanly, so your team spends time where it matters.",
      "The compounding wins come from the layers on top: broadcasts that re-engage past customers, drip sequences that nurture leads, and flows that qualify and book without a single human touch. Done well, a single conversation becomes a repeatable, measurable funnel.",
      "The key is doing it within the rules. Official APIs, opt-in respected, no cold outreach, and a clear escalation path. That's the difference between a channel that scales and one that gets your number blocked.",
    ],
  },
  {
    slug: "bring-your-own-ai-key",
    title: "Why we let you bring your own AI key",
    excerpt: "Predictable costs, full model control, and no lock-in. Here's the thinking behind per-account AI keys.",
    date: "June 5, 2026", category: "Product", readTime: "4 min read",
    body: [
      "Most platforms bundle AI into an opaque per-message fee. It feels simple until volume grows and the bill becomes impossible to predict — or you're stuck on a model you didn't choose.",
      "We took the opposite approach. You add your own Gemini, OpenAI or Anthropic key, and Talko AI uses it for your replies. Usage is billed directly to your provider account, so you see exactly what you spend and can pick the model that fits your budget and quality bar.",
      "It also means no lock-in. Switch models or providers whenever you like — your flows, knowledge base and inbox stay exactly the same. Your key is encrypted at rest and never leaves our vault.",
    ],
  },
  {
    slug: "instagram-dm-best-practices",
    title: "Instagram DMs: what's allowed, and what gets you blocked",
    excerpt: "A practical guide to automating Instagram messaging without breaking Meta's rules.",
    date: "May 28, 2026", category: "Compliance", readTime: "5 min read",
    body: [
      "Instagram is a goldmine for conversational commerce — but Meta's rules are strict, and ignoring them is the fastest way to lose access. The good news: the rules are sensible, and you can automate aggressively while staying fully compliant.",
      "The core constraints are simple. You can reply to anyone who messaged you within a 24-hour window. You can turn a comment into a single private reply when someone comments on your post. What you cannot do is send cold DMs to people who never interacted with you.",
      "Talko AI enforces these guardrails in code — the 24-hour window, comment-to-DM as a single message, per-account pacing, and opt-out handling are all built in. You get the automation upside without the risk of a ban.",
    ],
  },
];

// ── n8n-style agent canvas — "what one automation looks like" ────────────────
// A horizontal node graph: trigger → AI Agent (with model/memory/tool sub-nodes)
// → router → channel actions. Mirrors the builder so the marketing site shows the
// actual product capability, not a static mock.
export type CanvasNode = { id: string; icon: string; title: string; sub?: string; accent?: boolean };
export const AGENT_CANVAS = {
  trigger: { id: "trigger", icon: "zap", title: "Customer messages", sub: "WhatsApp or Instagram" },
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
// Each business problem maps to a clean left-to-right flow. Kept conceptual
// (business-outcome nodes, not a build recipe) — it shows WHAT we solve and how
// fast, without exposing the underlying implementation.
export type FlowNodeDef = { icon: string; title: string; sub: string; accent?: boolean };
export type UseCase = { key: string; tab: string; problem: string; outcome: string; nodes: FlowNodeDef[] };
export const USE_CASES: UseCase[] = [
  {
    key: "leads",
    tab: "Capture & qualify leads",
    problem: "Leads message after hours and go cold before sales replies",
    outcome: "Every lead captured, qualified and routed in seconds — 24/7, no rep online.",
    nodes: [
      { icon: "zap", title: "New enquiry", sub: "WhatsApp, Instagram or ad click" },
      { icon: "bot", title: "AI qualifies", sub: "Intent, budget & timeline", accent: true },
      { icon: "user", title: "Save to CRM", sub: "Tagged, scored contact" },
      { icon: "bell", title: "Alert sales", sub: "Assigned in the inbox" },
    ],
  },
  {
    key: "support",
    tab: "Answer support 24/7",
    problem: "Customers wait hours for a reply to simple questions",
    outcome: "Most questions resolved instantly; only the tricky ones reach your team.",
    nodes: [
      { icon: "message", title: "Customer asks", sub: "Any hour, any channel" },
      { icon: "bot", title: "AI answers", sub: "Grounded on your knowledge base", accent: true },
      { icon: "check", title: "Resolved instantly", sub: "On-brand, accurate reply" },
      { icon: "handoff", title: "Escalate if needed", sub: "Clean hand-off to a human" },
    ],
  },
  {
    key: "carts",
    tab: "Recover abandoned carts",
    problem: "Carts are abandoned with no way to follow up in chat",
    outcome: "Win back revenue automatically — inside the chat they already use.",
    nodes: [
      { icon: "shopping", title: "Cart abandoned", sub: "Checkout left incomplete" },
      { icon: "clock", title: "Smart wait", sub: "Nudges at the right moment" },
      { icon: "bot", title: "AI re-engages", sub: "Personalized, in your voice", accent: true },
      { icon: "card", title: "Checkout link", sub: "One tap to complete" },
    ],
  },
  {
    key: "broadcasts",
    tab: "Re-engage with broadcasts",
    problem: "Re-marketing campaigns get your number flagged or banned",
    outcome: "Reach thousands compliantly — opt-in respected, quality auto-protected.",
    nodes: [
      { icon: "user", title: "Pick a segment", sub: "Tags, attributes, activity" },
      { icon: "shield", title: "Consent & tier check", sub: "Only opted-in, within limits", accent: true },
      { icon: "megaphone", title: "Send template", sub: "Approved, scheduled" },
      { icon: "chart", title: "Track & auto-pause", sub: "On any quality dip" },
    ],
  },
  {
    key: "booking",
    tab: "Book appointments",
    problem: "Booking takes endless back-and-forth and staff time",
    outcome: "Fill your calendar on autopilot, with reminders that cut no-shows.",
    nodes: [
      { icon: "message", title: "Enquiry arrives", sub: "“Can I book a slot?”" },
      { icon: "bot", title: "AI collects details", sub: "Service, date, contact", accent: true },
      { icon: "calendar", title: "Books the slot", sub: "Synced to your calendar" },
      { icon: "bell", title: "Confirm & remind", sub: "Auto follow-ups before" },
    ],
  },
];

// ── Business problem → one-platform solution ─────────────────────────────────
export type ProblemSolution = { problem: string; solution: string; icon: string };
export const PROBLEMS: ProblemSolution[] = [
  { icon: "clock", problem: "Leads message after hours and go cold before anyone replies.", solution: "AI replies in seconds, 24/7, in your brand voice — and books or escalates the ones that matter." },
  { icon: "inbox", problem: "Conversations are scattered across WhatsApp, Instagram DMs and personal phones.", solution: "One unified inbox with team assignment, labels and quick replies across every channel." },
  { icon: "megaphone", problem: "Broadcasts get the number flagged or banned by Meta.", solution: "Opt-in respected, 24h-window enforced, quality auto-pause and per-tier pacing baked in." },
  { icon: "shopping", problem: "Carts get abandoned and there's no way to follow up in chat.", solution: "Catalog, checkout and automated cart-recovery sequences — all inside the chat they already use." },
  { icon: "workflow", problem: "Every tool needs a developer and they don't talk to each other.", solution: "No-code flows, sequences and growth tools in one platform — launch in an afternoon, no engineers." },
  { icon: "shield", problem: "Customer data is spread across vendors with no real isolation.", solution: "Per-business isolation, encrypted token vault and RLS-backed separation by design." },
];

// ── Comparison: Talko AI vs the alternatives ─────────────────────────────────
export const COMPARE_COLS = ["Talko AI", "Generic WhatsApp tools", "Point solutions + DIY"] as const;
export type CompareRow = { feature: string; values: [boolean | string, boolean | string, boolean | string] };
export const COMPARE_ROWS: CompareRow[] = [
  { feature: "WhatsApp + Instagram in one inbox", values: [true, "WhatsApp only", false] },
  { feature: "AI replies grounded on your knowledge base", values: [true, "Canned replies", "Separate chatbot"] },
  { feature: "Bring your own AI key (no per-message markup)", values: [true, false, false] },
  { feature: "No-code chatbot flow builder", values: [true, "Basic", "Extra tool"] },
  { feature: "Drip sequences & cart recovery", values: [true, false, "Extra tool"] },
  { feature: "Catalog & in-chat checkout", values: [true, "Add-on", false] },
  { feature: "Built-in Meta anti-ban guardrails", values: [true, "Partial", false] },
  { feature: "Opt-in, 24h-window & quality auto-pause", values: [true, false, false] },
  { feature: "Multi-tenant isolation & encrypted vault", values: [true, "Varies", false] },
  { feature: "Launch in an afternoon, no engineers", values: [true, true, false] },
];

export const SOCIAL_PROOF = "Trusted by 2,000+ growing businesses";

// "Works with your favorite tools" strip. slug = Simple Icons id (cdn.simpleicons.org);
// omit slug to render the name as a wordmark (e.g. brands without a Simple Icon).
export const INTEGRATIONS: { name: string; slug?: string }[] = [
  { name: "WhatsApp", slug: "whatsapp" },
  { name: "Instagram", slug: "instagram" },
  { name: "Messenger", slug: "messenger" },
  { name: "Stripe", slug: "stripe" },
  { name: "Gemini", slug: "googlegemini" },
  { name: "OpenAI", slug: "openai" },
  { name: "Anthropic", slug: "anthropic" },
  { name: "Meta", slug: "meta" },
  { name: "Razorpay", slug: "razorpay" },
  { name: "LeadSquared" },
];

// "Why teams choose Talko AI" — pastel benefit cards.
export type Benefit = { title: string; body: string; tone: "mint" | "sky" | "peach" };
export const WHY: Benefit[] = [
  { tone: "mint", title: "Replies in your brand voice", body: "Grounded AI answers from your own knowledge base — accurate, on-brand, and instant, not generic canned text." },
  { tone: "sky", title: "Compliant, data-driven automation", body: "Official Meta APIs, opt-in respected, guardrails in code. Scale conversations without risking your number." },
  { tone: "peach", title: "Save time and money", body: "Bring your own AI key for predictable costs, replace a stack of tools, and let automation handle the busywork." },
];

export const CTA_BULLETS = [
  "Connect a number and go live in under an hour",
  "Bring your own AI key — predictable, transparent costs",
];

export const ABOUT = {
  eyebrow: "About us",
  title: "We help businesses turn conversations into growth",
  intro:
    "Talko AI was built on a simple belief: the messaging apps your customers already love should be your most powerful sales and support channel — not your most manual one.",
  values: [
    { title: "Customer-obsessed", body: "Every feature starts with a real conversation a business is struggling to handle at scale." },
    { title: "Compliant by design", body: "Official APIs, opt-in respected, guardrails in code. We grow channels, we don't get them blocked." },
    { title: "Transparent & open", body: "Bring your own AI key, own your data, no lock-in. Your business runs on your terms." },
    { title: "Built to scale", body: "Multi-tenant isolation, encrypted vaults and infrastructure that grows from one number to thousands." },
  ],
};
