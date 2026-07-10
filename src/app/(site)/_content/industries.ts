// Industry playbooks for the marketing site. Pure data — no JSX — usable from
// server components. Every claim here mirrors a behavior proven by the
// industry simulation suites (src/lib/__tests__/scenario-*.test.ts), so the
// marketing never promises something the platform can't do.

export type ChatBubble = {
  from: "customer" | "business" | "system";
  text: string;
  chips?: string[];       // quick-reply pills rendered under a business bubble
};

export type Industry = {
  slug: string;
  name: string;            // section heading
  navLabel: string;        // short label for cards/teasers
  icon: string;            // lucide icon key (see industries.tsx ICONS map)
  headline: string;        // the industry's one-line promise
  story: string;           // 2–3 sentence use-case narrative
  business: string;        // name shown in the chat mock header
  chat: ChatBubble[];
  features: { title: string; body: string }[];
  teaser: string;          // one-liner for the homepage card
};

export const INDUSTRIES: Industry[] = [
  {
    slug: "ecommerce",
    name: "D2C & E-commerce",
    navLabel: "E-commerce",
    icon: "shopping",
    headline: "From bio link to paid order — without leaving the chat",
    story:
      "A skincare brand turns Instagram followers into WhatsApp customers: a keyword link tags and opts them in, a welcome offer lands automatically, and checkout happens on a hosted payment link inside the chat. Carts left behind trigger a recovery message — once, and only once.",
    business: "Glow Naturals",
    chat: [
      { from: "customer", text: "GET GLOW" },
      { from: "business", text: "Welcome to Glow Naturals! 🌿 Here's your 10% code: GLOW10. What are you shopping for today?", chips: ["Vitamin C serum", "Sunscreen", "Full routine"] },
      { from: "customer", text: "Vitamin C serum" },
      { from: "business", text: "Added to your cart — total ₹1,079 after GLOW10. Pay securely here 👉 pay.glownaturals.in/ord-1284" },
      { from: "system", text: "Payment received · Order #1284 confirmed" },
      { from: "business", text: "Order confirmed, Ananya! 🎉 It ships tomorrow — tracking will arrive right here." },
    ],
    features: [
      { title: "Keyword growth links", body: "wa.me links prefill a keyword, tag the contact, record opt-in and count every click and conversion." },
      { title: "Cart → payment link", body: "Catalog, cart and checkout in chat — with a hosted payment link and order status synced back." },
      { title: "Abandoned-cart recovery", body: "Idle carts automatically enter a recovery drip — exactly once, never spamming." },
      { title: "STOP-safe marketing", body: "Opt-outs are honored across every phone format before any campaign reaches Meta." },
    ],
    teaser: "Recover abandoned carts, sell with in-chat payment links, and turn bio links into tagged, opted-in buyers.",
  },
  {
    slug: "edtech",
    name: "EdTech & Coaching",
    navLabel: "EdTech",
    icon: "book",
    headline: "Every enquiry qualified, captured and nurtured — automatically",
    story:
      "A course academy answers every \"courses?\" message instantly: the bot walks prospects through program choice (typos and all), validates their email politely, drops the lead into the CRM, and keeps nurturing with a brochure drip until they reply. Real questions mid-form go straight to the AI — grounded in the academy's own prospectus.",
    business: "Ascend Academy",
    chat: [
      { from: "customer", text: "courses" },
      { from: "business", text: "Hi! 👋 Which program are you exploring?", chips: ["Data Science & GenAI", "Digital Marketing", "UI/UX Design"] },
      { from: "customer", text: "data science and gen ai" },
      { from: "business", text: "Great pick! What's the best email for your brochure?" },
      { from: "customer", text: "priya.sharma@gmail.com" },
      { from: "business", text: "Thanks Priya! Your Data Science & GenAI brochure is on its way to priya.sharma@gmail.com 📩" },
    ],
    features: [
      { title: "Guided intake flows", body: "Button menus + step-by-step questions that tolerate typos and store every answer on the contact." },
      { title: "Validated capture", body: "Emails and phone numbers are checked in-chat and retried politely — junk never reaches your CRM." },
      { title: "Brochure drips", body: "Keyword-triggered nurture sequences that pause the bot and stop the moment the lead replies." },
      { title: "CRM sync", body: "Name, course and email mirror to LeadSquared as they're captured — no exports, no re-typing." },
    ],
    teaser: "Qualify course enquiries with guided flows, validated emails, CRM sync and brochure drips.",
  },
  {
    slug: "healthcare",
    name: "Clinics & Healthcare",
    navLabel: "Healthcare",
    icon: "shield",
    headline: "Triage in seconds, consent you can prove, humans one tap away",
    story:
      "A family clinic triages every WhatsApp message: appointments flow through a menu, \"talk to a nurse\" hands the chat to staff instantly, and after-hours messages get an honest away note. Reminder broadcasts only ever reach patients with recorded consent — and voice notes are transcribed so the front desk reads them at a glance.",
    business: "Sunrise Family Clinic",
    chat: [
      { from: "customer", text: "hi" },
      { from: "business", text: "Welcome to Sunrise Family Clinic! 🌤 How can we help you today?", chips: ["Book appointment", "Lab reports", "Talk to a nurse"] },
      { from: "customer", text: "Talk to a nurse" },
      { from: "system", text: "Chat escalated · Nurse joined" },
      { from: "business", text: "Hi, this is Asha from Sunrise. I can help you right away — what's going on?" },
    ],
    features: [
      { title: "Instant human handoff", body: "One tap escalates to staff in Live Chat — misconfigured menus auto-escalate too, so patients are never stranded." },
      { title: "Provable consent", body: "Every opt-in is recorded with source, proof and timestamp; broadcasts exclude anyone unconsented." },
      { title: "Working hours & away notes", body: "Clinic hours respected to the minute — including overnight shifts — with automatic away replies." },
      { title: "Voice-note transcription", body: "Audio messages are transcribed automatically, so staff never replay a voice note to find the ask." },
    ],
    teaser: "Triage patients, escalate to staff in one tap, and send reminders only to provably consented contacts.",
  },
  {
    slug: "realestate",
    name: "Real Estate",
    navLabel: "Real estate",
    icon: "building",
    headline: "Every lead qualified, attributed and moving through your pipeline",
    story:
      "An agency qualifies property leads in chat — intent, budget, locality, each answer validated — then works them through a visual pipeline where every stage change tags the lead, starts the right drip and updates the CRM. Tracked wa.me links tell you exactly which listing portal every lead came from.",
    business: "Habitat Realty",
    chat: [
      { from: "customer", text: "Hi, saw your 2BHK listing" },
      { from: "business", text: "Welcome to Habitat Realty! Are you looking to buy or rent?", chips: ["Buy", "Rent"] },
      { from: "customer", text: "Buy" },
      { from: "business", text: "Great — what's your budget range (in lakhs)?" },
      { from: "customer", text: "80" },
      { from: "business", text: "And which locality are you considering?" },
      { from: "customer", text: "Whitefield" },
      { from: "system", text: "Lead qualified · moved to Site Visit · CRM updated" },
    ],
    features: [
      { title: "Validated qualification", body: "Budget must be a number, locality a real city — wrong answers get a polite retry, not a junk lead." },
      { title: "Pipeline automations", body: "Dragging a lead to a stage fires its tag, drip sequence and CRM stage push — automatically." },
      { title: "Source attribution", body: "Tracked wa.me links per portal or campaign tell you exactly where every lead came from." },
      { title: "Slack + webhooks", body: "New leads and messages stream to your own systems and Slack, signed and per-workspace." },
    ],
    teaser: "Qualify budget and locality in chat, attribute every lead to its source, automate pipeline stages.",
  },
  {
    slug: "restaurant",
    name: "Restaurants & Food Delivery",
    navLabel: "Restaurants",
    icon: "utensils",
    headline: "Orders in chat, blasts that fill tables — and a number that stays healthy",
    story:
      "A kitchen greets regulars by name, walks delivery vs. pickup through buttons, and fires weekend-special blasts to tagged regulars — each message personalized with the customer's name and their own tracked menu link. Built-in rails (daily caps, quality auto-pause, failure cut-offs) keep the WhatsApp number safe while you scale.",
    business: "Spice Route Kitchen",
    chat: [
      { from: "customer", text: "hi" },
      { from: "business", text: "Hi Rohan! Welcome back to Spice Route Kitchen 🍛 How would you like your order today?", chips: ["Delivery", "Pickup"] },
      { from: "customer", text: "Delivery" },
      { from: "business", text: "Perfect — delivery it is! Here's today's menu 👉 spiceroute.in/m/rohan-x2. Your usual butter chicken is on the weekend special 😉" },
    ],
    features: [
      { title: "Chat ordering flows", body: "Taps, typed answers or \"1\"/\"2\" picks all work; real questions go to the AI without losing the order." },
      { title: "Personalized blasts", body: "Weekend specials to tagged regulars — every message carries the customer's own name and tracked link." },
      { title: "Delivery receipts", body: "Sent → delivered → read tracked per recipient, with per-person link clicks on the dashboard." },
      { title: "Number-health rails", body: "Rolling daily caps, automatic pause on quality drops, and failure cut-offs — on by default." },
    ],
    teaser: "Take orders in chat and send name-personalized specials with per-customer tracked menu links.",
  },
  {
    slug: "travel",
    name: "Travel & Hospitality",
    navLabel: "Travel",
    icon: "plane",
    headline: "Trips qualified in chat, answers grounded in your own visa guides",
    story:
      "A travel agency qualifies trips message by message — destination, travellers, month — and every reply reflects what's already known: \"I'll craft a Bali itinerary for 4 travellers this December.\" Visa questions get AI answers strictly grounded in the agency's own documents; invented prices or links never reach the traveller, and \"talk to an expert\" escalates instantly.",
    business: "Wanderly Trips",
    chat: [
      { from: "customer", text: "plan a trip" },
      { from: "business", text: "Let's plan it! 🌍 Where are we headed?", chips: ["Bali", "Dubai", "Kerala"] },
      { from: "customer", text: "Bali" },
      { from: "business", text: "Lovely, Priya — Bali it is! How many travellers should I plan for?" },
      { from: "customer", text: "Do I need a visa for Bali?" },
      { from: "business", text: "Yes — Visa on Arrival is ₹3,500 per person, valid 30 days. Full checklist: wanderly.com/visa ✈️" },
    ],
    features: [
      { title: "Multi-step qualification", body: "Destination, travellers and month captured step by step — a \"2\" is two travellers, never a menu mix-up." },
      { title: "Grounded AI answers", body: "Visa fees, durations and links come only from your uploaded guides — invented facts are stripped before sending." },
      { title: "Itinerary drips", body: "Keyword-triggered day-by-day itineraries that respect WhatsApp's messaging window automatically." },
      { title: "Expert handoff + Slack", body: "\"Talk to an expert\" escalates before any bot reply — and pings your team's Slack instantly." },
    ],
    teaser: "Qualify destination, dates and travellers in chat — with visa answers grounded in your own guides.",
  },
];
