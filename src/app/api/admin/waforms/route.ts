export const maxDuration = 60;
import { NextResponse } from "next/server";
import { buildFlowJson, createWaForm, publishWaForm, listWaForms, deleteWaForm, getWaFormDef, updateWaFormJson, renameWaForm, type WaFormField } from "@/lib/waforms";
import { credsFor, listChannels } from "@/lib/channels";
import { saveFormLinks, getFormLinks } from "@/lib/store";
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
  let body: { id?: string; name?: string; title?: string; fields?: WaFormField[]; publish?: boolean; publishToAll?: boolean; rename?: string; channelId?: string | null };
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

  // Publish an identical COPY of a form onto every OTHER connected number's WABA.
  // A WhatsApp Form is bound to the WABA it was built on, so to send it natively
  // from a number on another WABA we clone its fields and publish a copy there,
  // then map source id -> copy id (wa_form_links) for the flow engine to resolve.
  if (body.id && body.publishToAll) {
    const def = await getWaFormDef(body.id, channel);
    if (def.error) return NextResponse.json({ error: `Couldn't read the form to copy: ${def.error}` }, { status: 502 });
    if (!def.fields.length) return NextResponse.json({ error: "This form has no readable fields to copy." }, { status: 400 });
    let srcName = def.title || "Form";
    try { srcName = (await listWaForms(channel)).find(f => f.id === body.id)?.name || srcName; } catch { /* keep title */ }
    const srcWaba = channel?.wabaId || process.env.META_WA_WABA_ID || "";
    const flowJson = buildFlowJson(def.title || srcName, def.fields);

    // One active WhatsApp channel per distinct target WABA (skip the source WABA).
    const targets = new Map<string, Awaited<ReturnType<typeof listChannels>>[number]>();
    for (const c of await listChannels(tid)) {
      if (c.kind !== "whatsapp" || !c.active || !c.wabaId || !c.token) continue;
      if (c.wabaId === srcWaba || targets.has(c.wabaId)) continue;
      targets.set(c.wabaId, c);
    }

    // Idempotency keys on OUR own recorded copy (wa_form_links), verified by id
    // on the target WABA — never on a name match, since form names aren't unique
    // across WABAs and a stranger's same-named form would be sent by mistake.
    const priorByWaba = new Map((await getFormLinks(body.id, tid)).map(l => [l.wabaId, l.formId]));

    const publishedTo: { waba: string; channel: string; formId?: string; status?: string; error?: string }[] = [];
    const links: { wabaId: string; formId: string; name?: string; status?: string }[] = [];
    for (const [waba, ch] of targets) {
      try {
        const onWaba = await listWaForms(ch).catch(() => []);
        const priorId = priorByWaba.get(waba);
        const priorForm = priorId ? onWaba.find(f => f.id === priorId) : undefined;
        // A copy we already made and recorded still lives here — reuse it
        // (publishing it first if it never got past draft).
        if (priorForm && priorForm.status === "PUBLISHED") {
          publishedTo.push({ waba, channel: ch.name, formId: priorForm.id, status: "PUBLISHED" });
          links.push({ wabaId: waba, formId: priorForm.id, name: srcName, status: "PUBLISHED" });
          continue;
        }
        if (priorForm && priorForm.status === "DRAFT") {
          const pub = await publishWaForm(priorForm.id, ch);
          const status = pub.success ? "PUBLISHED" : "DRAFT";
          publishedTo.push({ waba, channel: ch.name, formId: priorForm.id, status, error: pub.success ? undefined : pub.error });
          links.push({ wabaId: waba, formId: priorForm.id, name: srcName, status });
          continue;
        }
        // No usable recorded copy → create + publish a fresh one.
        const created = await createWaForm(srcName, flowJson, ch);
        if (created.error || !created.id) { publishedTo.push({ waba, channel: ch.name, error: created.error || "create failed" }); continue; }
        const pub = await publishWaForm(created.id, ch);
        const status = pub.success ? "PUBLISHED" : "DRAFT";
        publishedTo.push({ waba, channel: ch.name, formId: created.id, status, error: pub.success ? undefined : pub.error });
        links.push({ wabaId: waba, formId: created.id, name: srcName, status });
      } catch (err) {
        publishedTo.push({ waba, channel: ch.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (links.length) await saveFormLinks(body.id, links, tid);
    logActivity(await currentUser(), "form.publishAll", `${body.id} → ${links.length}/${targets.size} WABAs`);
    return NextResponse.json({ publishedTo, count: links.length, total: targets.size });
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
