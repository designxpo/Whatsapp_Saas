import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireRoleAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { getAdsAccountId, getAdsPageId, getAdAccount } from "@/lib/ads";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const isReal = (v?: string) => Boolean(v && v !== "test" && v !== "test-verify" && v !== "test-secret");

// Recent migrations that are commonly unapplied. Each has a representative
// table (and optional column) we probe to tell whether it's been run.
const MIGRATIONS = [
  { id: "0013", title: "Multiple WhatsApp numbers", file: "0013_channels.sql", table: "wa_channels" },
  { id: "0014", title: "Team members", file: "0014_team.sql", table: "wa_users" },
  { id: "0015", title: "Team member roles / titles", file: "0015_team_title.sql", table: "wa_users", column: "title" },
  { id: "0016", title: "Automated ad rules", file: "0016_ad_rules.sql", table: "wa_ad_rules" },
  { id: "0017", title: "Connect flows to ad campaigns", file: "0017_ad_flow_triggers.sql", table: "wa_ad_flow_triggers" },
  { id: "0018", title: "Ad drafts + portal-campaign tracking", file: "0018_ads_drafts_source.sql", table: "wa_ad_drafts" },
] as const;

// PostgREST returns 42P01 (undefined_table) / 42703 (undefined_column) when a
// migration hasn't run. Any other outcome means the object exists.
async function probe(table: string, column?: string): Promise<boolean> {
  const { error } = await db().from(table).select(column ?? "*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code;
  if (code === "42P01" || code === "42703") return false;
  return !/does not exist/i.test(error.message ?? "");
}

function readSql(file: string): string {
  try { return fs.readFileSync(path.join(process.cwd(), "supabase/migrations", file), "utf8"); } catch { return ""; }
}

// GET — guided-setup diagnostics: which migrations are unapplied (+ their SQL),
// which env vars are missing/malformed, and live Meta connectivity. Read-only.
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  // Deep link straight to this project's Supabase SQL editor.
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const supabaseSql = ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : "https://supabase.com/dashboard";

  const migrations = await Promise.all(MIGRATIONS.map(async m => ({
    id: m.id, title: m.title, file: m.file,
    applied: await probe(m.table, "column" in m ? m.column : undefined).catch(() => false),
    sql: readSql(m.file),
  })));

  // Env vars (server-readable). Meta tokens always start with "EAA".
  const token = process.env.META_ADS_ACCESS_TOKEN || process.env.META_WA_ACCESS_TOKEN;
  const tokenMalformed = !!token && !token.startsWith("EAA");
  const env = [
    { key: "META_WA_ACCESS_TOKEN", label: "Meta access token", ok: isReal(token) && !tokenMalformed,
      fix: !isReal(token) ? "Not set — paste your Meta system-user token (starts with EAA)." : tokenMalformed ? "Malformed — it doesn't start with “EAA”. Re-paste the full token (a leading character is likely missing)." : "Set ✓" },
    { key: "CRON_SECRET", label: "Cron secret (ad rules + queue)", ok: isReal(process.env.CRON_SECRET),
      fix: isReal(process.env.CRON_SECRET) ? "Set ✓" : "Add CRON_SECRET (any long random string) and use the same value in GitHub Actions." },
    { key: "ADMIN_JWT_SECRET", label: "Admin session secret", ok: isReal(process.env.ADMIN_JWT_SECRET),
      fix: isReal(process.env.ADMIN_JWT_SECRET) ? "Set ✓" : "Add a long random ADMIN_JWT_SECRET." },
    { key: "GEMINI_API_KEY", label: "AI brain (Gemini)", ok: isReal(process.env.GEMINI_API_KEY),
      fix: isReal(process.env.GEMINI_API_KEY) ? "Set ✓" : "Add GEMINI_API_KEY (aistudio.google.com/apikey)." },
  ];

  // Live Meta connectivity — proves the token + account + page actually work.
  const [accountId, pageId] = await Promise.all([getAdsAccountId(), getAdsPageId()]);
  let account = { ok: false, detail: "No ad account connected — add your account ID on the Meta Ads page." };
  if (accountId) {
    const r = await getAdAccount(accountId).catch(() => ({ ok: false, error: "unreachable" }));
    account = r.ok ? { ok: true, detail: `Connected — ${("account" in r && r.account?.name) || `act_${accountId}`}` } : { ok: false, detail: `act_${accountId}: ${("error" in r && r.error) || "unreachable"}` };
  }
  const page = { ok: !!pageId, detail: pageId ? `Page ID ${pageId} saved` : "No Facebook Page ID — required for Click-to-WhatsApp ads." };

  return NextResponse.json({ migrations, env, meta: { account, page }, links: { supabaseSql, vercelEnv: "https://vercel.com/dashboard" } });
}
