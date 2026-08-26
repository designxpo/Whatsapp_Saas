# Talko AI — Product Requirements Document (PRD)

**Product:** Talko AI — AI-native conversation platform for WhatsApp, Instagram, Messenger & website chat
**Also deployed as:** white-label tenants (e.g. "Alabs Connect")
**Document purpose:** Explain *what* was built, *how* it was built, and *what it can do*.
**Status:** Live in production (SaaS + at least one white-label client deployment)

---

## 1. Executive Summary

Talko AI is a **multi-tenant SaaS platform** that lets a business run all of its customer conversations — across **WhatsApp, Instagram, Facebook Messenger, and a website chat widget** — from a **single AI-powered inbox**.

The core idea: an AI that **replies in the business's own voice, grounded on the business's own knowledge**, handles routine conversations end to end, and hands off to a human in one click. Around that inbox sits a full go-to-market toolkit — broadcasts, no-code chatbot flows, drip sequences, a sales pipeline, in-chat catalog & checkout, campaign attribution, and cross-channel analytics.

Two things differentiate it from the incumbents (WATI, AiSensy, Interakt, Respond.io, ManyChat, Tidio):
1. **Every channel in one platform** — not WhatsApp-only, not web-only.
2. **Bring your own AI key** (Gemini / OpenAI / Anthropic) — the customer owns their AI cost with no per-message markup.

---

## 2. Problem & Opportunity

Businesses that sell and support over chat face three problems:
- **Fragmentation** — WhatsApp, Instagram DMs, Messenger, and website chat live in separate tools and inboxes.
- **Response latency & cost** — humans can't answer instantly 24/7; bolt-on "AI add-ons" charge per message and don't actually know the business.
- **Lost attribution** — leads arrive from ads/posts/QRs with no reliable way to know which campaign drove them into the CRM.

Talko AI collapses these into one platform: one inbox, one AI that knows the business, and built-in attribution into the CRM.

---

## 3. Target Users & Personas

| Persona | Need |
|---|---|
| **SMB / D2C brand owner** | Sell and support over WhatsApp/Instagram without hiring a big team |
| **Marketing / growth team** | Run broadcasts + ads → chat, and attribute every lead to a campaign |
| **Support team** | A shared, AI-assisted inbox with assignment, labels, and escalation |
| **Creators & agencies** | Automate Instagram/Messenger DMs and comment replies at scale |
| **Platform operator (owner)** | Provision tenants, manage billing & feature entitlements, white-label |

Industries served (with tailored playbooks): D2C & e-commerce, EdTech, healthcare/clinics, real estate, restaurants, travel.

---

## 4. Product Overview

Talko AI is delivered as:
- A **marketing website** (talkoai.vercel.app) — features, pricing, industry pages, competitor comparisons, blog, SEO/AEO-optimized.
- A **tenant admin portal** (`app.` subdomain) — the product itself, one workspace per business.
- An **owner control plane** — provisions tenants, billing, and feature flags.
- A **support desk** — a focused ticket workspace for the operator's own support team.
- An **embeddable web-chat widget** — a single `<script>` tag customers add to their website.

---

## 5. Capabilities (What the Product Can Do)

### 5.1 Channels & Unified Inbox
- **WhatsApp** (Business Cloud API), **Instagram** (DMs + comment automation), **Facebook Messenger**, and a **website web-chat widget** — all landing in **one live inbox**.
- Filter by channel, "needs reply," escalations; assign to teammates; apply labels; AI personas per conversation.
- Human takeover in one click; the AI steps back when an agent is active.
- Instagram: **comment-to-DM** automation and **public comment replies**.

### 5.2 AI Engine
- **Replies grounded on the business's own Knowledge Base** — quotes the business's docs, prices, and policies rather than hallucinating.
- **Bring-your-own AI key** — Gemini, OpenAI, or Anthropic. Usage bills to the customer's key → predictable cost, no per-message markup.
- **Multiple AI personas / agents**, auto-routed by topic.
- **Knowledge Base ingestion** from web pages, PDFs, and Word documents.
- Lead-capture functions and on-brand rewrite/drafting assistance for agents.

### 5.3 Automation
- **No-code chatbot flows** — drag-and-drop builder (buttons, forms, conditions, business hours). Anything off-script falls through to the AI, so it's never a dead end. Triggered by a keyword or straight from a Meta ad.
- **Drip sequences** — multi-step automated follow-ups, enrolled manually or by pipeline stage.

### 5.4 Broadcasting
- Send **approved WhatsApp templates** to thousands.
- **Full delivery funnel**: sent → delivered → read → clicked → replied, with **click tracking**.
- Schedule sends; target by tag/segment; per-day audience charts.
- **Meta anti-ban guardrails**: opt-in respected, 24-hour window handling, auto-pause on quality signals.

### 5.5 Commerce
- **Product catalog** with images, prices, and buttons.
- **In-chat checkout** and **abandoned-cart recovery**.
- Pay links via **Razorpay** and **Stripe** inside the chat.

### 5.6 Growth, Attribution & Lead Capture
- **Growth Tools** — capture and convert leads across channels.
- **Handle Hub / Tracked Links** — one branded WhatsApp entry point per campaign; each link carries a hidden `[ref:…]` tag so every chat it starts is **attributed to a named source in the CRM** (e.g. LeadSquared), plus a QR per source. Ideal for Google "Chat on WhatsApp" ads.
- **WhatsApp Forms** — structured in-chat data capture.
- **Meta Ads** — connect ad accounts; click-to-chat attribution.

### 5.7 CRM & Pipeline
- **Contacts** with profiles and conversation history.
- **Sales Pipeline** — drag-and-drop kanban; moving a card can auto-tag, start a sequence, and push to the CRM.
- Two-way sync with **HubSpot, Pipedrive, LeadSquared**.

### 5.8 Analytics
- Cross-channel messaging performance — read/delivery rates, escalations, KB coverage — with 14-day trends.
- **AI-generated executive brief** summarizing what's working and the highest-impact next step.

### 5.9 Compliance Tooling
- **Opt-outs** management and **Templates** library (WhatsApp template submission/management).
- **Setup & status** — guided, plan-aware onboarding checklist.

---

## 6. Architecture (How It Was Built)

### 6.1 Technology Stack
| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router, Server Components), React 19, TypeScript |
| **Styling** | Tailwind CSS; hand-built design system (tokens, motion primitives) |
| **Database & Auth backend** | Supabase (PostgreSQL + Row-Level Security) |
| **Auth** | `jose` (HS256 JWT sessions), scrypt password hashing, email OTP 2FA |
| **AI** | `@google/genai` (Gemini), `openai`, `@anthropic-ai/sdk` — bring-your-own-key |
| **Messaging APIs** | Meta Graph API — WhatsApp Business Cloud, Instagram Graph, Messenger Platform |
| **Payments** | Stripe, Razorpay |
| **Email** | Resend (OTP + transactional) |
| **Flow builder** | `@xyflow/react` (React Flow) |
| **KB ingestion** | `cheerio` (HTML), `pdf-parse` (PDF), `mammoth` (DOCX) |
| **Other** | `qrcode` (tracked-link QRs), `leaflet`/`react-leaflet` (maps), Vercel Analytics + Speed Insights |
| **Hosting** | Vercel |

### 6.2 System Design
- **Multi-tenant, single codebase.** One workspace (tenant) per business; strict data isolation enforced at the database (Row-Level Security) layer.
- **Host-based routing** via middleware: marketing site (`www`) vs. product portal (`app`) served from the same Next.js app; supports white-label domains (e.g. `waba.analytixlabs.co.in`).
- **Channel webhooks** — dedicated inbound webhook routes per channel (WhatsApp / Instagram / Messenger) with **HMAC-SHA256 signature verification**; a web-chat message/poll API for the site widget.
- **Bring-your-own-Meta-app model** — a tenant can connect their own Meta app + AI key (used for the first enterprise client), or use the platform's shared setup.
- **Owner control plane** — provisions tenants, billing, and per-plan **feature entitlements** (features are gated/hidden by plan).
- **Embeddable widget** — a dependency-free vanilla-JS loader served per site key; renders a themeable launcher + chat panel and talks to the widget API.

### 6.3 Data Model
- PostgreSQL schema managed as **82 sequential migrations** — covering tenants, users, channels, conversations, messages, contacts, pipeline, templates, sequences, flows, catalog, broadcasts, opt-outs, CRM source attribution, email OTP / trusted devices, and more.
- Secrets (AI keys, tokens) stored in an **encrypted key vault** per tenant.

### 6.4 AI Architecture
- Retrieval-grounded replies: the tenant's Knowledge Base is ingested, chunked, and used to ground responses.
- Provider-agnostic: the same conversation can be served by Gemini, OpenAI, or Anthropic based on the tenant's configured key and persona routing.

---

## 7. Security, Privacy & Compliance
- **Tenant isolation** via Postgres Row-Level Security.
- **Encrypted key vault** for AI keys and channel tokens.
- **Email OTP two-factor auth** — required on new/unrecognized devices; trusted-device cookies; hash-only OTP storage with atomic, rate-limited verification RPCs; fail-closed design.
- **Webhook authenticity** — HMAC signature verification on all inbound Meta webhooks.
- **Meta policy compliance** — anti-ban guardrails (opt-in, 24-hour window, auto-pause), completed **Meta App Review** for the required permissions and Tech-Provider data-handling attestations.
- **Opt-out management** honored across broadcasts and automation.

---

## 8. Integrations
- **CRM:** HubSpot, Pipedrive, LeadSquared
- **E-commerce:** Shopify, WooCommerce
- **Payments:** Razorpay, Stripe
- **Automation:** Zapier, Make, n8n
- **Team:** Slack, Microsoft Teams
- **Scheduling:** Cal.com
- **AI providers:** Google Gemini, OpenAI, Anthropic (bring-your-own-key)

---

## 9. Multi-Tenancy & White-Label
- One codebase serves the public SaaS brand (**Talko AI**) and white-label tenants (**Alabs Connect**, etc.) on their own domains.
- Per-tenant branding (logo, name), own-Meta-app / own-AI-key option, and plan-based feature entitlements.
- A dedicated **support desk** lets the platform operator run their own AI-assisted support inbox.

---

## 10. Plans & Packaging

**Business plans**
| Plan | Price (₹/mo) | For |
|---|---|---|
| Starter | 1,999 | Solo founders getting started |
| **Growth** *(most popular)* | 4,999 | Growing teams that automate |
| Scale | Custom | High-volume & multi-brand |

**Creator plans**
| Plan | Price (₹/mo) | For |
|---|---|---|
| Creator | 999 | Individual creators & influencers |
| **Creator Pro** *(most popular)* | 2,499 | Creator-led brands & agencies |

- **14-day free trial.** Features are enforced per plan via the entitlement system.

---

## 11. Deployment & Operations
- **Hosting:** Vercel (production at talkoai.vercel.app), continuous deploy from `main`.
- **Database:** Supabase (managed Postgres), migrations applied sequentially.
- **Observability:** Vercel Analytics + Speed Insights; structured logs.
- **White-label deploys:** client tenants on their own domains (e.g. `waba.analytixlabs.co.in`).

---

## 12. Selected Engineering Highlights
- Deep, correct **Meta Graph API** integration across three products (WhatsApp / Instagram / Messenger), including the Instagram-login vs Facebook-login API nuances and webhook subscription handling.
- **Bring-your-own-key AI** architecture that keeps model cost with the customer.
- **Accessibility & polish pass** across portal, marketing, and support (press feedback, translucent materials, reduced-motion / reduced-transparency / high-contrast handling, focus rings).
- **Technical SEO/AEO** on the marketing site: JSON-LD (Organization, WebSite, FAQ, SoftwareApplication, BlogPosting, Breadcrumb), dynamic sitemap/robots, competitor comparison landing pages, optimized Core Web Vitals.

---

## Appendix — Glossary
- **Tenant / workspace:** one isolated business account on the platform.
- **BYO key:** bring-your-own AI provider key (Gemini/OpenAI/Anthropic).
- **Tracked link (Handle Hub):** a per-campaign WhatsApp link with a hidden ref tag that attributes new chats to a named CRM source.
- **Entitlements:** the plan-based feature-gating system.
- **Anti-ban guardrails:** opt-in, 24-hour messaging window, and quality auto-pause protections for WhatsApp.

---

*Prepared from the Talko AI codebase (`alabs-connect-saas`). Figures such as plan pricing and the 82-migration data model reflect the current build and may evolve.*
