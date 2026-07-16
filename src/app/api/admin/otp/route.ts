export const maxDuration = 30;
import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { setTenantSetting } from "@/lib/store";
import { fetchTemplates, createAuthTemplate } from "@/lib/whatsapp";
import { otpStatus, setOtpRoutes, resolveOtpCreds, OTP_CHANNEL_KEY, OTP_TEMPLATE_LANG, type OtpRoute } from "@/lib/otp";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// The OTP template is WABA-scoped, so its approval state is per number. Fetch it
// for every distinct number in use (default + each area route). Keyed by channel
// id ("" = primary/env). Errors degrade to null (shown as "unknown") per number.
async function templateStatusByChannel(tenantId: string, channelIds: string[], templateName: string) {
  const distinct = [...new Set(channelIds)];
  const status: Record<string, string | null> = {};
  const errors: Record<string, string> = {};
  await Promise.all(distinct.map(async cid => {
    try {
      const creds = await resolveOtpCreds(tenantId, cid);
      if (creds.error) throw new Error(creds.error);
      status[cid] = (await fetchTemplates(creds.channel)).find(t => t.name === templateName)?.status ?? null;
    } catch (err) {
      status[cid] = null;
      errors[cid] = err instanceof Error ? err.message : String(err);
    }
  }));
  return { status, errors };
}

async function fullStatus(tenantId: string) {
  const st = await otpStatus(tenantId);
  const channelIds = [st.channelId, ...st.routes.map(r => r.channelId)];
  const { status: templateStatus, errors: templateErrors } = await templateStatusByChannel(tenantId, channelIds, st.template);
  return { ...st, defaultChannelId: st.channelId, templateStatus, templateErrors };
}

export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  return NextResponse.json(await fullStatus(tenantId));
}

// POST — one of:
//   { defaultChannelId: string|null }        set the default OTP number
//   { routes: [{ area, channelId }] }         replace the area → number map
//   { createTemplate: true, channelId? }      create the auth template on a number's WABA
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { defaultChannelId?: string | null; routes?: OtpRoute[]; createTemplate?: boolean; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.defaultChannelId !== undefined) {
    await setTenantSetting(tenantId, OTP_CHANNEL_KEY, body.defaultChannelId ?? "");
    logActivity(await currentUser(), "otp.default", body.defaultChannelId || "primary");
  }

  if (Array.isArray(body.routes)) {
    await setOtpRoutes(tenantId, body.routes);
    logActivity(await currentUser(), "otp.routes", `${body.routes.length} area(s)`);
  }

  let createError: string | undefined;
  if (body.createTemplate) {
    const st = await otpStatus(tenantId);
    const cid = (body.channelId ?? st.channelId) || "";
    // Loud resolution — never create the template on the platform env WABA
    // because a tenant's number didn't resolve.
    const creds = await resolveOtpCreds(tenantId, cid);
    if (creds.error) createError = creds.error;
    else {
      const created = await createAuthTemplate(st.template, OTP_TEMPLATE_LANG, creds.channel);
      if (created.error) createError = created.error;   // "already exists" surfaces here; status refresh reflects reality
      else logActivity(await currentUser(), "otp.template", `${st.template} on ${cid || "default"} (${created.status ?? "PENDING"})`);
    }
  }

  return NextResponse.json({ ...(await fullStatus(tenantId)), ...(createError ? { createError } : {}) });
}
