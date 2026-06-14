export const maxDuration = 60;
import { NextResponse } from "next/server";
import { buildFlowJson, createWaForm, publishWaForm, listWaForms, deleteWaForm, type WaFormField } from "@/lib/waforms";
import { credsFor } from "@/lib/channels";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?channelId=… — forms live on the WABA, so each channel can differ.
export async function GET(req: Request) {
  try {
    const channel = await credsFor(new URL(req.url).searchParams.get("channelId"));
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
  let body: { id?: string; name?: string; title?: string; fields?: WaFormField[]; publish?: boolean; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const channel = await credsFor(body.channelId);

  // Publish-only call for an existing draft.
  if (body.id && body.publish && !body.fields) {
    const r = await publishWaForm(body.id, channel);
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
    logActivity(await currentUser(), "form.publish", body.id);
    return NextResponse.json({ success: true, published: true });
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
  const r = await deleteWaForm(body.id, await credsFor(body.channelId));
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), r.deprecated ? "form.deprecate" : "form.delete", body.id);
  return NextResponse.json({ success: true, deprecated: r.deprecated ?? false });
}
