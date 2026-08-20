// Per-page answer content: the "In short" summary, the page's own FAQ set, and
// the primary sources behind its factual claims.
//
// Why each page gets its OWN FAQs instead of reusing the shared FAQS list: the
// same question/answer pair published on several URLs splits the signal between
// them and reads as boilerplate to both crawlers and people. A visitor on
// /pricing wants billing answers; one on /status wants "why is it delayed".
//
// `updated` is a manual editorial signal — bump it when the page's copy changes
// materially, not on every deploy. It drives both the visible "Last updated"
// line and `dateModified` in the page's WebPage schema.

import type { FaqItem } from "./schema";
import type { Source } from "../_components/seo";
import { TIERS, CREATOR_TIERS, ANNUAL_DISCOUNT } from "./site";
import { EXTENSION_STORE_URL } from "./schema";

// Prices quoted in prose are derived from the same TIERS the pricing table
// renders. Written by hand, an earlier draft of this file said business plans
// "run ₹999–₹5,999" — ₹999 is the Creator tier; the cheapest business plan is
// ₹1,999. Deriving them makes that class of mistake impossible.
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const monthly = (tiers: typeof TIERS) => tiers.map(t => t.priceMonthly).filter((n): n is number => typeof n === "number");
const range = (tiers: typeof TIERS) => {
  const p = monthly(tiers);
  return `${inr(Math.min(...p))}–${inr(Math.max(...p))}/mo`;
};
export const BIZ_RANGE = range(TIERS);
export const CREATOR_RANGE = range(CREATOR_TIERS);
export const CREATOR_FLOOR = `${inr(Math.min(...monthly(CREATOR_TIERS)))}/mo`;
export const ANNUAL_OFF = `${Math.round(ANNUAL_DISCOUNT * 100)}%`;

export type PageSeo = {
  updated: string;
  published: string;
  faqs: FaqItem[];
  sources: Source[];
};

// Primary sources, reused across pages. Every channel Talko AI automates is
// somebody else's platform with published rules and published prices — linking
// those is how a claim about them gets supported rather than asserted.
const SRC = {
  whatsapp: { label: "Meta — WhatsApp Business Platform", href: "https://business.whatsapp.com/", note: "the official API Talko AI connects through" },
  whatsappPricing: { label: "Meta — WhatsApp Business Platform pricing", href: "https://developers.facebook.com/docs/whatsapp/pricing", note: "Meta's per-conversation rates, billed to you by Meta, not by us" },
  whatsappPolicy: { label: "WhatsApp Business Messaging Policy", href: "https://www.whatsapp.com/legal/business-policy/", note: "the opt-in and content rules every broadcast must follow" },
  cloudApi: { label: "Meta — WhatsApp Cloud API documentation", href: "https://developers.facebook.com/docs/whatsapp/cloud-api", note: "message types, templates and the 24-hour customer service window" },
  instagram: { label: "Meta — Instagram Platform documentation", href: "https://developers.facebook.com/docs/instagram-platform", note: "the DM and comment permissions behind Instagram automation" },
  messenger: { label: "Meta — Messenger Platform documentation", href: "https://developers.facebook.com/docs/messenger-platform", note: "Facebook Page messaging and private replies" },
  youtube: { label: "Google — YouTube Data API v3", href: "https://developers.google.com/youtube/v3", note: "how comment threads are read and replied to" },
  gbp: { label: "Google Business Profile Help", href: "https://support.google.com/business/", note: "review-reply rules for Google listings" },
  webhooks: { label: "Meta — Graph API webhooks", href: "https://developers.facebook.com/docs/graph-api/webhooks", note: "how inbound messages reach the platform" },
  gemini: { label: "Google — Gemini API pricing", href: "https://ai.google.dev/pricing", note: "one of the provider keys you can bring" },
  openai: { label: "OpenAI — API pricing", href: "https://openai.com/api/pricing/", note: "another supported provider key" },
  anthropic: { label: "Anthropic — pricing", href: "https://www.anthropic.com/pricing", note: "another supported provider key" },
  chromeStore: { label: "Talko Copilot — Chrome Web Store listing", href: EXTENSION_STORE_URL, note: "the official install page, permissions and reviews" },
} satisfies Record<string, Source>;

// ── /features ───────────────────────────────────────────────────────────────

export const FEATURES_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-06-01",
  faqs: [
    {
      q: "What is conversation automation?",
      a: "Conversation automation is software that reads an incoming message — a WhatsApp enquiry, an Instagram DM, a YouTube comment, a Google review — works out what it means, and then answers it, routes it to a person, or triggers a follow-up. Talko AI does this with AI grounded on your own knowledge base, so replies come from your pricing, policies and catalog rather than a general-purpose model's guesses.",
    },
    {
      q: "Which channels can Talko AI automate?",
      a: "Six: WhatsApp Business, Instagram DMs and comments, Facebook Messenger, YouTube comments, Google Business Profile reviews, and a web-chat widget for your own website. Each one is a channel inside a single platform rather than a separate product, so the same AI, knowledge base, flows, contact records and team permissions apply everywhere.",
    },
    {
      q: "How is this different from a WhatsApp-only tool?",
      a: "Most tools in this category automate one platform. When the same customer asks the same question in an Instagram DM, under a YouTube video and on your website, a WhatsApp-only tool answers one of the three. Talko AI answers all three from one knowledge base and files them against one contact, so you see a single customer instead of three strangers.",
    },
    {
      q: "Do I need a developer to set this up?",
      a: "No. Connecting WhatsApp, Instagram or Messenger is a permissions flow you click through with your own Meta account. The website widget is one line of HTML. Flows are drag-and-build. The only genuinely technical step is pasting an AI provider key, and the setup guides cover that screen by screen.",
    },
    {
      q: "What does 'bring your own AI key' mean for my costs?",
      a: "AI replies run on your own Gemini, OpenAI or Anthropic key instead of credits resold by us. You pay your provider directly at their published rates, and your Talko AI subscription covers the platform alone. AI spend stays visible in your provider dashboard, and a busy month raises that bill rather than producing a surprise overage invoice from us.",
    },
    {
      q: "Should I use AI replies or a chatbot flow?",
      a: "Use a flow when the path is fixed and the collected data matters — booking a demo, qualifying a lead, taking an order. Use AI replies when the questions are open-ended and endless — pricing, availability, policies, whether a product fits. Most businesses run both: a flow for the transaction, AI for everything around it.",
    },
  ],
  sources: [SRC.whatsapp, SRC.instagram, SRC.messenger, SRC.youtube, SRC.gbp],
};

// ── /pricing ────────────────────────────────────────────────────────────────

export const PRICING_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-06-01",
  faqs: [
    {
      q: "How much does Talko AI cost?",
      a: `Business plans run ${BIZ_RANGE} on monthly billing. Creator plans, which are Instagram-first, run ${CREATOR_RANGE}. Annual billing takes ${ANNUAL_OFF} off any of them. Scale is quoted per account because it is sized to your message volume and the number of channels and numbers you connect. Every plan begins with a 14-day free trial and no credit card.`,
    },
    {
      q: "What is included in the free trial?",
      a: "The whole platform for 14 days — every channel your plan covers, AI replies, chatbot flows, broadcasts, sequences and the unified inbox. No credit card is needed to start and nothing bills automatically when the trial ends; you pick a plan when you are ready.",
    },
    {
      q: "Are WhatsApp message fees included in the plan price?",
      a: "No, and no tool can include them. Meta charges per conversation directly to your own WhatsApp Business account at rates it publishes by country and message category. Your Talko AI plan covers the platform; Meta's per-conversation fees and your AI provider's usage are billed by them, at their rates, with no markup added by us.",
    },
    {
      q: "Do I pay extra for AI usage?",
      a: "Not to us. AI replies run on your own Gemini, OpenAI or Anthropic key, so usage is billed by that provider at their published rates and stays visible in their dashboard. You can cap, rotate or revoke the key at any time without touching your subscription.",
    },
    {
      q: "Can I change or cancel my plan later?",
      a: "Yes. Upgrade, downgrade or cancel from billing settings whenever you like. On monthly billing there is no commitment to unwind at all; on annual billing the discount is the trade for the longer term. Either way your contacts, conversation history and flows stay exportable the whole time.",
    },
    {
      q: "Which plan should I choose?",
      a: `If customers reach you mainly on WhatsApp and a team answers them, start on a business plan. If you are a creator or influencer whose volume is Instagram DMs and comments, the Creator plans start at ${CREATOR_FLOOR} and skip the WhatsApp business stack you would not use. If you run more than a handful of numbers, brands or channels, ask for a Scale quote instead of stacking plans.`,
    },
    {
      q: "Do you offer annual billing or volume pricing?",
      a: `Yes to both. Annual billing is ${ANNUAL_OFF} cheaper per month than monthly on the same plan — switch the toggle above the pricing table to see the annual rate. Volume pricing, for high message counts or many connected numbers and brands, is quoted per account: send us your expected monthly volume and the channels you need.`,
    },
  ],
  sources: [SRC.whatsappPricing, SRC.gemini, SRC.openai, SRC.anthropic],
};

// ── /about ──────────────────────────────────────────────────────────────────

export const ABOUT_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-06-01",
  faqs: [
    {
      q: "What is Talko AI?",
      a: "Talko AI is a customer conversation platform. It connects the channels people already message businesses on — WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat — into one inbox, and uses AI grounded on your own knowledge base to reply, qualify leads and take orders across all of them.",
    },
    {
      q: "Who is Talko AI built for?",
      a: "Businesses whose inbound message volume has outgrown the people answering it: D2C and retail brands taking orders in chat, service businesses booking appointments, education and healthcare providers fielding the same twenty questions daily, agencies running several client accounts, and creators whose Instagram DMs never stop.",
    },
    {
      q: "Who is behind Talko AI?",
      a: "Talko AI is built and operated by PM Technologies. Support and sales are handled directly by the team that writes the product rather than an outsourced desk — you can reach us at info@thetalko.in or through the contact page.",
    },
    {
      q: "Does Talko AI use official APIs?",
      a: "Yes, exclusively. Every channel runs on the platform owner's documented API — Meta's WhatsApp Cloud API, Instagram Platform and Messenger Platform, the YouTube Data API, and Google Business Profile. We do not automate through unofficial clients or browser scraping, because those are what get a business's number or account banned.",
    },
    {
      q: "Where is my data stored, and who owns it?",
      a: "You do. Every business is isolated at the database level with row-level security, channel tokens are encrypted at rest, and AI replies run on your own provider key rather than a shared pool. Contacts, conversations and flows can be exported or deleted whenever you want.",
    },
  ],
  sources: [SRC.whatsappPolicy, SRC.cloudApi, SRC.instagram, SRC.gbp],
};

// ── /blog ───────────────────────────────────────────────────────────────────

export const BLOG_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-06-01",
  faqs: [
    {
      q: "What is this blog about?",
      a: "Practical messaging automation: how to set up WhatsApp, Instagram, Messenger, YouTube and Google review automation without breaking platform rules, what each channel's limits actually are, and the playbooks businesses use to turn conversations into revenue. Product updates land here too, but the bulk is how-to.",
    },
    {
      q: "Who should read it?",
      a: "Owners and marketers at small and mid-sized businesses who answer customer messages themselves, support and sales leads deciding what to automate first, agencies running messaging for clients, and creators trying to keep up with Instagram DMs.",
    },
    {
      q: "How often do you publish?",
      a: "When there is something worth saying — typically a playbook or compliance explainer every few weeks, plus a write-up whenever a channel changes its rules in a way that affects how you should be sending. Shipped changes are logged separately on the changelog.",
    },
    {
      q: "What is the difference between the blog and the guides?",
      a: "Guides are step-by-step setup instructions for a specific task, such as connecting Instagram or turning on AI replies. The blog is the thinking around them: why a channel behaves the way it does, what to automate in which order, and what the rules mean in practice.",
    },
  ],
  sources: [SRC.whatsappPolicy, SRC.cloudApi, SRC.instagram, SRC.youtube],
};

// ── /guides ─────────────────────────────────────────────────────────────────

export const GUIDES_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-07-01",
  faqs: [
    {
      q: "How long does it take to set up Talko AI?",
      a: "Most individual guides take five to ten minutes, and each one lists its own time estimate. A realistic first session — create the account, connect one channel, add your AI key, switch on auto-replies — runs about half an hour, most of which is Meta's own verification screens rather than anything inside Talko AI.",
    },
    {
      q: "Which guide should I start with?",
      a: "Start with Getting started, which covers the account and your first channel end to end. Then follow Connect a channel for each additional place your customers message you, and finish with Automate to turn on the AI replies, flows and sequences that do the actual work.",
    },
    {
      q: "Do I need a developer to follow these guides?",
      a: "No. Every step is a screen in Talko AI or in your own Meta or Google account, described in plain language. The single copy-and-paste step is the website widget's one line of HTML, and the guide shows exactly where it goes.",
    },
    {
      q: "What do I need before I start?",
      a: "For WhatsApp, Instagram or Messenger: admin access to your own Meta Business account and the phone number, Instagram account or Facebook Page you want to connect. For AI replies: an API key from Gemini, OpenAI or Anthropic. For the website widget: the ability to paste one line into your site's HTML. Each guide restates its own prerequisites first.",
    },
    {
      q: "Something is not working — where should I look?",
      a: "Start with the troubleshooting guide, which is organised by symptom rather than by feature, so you can find the case that matches what you are seeing and read the cause and fix. If the symptom is that nothing is sending at all, check the system status page before anything else.",
    },
  ],
  sources: [SRC.cloudApi, SRC.instagram, SRC.messenger, SRC.youtube, SRC.gbp],
};

// ── /changelog ──────────────────────────────────────────────────────────────

export const CHANGELOG_SEO: Omit<PageSeo, "updated"> = {
  // `updated` is deliberately absent — the changelog's real freshness signal is
  // the date of its newest entry, so the page derives it from CHANGELOG[0]
  // rather than carrying a constant that could silently fall behind.
  published: "2026-06-01",
  faqs: [
    {
      q: "How often does Talko AI ship?",
      a: "Continuously, in small changes rather than quarterly releases. Anything customer-visible is written up here in plain language on the day it goes out, tagged New, Improved or Fixed. Internal refactors and infrastructure work are not listed, because they change nothing you can see.",
    },
    {
      q: "Do I need to update anything when a change ships?",
      a: "Almost never. Talko AI is hosted, so improvements and fixes reach your account automatically with no upgrade step. The exceptions are called out in the entry itself — for example a new channel you have to connect, or a new setting that starts switched off until you turn it on.",
    },
    {
      q: "How do I request a feature or report a bug?",
      a: "Send it through the contact page or to info@thetalko.in. Requests that come with the specific situation behind them — the channel, what you were trying to do, what happened instead — are the ones that turn into entries on this page fastest.",
    },
    {
      q: "Where can I see whether the platform is running normally right now?",
      a: "The system status page reports the live state of the background engine that sends every automated reply, broadcast and comment response. This changelog covers what changed; status covers what is working at this moment.",
    },
  ],
  sources: [SRC.cloudApi, SRC.instagram, SRC.youtube, SRC.gbp],
};

// ── /status ─────────────────────────────────────────────────────────────────

export const STATUS_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-07-01",
  faqs: [
    {
      q: "What does this page actually measure?",
      a: "One thing, directly: whether the background engine that runs every automated action has checked in recently. That engine wakes on a fixed schedule and records a heartbeat each time it completes a pass, and this page reads that heartbeat. It is a live measurement of our own infrastructure, not a hand-updated status badge.",
    },
    {
      q: "Why do all the systems share one status?",
      a: "Because they share one engine. AI replies, broadcasts, drip sequences, comment automation and review replies are all jobs run by the same background worker. If it is healthy they are all being processed; if it has stalled they all queue together. Reporting them separately would imply independent monitoring that does not exist.",
    },
    {
      q: "It says operational, but my messages are not sending. What now?",
      a: "That points at the channel rather than the platform: an expired or revoked Meta token, a WhatsApp number that has not been subscribed to webhooks, a template still awaiting approval, or a message outside the 24-hour customer service window. The troubleshooting guide is organised by exactly these symptoms.",
    },
    {
      q: "What does 'delayed' mean for my customers?",
      a: "Queued work is running behind, not lost. Automated replies, broadcasts and comment responses are processed in order once the engine catches up, so a delay shows up as slower responses rather than missing ones. Live Chat messages your team sends by hand are unaffected — they go out immediately and do not wait on the engine.",
    },
    {
      q: "Do you post incidents here?",
      a: "Yes. Anything customer-visible gets an entry in the incident history below with what broke, who it affected and how it was resolved. If the page shows a clean history, nothing customer-visible has been recorded — not that nothing has been written down.",
    },
  ],
  sources: [SRC.cloudApi, SRC.webhooks, SRC.gbp],
};

// ── /industries ─────────────────────────────────────────────────────────────

export const INDUSTRIES_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-06-01",
  faqs: [
    {
      q: "Which industries does Talko AI have a playbook for?",
      a: "Six, each documented on this page and in its own detailed guide: D2C and e-commerce, EdTech and education, healthcare and clinics, real estate, restaurants, and travel. They aren't separate products — every playbook is the same platform's building blocks (AI replies, chatbot flows, broadcasts, drip sequences, in-chat payments) arranged for how that sector actually sells and supports.",
    },
    {
      q: "What if my industry isn't listed?",
      a: "The building blocks don't care what you sell. If your business answers repetitive enquiries, qualifies leads, books appointments or takes orders in chat, the nearest playbook above is a working starting point — most businesses adapt one rather than starting from nothing. Tell us what you do and we'll point you at the closest fit.",
    },
    {
      q: "How much of a playbook can I run without a developer?",
      a: "All of it. Flows are drag-and-build, broadcasts use templates you submit from the portal, and the AI is grounded by uploading your own material. The only technical step in any playbook is pasting an AI provider key, and the website widget's single line of HTML.",
    },
    {
      q: "Are these playbooks compliant on WhatsApp?",
      a: "They're built to be. Every one uses Meta's official APIs, sends promotional messages only to contacts who opted in, and uses templates in the category Meta approved them under. The recovery and re-engagement steps fire once rather than repeatedly, because repeated unsolicited sends are what get a number rate-limited or blocked.",
    },
    {
      q: "Can one account run more than one industry playbook?",
      a: "Yes. A business that both sells products and books appointments can run the e-commerce and service flows side by side in the same workspace, on the same number. Agencies go a step further and run a separate isolated workspace per client, each with its own channels, knowledge base and AI key.",
    },
    {
      q: "How is a playbook different from the features list?",
      a: "The features page tells you what the platform can do. A playbook tells you which of those to switch on, in what order, for a specific kind of business — including the parts most people skip, like grounding the AI on your own policies before letting it answer refund questions.",
    },
  ],
  sources: [SRC.whatsappPolicy, SRC.cloudApi, SRC.instagram, SRC.gbp],
};

// ── /contact ────────────────────────────────────────────────────────────────

export const CONTACT_SEO: PageSeo = {
  updated: "2026-08-05",
  published: "2026-06-01",
  faqs: [
    {
      q: "How quickly will I get a reply?",
      a: "Within one business day for sales and general enquiries, and usually the same day for support during Indian business hours. A person answers — the contact form does not open a ticket that an automation replies to.",
    },
    {
      q: "Can I get a demo before I sign up?",
      a: "Yes. Ask for a walkthrough in the message and we will book a call that covers your channels, your message volume and the plan that fits, rather than a generic feature tour. You can also start a 14-day trial first and bring questions to the call.",
    },
    {
      q: "What should I include so you can help faster?",
      a: "For support: the channel involved (WhatsApp, Instagram, Messenger, YouTube, Google reviews or web chat), what you were doing, what you expected and what happened instead. For sales: your rough monthly message volume and the channels you need. That is usually the difference between one reply and four.",
    },
    {
      q: "Should I contact you or check the guides first?",
      a: "If the problem is that something is not working, the troubleshooting guide resolves most cases faster than we can, because it is organised by symptom and lists the cause and fix for each. If nothing is sending at all, check the status page first. For anything about plans, pricing, partnerships or press, write in.",
    },
    {
      q: "Do you work with agencies and resellers?",
      a: "Yes. Agencies run multiple client accounts on Talko AI, each isolated with its own channels, knowledge base and AI key. Tell us how many brands you manage and we will quote the right structure instead of a stack of separate subscriptions.",
    },
  ],
  sources: [SRC.whatsapp, SRC.whatsappPolicy, SRC.gbp],
};

// ── /extension ──────────────────────────────────────────────────────────────

export const EXTENSION_SEO: PageSeo = {
  updated: "2026-08-20",
  published: "2026-08-20",
  faqs: [
    {
      q: "Is the Talko Copilot Chrome extension free?",
      a: "Yes, the extension itself is free to install. It's a side-panel window into your existing Talko AI account — you'll need an active Talko AI plan (including the free 14-day trial) to send messages, since that's where WhatsApp, Instagram and Messenger are actually connected.",
    },
    {
      q: "What can I do from the extension that I can't do in the Talko AI web app?",
      a: "The extension's specific advantage is working alongside whatever page you're already on: highlight a name, email or phone number on any webpage and add it to Talko as a lead without switching tabs, or open the side panel to reply to a customer while you're looking at their order on a different site. Everything else — the unified inbox, catalog search, payment links, AI-drafted replies — mirrors the web app.",
    },
    {
      q: "Does the extension read or scrape data from the pages I visit?",
      a: "No. Talko Copilot only acts on a webpage when you explicitly highlight text to capture as a lead — it does not scan, scrape or automatically read page content in the background, and every message it sends or receives goes through WhatsApp's, Instagram's and Facebook's own official APIs, never browser automation.",
    },
    {
      q: "Which browsers does it support?",
      a: "Talko Copilot is published on the Chrome Web Store and works in Chrome and any Chromium-based browser that supports Chrome extensions (Edge, Brave, Arc). It is not currently available for Firefox or Safari.",
    },
    {
      q: "Will a reply I send from the extension still respect WhatsApp's 24-hour window?",
      a: "Yes. The extension enforces the same rules as the Talko AI web app — outside WhatsApp's 24-hour customer service window, you can only send an approved template, not a free-form message. The side panel tells you which one applies before you send.",
    },
  ],
  sources: [SRC.chromeStore, SRC.whatsapp, SRC.whatsappPolicy, SRC.instagram, SRC.messenger],
};
