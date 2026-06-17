export const maxDuration = 60;
import { NextResponse } from "next/server";
import { buildFlowJson, createWaForm, publishWaForm, listWaForms, deleteWaForm, getWaFormDef, updateWaFormJson, renameWaForm, type WaFormField } from "@/lib/waforms";
import { credsFor } from "@/lib/channels";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?channelId=… — forms live on the WABA, so each channel can differ.
// GET ?def=<id> — read one form's fields back (to re-open it in the builder).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channel = await credsFor(url.searchParams.get("channelId"), tid);
    const def = url.searchParams.get("def");
    if (def) return NextResponse.json(await getWaFormDef(def, channel));
    return NextResponse.json({ forms: await listWaForms(channel) });
  } catch (err) {
    // Missing/invalid Meta creds shouldn't 500 the UI — render with a notice.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ forms: [], notice: `Could not load forms: ${message}` });
  }
}

// POST — create a form from the builder spec, or publish an existing draft.
// Create: { name, title, fields: WaFormField[], publish? }
// Publish: { id, publish: true }
export async function POST(req: Request) {
  let body: { id?: string; name?: string; title?: string; fields?: WaFormField[]; publish?: boolean; rename?: string; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const channel = await credsFor(body.channelId, tid);

  // Rename a form (works for published too — only content is locked on publish).
  if (body.id && typeof body.rename === "string") {
    const r = await renameWaForm(body.id, body.rename, channel);
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
    logActivity(await currentUser(), "form.rename", `${body.id} → ${body.rename}`);
    return NextResponse.json({ success: true });
  }

  // Publish-only call for an existing draft.
  if (body.id && body.publish && !body.fields) {
    const r = await publishWaForm(body.id, channel);
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
    logActivity(await currentUser(), "form.publish", body.id);
    return NextResponse.json({ success: true, published: true });
  }

  // Edit an existing DRAFT form's content (re-upload its Flow JSON), optionally publishing.
  if (body.id && body.fields) {
    const fields = (body.fields ?? []).filter(f => f?.label?.trim());
    if (!fields.length) return NextResponse.json({ error: "Add at least one field" }, { status: 400 });
    const needOptions = fields.find(f => ["dropdown", "radio", "checkbox"].includes(f.type) && !(f.options ?? []).some(o => o.trim()));
    if (needOptions) return NextResponse.json({ error: `"${needOptions.label}" needs at least one option` }, { status: 400 });
    const up = await updateWaFormJson(body.id, buildFlowJson(body.title ?? body.name ?? "Form", fields), channel);
    if (up.error) return NextResponse.json({ error: up.error }, { status: 502 });
    if (up.validationErrors?.length) return NextResponse.json({ success: true, id: body.id, status: "DRAFT", validationErrors: up.validationErrors });
    let published = false, publishError: string | undefined;
    if (body.publish) { const p = await publishWaForm(body.id, channel); published = p.success; publishError = p.error; }
    logActivity(await currentUser(), "form.update", `${body.name ?? body.id} (${published ? "PUBLISHED" : "DRAFT"})`);
    return NextResponse.json({ success: true, id: body.id, status: published ? "PUBLISHED" : "DRAFT", publishError });
  }

  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const fields = (body.fields ?? []).filter(f => f?.label?.trim());
  if (!fields.length) return NextResponse.json({ error: "Add at least one field" }, { status: 400 });
  const needOptions = fields.find(f => ["dropdown", "radio", "checkbox"].includes(f.type) && !(f.options ?? []).some(o => o.trim()));
  if (needOptions) return NextResponse.json({ error: `"${needOptions.label}" needs at least one option` }, { status: 400 });

  const flowJson = buildFlowJson(body.title ?? body.name, fields);
  const created = await createWaForm(body.name, flowJson, channel);
  if (created.error) return NextResponse.json({ error: created.error }, { status: 502 });
  if (created.validationErrors?.length) {
    return NextResponse.json({ success: true, id: created.id, status: "DRAFT", validationErrors: created.validationErrors });
  }

  let published = false, publishError: string | undefined;
  if (body.publish && created.id) {
    const p = await publishWaForm(created.id, channel);
    published = p.success;
    publishError = p.error;
  }
  logActivity(await currentUser(), "form.create", `${body.name} (${published ? "PUBLISHED" : "DRAFT"})`);
  return NextResponse.json({ success: true, id: created.id, status: published ? "PUBLISHED" : "DRAFT", publishError });
}

// DELETE — remove a draft (published forms are deprecated instead). Body: { id, channelId? }
export async function DELETE(req: Request) {
  let body: { id?: string; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const r = await deleteWaForm(body.id, await credsFor(body.channelId, tid));
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), r.deprecated ? "form.deprecate" : "form.delete", body.id);
  return NextResponse.json({ success: true, deprecated: r.deprecated ?? false });
}
