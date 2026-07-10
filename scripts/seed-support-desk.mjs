#!/usr/bin/env node
// scripts/seed-support-desk.mjs — seed the Talko AI support workspace in prod.
//
// Creates (idempotently — safe to re-run, find-or-create everywhere):
//   1. Support tenant            (slug "talko-support", grandfathered, active)
//   2. Initial admin login       (wa_users: support@talko.ai — password printed ONCE on create)
//   3. Web-chat channel          (kind "webchat", site_key "tsk_…", branded widget config)
//   4. AI agent                  (wa_ai_agents: "Support Assistant" persona)
//   5. DEFAULT tenant setting    (wa_settings key "support_widget" → { siteKey, tenantId })
//
// Talks to Supabase via PostgREST only (no DDL). Reads .env.local itself —
// plain Node, no dependencies. Run from anywhere: node scripts/seed-support-desk.mjs

import { readFileSync } from "node:fs";
import { randomBytes, randomInt, scryptSync } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPPORT_SLUG = "talko-support";
const SUPPORT_NAME = "Talko AI Support";
const ADMIN_EMAIL = "support@talko.ai";

// ── Env (.env.local at the repo root, parsed by hand) ─────────────────────────
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(resolve(repoRoot, ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
} catch { /* no .env.local — rely on the ambient environment */ }

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY (checked .env.local and the environment).");
  process.exit(1);
}

// ── PostgREST helper ──────────────────────────────────────────────────────────
// Returns parsed JSON (array for selects/inserts). Throws Error with .code set
// to the Postgres/PostgREST error code (e.g. "23514", "PGRST204").
async function pg(method, pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error(data?.message || `${method} ${pathAndQuery} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.code = data?.code ?? String(res.status);
    err.details = data?.details ?? null;
    throw err;
  }
  return data;
}

// Insert with optional columns that later migrations may not have applied yet —
// same resilience pattern as createTenantFromSignup (src/lib/tenants.ts): on an
// unknown-column error, drop the offending optional key and retry.
async function insertWithOptional(table, base, optional) {
  const row = { ...base, ...optional };
  for (let attempt = 0; attempt <= Object.keys(optional).length; attempt++) {
    try {
      const [created] = await pg("POST", table, row);
      return created;
    } catch (e) {
      const msg = e.message || "";
      const missing = Object.keys(optional).find(k => k in row && new RegExp(`\\b${k}\\b`).test(msg));
      if ((e.code === "PGRST204" || /column/i.test(msg)) && missing) { delete row[missing]; continue; }
      throw e;
    }
  }
  throw new Error(`insert into ${table} kept failing after dropping optional columns`);
}

// ── Password helpers (mirror src/lib/team.ts hashPassword exactly) ────────────
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function generatePassword(len = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Seeding Talko AI support desk →", SUPABASE_URL);

  // 1. Support tenant (find-or-create by slug) ---------------------------------
  let tenant = (await pg("GET", `tenants?slug=eq.${SUPPORT_SLUG}&select=id,name,plan,status`))[0] ?? null;
  if (tenant) {
    console.log(`• Tenant exists: ${tenant.id} (plan ${tenant.plan}, status ${tenant.status})`);
  } else {
    // Pick a real plan key from wa_plans — prefer 'growth' when present.
    let plan = "growth";
    try {
      const plans = await pg("GET", "wa_plans?select=key&order=sort.asc");
      const keys = (plans ?? []).map(p => p.key);
      plan = keys.includes("growth") ? "growth" : (keys[0] ?? "trial");
    } catch { /* wa_plans missing → default plan key */ }
    tenant = await insertWithOptional(
      "tenants",
      { name: SUPPORT_NAME, slug: SUPPORT_SLUG, status: "active", plan },
      // Columns from later migrations (0024 owner fields, 0059 grandfathered) —
      // dropped one-by-one if the live schema doesn't have them yet.
      {
        payment_status: "active", company: SUPPORT_NAME, owner_name: "Talko Support",
        owner_email: ADMIN_EMAIL, features: {}, grandfathered: true,
      },
    );
    console.log(`• Tenant created: ${tenant.id} (plan ${plan})`);
  }
  const tenantId = tenant.id;

  // 2. Initial admin login (find-or-create by email) ---------------------------
  let printedPassword = null;
  const existingUser = (await pg("GET", `wa_users?email=eq.${encodeURIComponent(ADMIN_EMAIL)}&select=id,tenant_id`))[0] ?? null;
  if (existingUser) {
    if (existingUser.tenant_id !== tenantId) {
      console.warn(`• WARNING: ${ADMIN_EMAIL} already exists on ANOTHER tenant (${existingUser.tenant_id}) — leaving it untouched.`);
    } else {
      console.log(`• Admin login exists: ${ADMIN_EMAIL} (password unchanged — not reprinted)`);
    }
  } else {
    printedPassword = generatePassword(14);
    await pg("POST", "wa_users", {
      email: ADMIN_EMAIL, name: "Talko Support", role: "admin",
      tenant_id: tenantId, active: true, password_hash: hashPassword(printedPassword),
    });
    console.log(`• Admin login created: ${ADMIN_EMAIL}`);
  }

  // 3. AI agent (find-or-create by tenant + name) — created before the channel
  //    so the channel can pin it as its default persona. --------------------—--
  const AGENT_NAME = "Support Assistant";
  let agent = (await pg("GET", `wa_ai_agents?tenant_id=eq.${tenantId}&name=eq.${encodeURIComponent(AGENT_NAME)}&select=id,name`))[0] ?? null;
  if (agent) {
    console.log(`• AI agent exists: ${agent.id}`);
  } else {
    agent = await pg("POST", "wa_ai_agents", {
      tenant_id: tenantId,
      name: AGENT_NAME,
      description: "Answers Talko AI product questions — channels, plans & pricing, setup and billing — on the support widget.",
      persona: [
        "You are the Talko AI Support Assistant, the friendly product expert on Talko AI's own support chat.",
        "Talko AI is a customer-messaging SaaS: businesses connect WhatsApp, Instagram DMs, Facebook Messenger and a website chat widget, then manage every conversation from one shared inbox with AI auto-replies, chatbot flows, broadcasts and a team of human agents.",
        "Answer questions about what Talko AI does, which channels it supports (WhatsApp, Instagram, Messenger, website web chat), plans and pricing (point visitors to the pricing page for current numbers), and how to get set up: sign up, connect a channel from Settings → Channels, invite teammates, and turn on the AI assistant or chatbot flows.",
        "Be concise, warm and concrete. Use short paragraphs. Never invent features, prices or limits — if unsure, say so and offer to bring in a teammate.",
      ].join("\n"),
      constraints_text: [
        "For anything about billing, refunds, payment failures or account cancellation: do NOT attempt to resolve it yourself — tell the visitor a human teammate will take over and hand the conversation to a human.",
        "Never share internal implementation details, API keys or other customers' information.",
        "Stay on the topic of Talko AI; politely decline unrelated requests.",
      ].join("\n"),
      product_info: [
        "Channels: WhatsApp Business (Cloud API), Instagram DMs, Facebook Messenger, and an embeddable website chat widget.",
        "Core features: shared team inbox, AI auto-replies, visual chatbot flows, broadcasts/sequences, contact CRM with labels, and a knowledge base the AI answers from.",
        "Plans: Trial (free), Starter, Growth and Scale — current pricing and limits live on the pricing page of the website.",
        "Setup steps: 1) create an account, 2) connect a channel in Settings → Channels, 3) invite your team, 4) enable the AI assistant or build a chatbot flow, 5) start chatting from the inbox.",
      ].join("\n"),
      model: null,
      active: true,
      routing_keywords: "support, setup, onboarding, pricing, plans, billing, channels, whatsapp, instagram, messenger, web chat, widget",
      updated_at: new Date().toISOString(),
    }).then(rows => rows[0]);
    console.log(`• AI agent created: ${agent.id}`);
  }

  // 4. Web-chat channel (find-or-create by tenant + kind; site_key minted once)
  // Same column + shape saveWebchatChannel (src/lib/channels.ts) writes.
  const WIDGET_CONFIG = {
    color: "#0783fd",
    title: "Talko AI Support",
    subtitle: "Typically replies in a few minutes",
    welcome: "Hi! \u{1F44B} Ask us anything about Talko AI — setup, pricing, channels or billing.",
    position: "left",
    iconUrl: "https://talkoai.vercel.app/brand/talko_favicon.svg",
    logoFit: "contain",
  };
  const warn0056 = () => console.warn("• WARNING: wa_channels.widget_config is missing — apply supabase/migrations/0056_webchat_widget_config.sql, then re-run to store the widget branding (the widget works with defaults meanwhile).");
  let channel = (await pg("GET", `wa_channels?tenant_id=eq.${tenantId}&kind=eq.webchat&select=id,site_key`))[0] ?? null;
  if (channel) {
    console.log(`• Web-chat channel exists: ${channel.id} (site key ${channel.site_key})`);
    // Converge branding on re-run (also backfills a pre-0056 row once the
    // migration lands). Deliberate: re-running the seed resets the look & feel.
    try { await pg("PATCH", `wa_channels?id=eq.${channel.id}`, { widget_config: WIDGET_CONFIG }); }
    catch (e) { if (e.code === "PGRST204" || /widget_config/.test(e.message || "")) warn0056(); else throw e; }
  } else {
    const siteKey = `tsk_${randomBytes(12).toString("hex")}`;   // "tsk_" + 24 hex
    try {
      channel = await insertWithOptional(
        "wa_channels",
        {
          tenant_id: tenantId,
          kind: "webchat",
          name: "Portal support widget",
          access_token: "",            // NOT NULL column; webchat has no Meta token
          allowed_origins: [],         // empty = allow any origin (portal + local dev)
          agent_id: agent?.id ?? null,
          active: true,
          is_default: true,
          site_key: siteKey,
        },
        // widget_config arrived in 0056 — insert still succeeds if it's pending.
        { widget_config: WIDGET_CONFIG },
      );
    } catch (e) {
      if (e.code === "23514" || /kind.*check|check.*kind/i.test(e.message || "")) {
        console.error("\nThe wa_channels kind-check still rejects 'webchat'.");
        console.error("Fix: apply supabase/migrations/0053_conv_platform_messenger_webchat.sql and 0055_channel_kind_messenger_webchat.sql in the Supabase SQL Editor, then re-run this script.");
        console.error("(The tenant, admin login and AI agent created above are kept — the script is idempotent.)");
        process.exit(1);
      }
      throw e;
    }
    if (!("widget_config" in channel)) warn0056();
    console.log(`• Web-chat channel created: ${channel.id} (site key ${channel.site_key})`);
  }

  // 5. DEFAULT tenant setting "support_widget" (upsert via wa_settings) --------
  const settingValue = { siteKey: channel.site_key, tenantId };
  const existingSetting = (await pg("GET", `wa_settings?tenant_id=eq.${DEFAULT_TENANT_ID}&key=eq.support_widget&select=key`))[0] ?? null;
  if (existingSetting) {
    await pg("PATCH", `wa_settings?tenant_id=eq.${DEFAULT_TENANT_ID}&key=eq.support_widget`,
      { value: settingValue, updated_at: new Date().toISOString() });
    console.log("• Setting updated: support_widget on the default tenant");
  } else {
    await pg("POST", "wa_settings",
      { tenant_id: DEFAULT_TENANT_ID, key: "support_widget", value: settingValue, updated_at: new Date().toISOString() });
    console.log("• Setting created: support_widget on the default tenant");
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────");
  console.log("Talko AI support desk is seeded.");
  console.log(`  Support tenant id : ${tenantId}`);
  console.log(`  Widget site key   : ${channel.site_key}`);
  console.log(`  Admin login       : ${ADMIN_EMAIL}`);
  if (printedPassword) {
    console.log(`  Admin password    : ${printedPassword}   ← shown ONCE, store it now`);
  } else {
    console.log("  Admin password    : unchanged (only printed when the login is first created)");
  }
  console.log("\nNext steps:");
  console.log("  1. Log in to the portal with the support credentials to see the support inbox.");
  console.log(`  2. Embed on any page: <script src="https://talkoai.vercel.app/api/widget/${channel.site_key}/loader.js" async></script>`);
  console.log("  3. The default tenant's support_widget setting now points the in-app widget at this workspace.");
}

main().catch(e => {
  console.error("Seed failed:", e.message || e);
  if (e.code) console.error("  code:", e.code, e.details ? `— ${e.details}` : "");
  process.exit(1);
});
