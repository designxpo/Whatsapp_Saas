// WhatsApp Forms (Meta "WhatsApp Flows") — native multi-field forms that open
// inside WhatsApp. Built from a simple field spec in the portal, uploaded as
// Flow JSON to the WABA, published (no template-style review — publishing
// makes them live), and sent as interactive `flow` messages. Submissions
// arrive on the webhook as interactive.nfm_reply and are saved to contact
// attributes.

import { getCreds } from "./whatsapp";
import type { ChannelCreds } from "./channels";

const GRAPH = "https://graph.facebook.com/v22.0";

export interface WaFormField {
  type: "text" | "email" | "phone" | "number" | "textarea" | "dropdown" | "radio" | "checkbox" | "date" | "optin";
  label: string;
  required: boolean;
  options?: string[];           // dropdown / radio / checkbox
}

export interface WaForm {
  id: string;
  name: string;
  status: string;               // DRAFT | PUBLISHED | DEPRECATED | BLOCKED | THROTTLED
  categories: string[];
  validationErrors: string[];
  previewUrl: string | null;
}

// ── Flow JSON generator (single terminal screen, Form + complete action) ──────
export function buildFlowJson(title: string, fields: WaFormField[]): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  const payload: Record<string, string> = {};
  const used = new Set<string>();
  const slug = (label: string, i: number) => {
    let s = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || `field_${i + 1}`;
    while (used.has(s)) s = `${s}_${i + 1}`;
    used.add(s);
    return s;
  };
  for (const [i, f] of fields.entries()) {
    if (!f.label.trim()) continue;
    const name = slug(f.label, i);
    payload[name] = `\${form.${name}}`;
    const opts = (f.options ?? []).filter(o => o.trim()).slice(0, 20)
      .map((o, j) => ({ id: `${j}_${o.trim().slice(0, 20).replace(/[^a-zA-Z0-9]+/g, "_")}`, title: o.trim().slice(0, 30) }));
    switch (f.type) {
      case "textarea": children.push({ type: "TextArea", name, label: f.label.slice(0, 20), required: f.required }); break;
      case "dropdown": children.push({ type: "Dropdown", name, label: f.label.slice(0, 20), required: f.required, "data-source": opts }); break;
      case "radio": children.push({ type: "RadioButtonsGroup", name, label: f.label.slice(0, 30), required: f.required, "data-source": opts }); break;
      case "checkbox": children.push({ type: "CheckboxGroup", name, label: f.label.slice(0, 30), required: f.required, "data-source": opts }); break;
      case "date": children.push({ type: "DatePicker", name, label: f.label.slice(0, 20), required: f.required }); break;
      case "optin": children.push({ type: "OptIn", name, label: f.label.slice(0, 120), required: f.required }); break;
      default: children.push({
        type: "TextInput", name, label: f.label.slice(0, 20), required: f.required,
        "input-type": f.type === "email" ? "email" : f.type === "phone" ? "phone" : f.type === "number" ? "number" : "text",
      });
    }
  }
  children.push({ type: "Footer", label: "Submit", "on-click-action": { name: "complete", payload } });
  return {
    version: "7.0",
    screens: [{
      id: "FORM_SCREEN",
      title: title.trim().slice(0, 30) || "Form",
      terminal: true,
      layout: { type: "SingleColumnLayout", children: [{ type: "Form", name: "form", children }] },
    }],
  };
}

// The attribute name a field's answer is saved under — the same slugging
// buildFlowJson uses for Flow JSON field names, so answers collected in chat
// (IG/Messenger/web chat, where the native form can't open) land on the SAME
// contact attribute keys as a real WhatsApp form submission.
export function fieldSlug(label: string, i = 0): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || `field_${i + 1}`;
}

// ── Reverse: Flow JSON → field spec (for the edit builder) ────────────────────
// Walks the Flow JSON and pulls every input component back into a WaFormField,
// in order, deduped by name — so an existing form can be re-opened in the builder.
export function parseFlowJson(flowJson: Record<string, unknown>): { title: string; fields: WaFormField[] } {
  const fields: WaFormField[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = o.type as string | undefined;
    if (t && ["TextInput", "TextArea", "Dropdown", "RadioButtonsGroup", "CheckboxGroup", "DatePicker", "OptIn"].includes(t)) {
      const key = (o.name as string) || (o.label as string) || `f${fields.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        let type: WaFormField["type"];
        if (t === "TextInput") {
          const it = (o["input-type"] as string) || "text";
          type = it === "email" ? "email" : it === "phone" ? "phone" : it === "number" ? "number" : "text";
        } else {
          type = ({ TextArea: "textarea", Dropdown: "dropdown", RadioButtonsGroup: "radio", CheckboxGroup: "checkbox", DatePicker: "date", OptIn: "optin" } as const)[t as "TextArea"];
        }
        const ds = (o["data-source"] as { title?: string }[] | undefined) ?? [];
        fields.push({ type, label: String(o.label ?? ""), required: !!o.required, options: ds.map(d => String(d.title ?? "")).filter(Boolean) });
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  const screens = (flowJson.screens as Record<string, unknown>[]) ?? [];
  walk(screens);
  return { title: (screens[0]?.title as string) ?? "", fields };
}

// One Flow JSON component for a field (shared by single + multi-screen builders).
function flowField(f: WaFormField, name: string): Record<string, unknown> {
  const opts = (f.options ?? []).filter(o => o.trim()).slice(0, 20)
    .map((o, j) => ({ id: `${j}_${o.trim().slice(0, 20).replace(/[^a-zA-Z0-9]+/g, "_")}`, title: o.trim().slice(0, 30) }));
  switch (f.type) {
    case "textarea": return { type: "TextArea", name, label: f.label.slice(0, 20), required: f.required };
    case "dropdown": return { type: "Dropdown", name, label: f.label.slice(0, 20), required: f.required, "data-source": opts };
    case "radio": return { type: "RadioButtonsGroup", name, label: f.label.slice(0, 30), required: f.required, "data-source": opts };
    case "checkbox": return { type: "CheckboxGroup", name, label: f.label.slice(0, 30), required: f.required, "data-source": opts };
    case "date": return { type: "DatePicker", name, label: f.label.slice(0, 20), required: f.required };
    case "optin": return { type: "OptIn", name, label: f.label.slice(0, 120), required: f.required };
    default: return { type: "TextInput", name, label: f.label.slice(0, 20), required: f.required, "input-type": f.type === "email" ? "email" : f.type === "phone" ? "phone" : f.type === "number" ? "number" : "text" };
  }
}

export interface WaFormScreen { title: string; fields: WaFormField[]; cta?: string; bodyText?: string }

// ── Multi-screen Flow JSON ────────────────────────────────────────────────────
// Each screen collects fields and navigates to the next; prior answers are
// forwarded via the screen `data` model so the final `complete` payload carries
// every field. (Single-screen forms keep using buildFlowJson above.)
export function buildMultiScreenFlowJson(screens: WaFormScreen[]): Record<string, unknown> {
  const used = new Set<string>();
  const slug = (label: string, i: number) => {
    let s = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || `field_${i + 1}`;
    while (used.has(s)) s = `${s}_${i + 1}`;
    used.add(s);
    return s;
  };
  // Resolve a stable field name per field, per screen.
  const perScreen = screens.map(s => s.fields.filter(f => f.label.trim()).map((f, i) => ({ name: slug(f.label, i), field: f })));

  const out = screens.map((s, i) => {
    const isLast = i === screens.length - 1;
    const mine = perScreen[i];
    const prior = perScreen.slice(0, i).flat();
    const children: Record<string, unknown>[] = [];
    for (const m of mine) children.push(flowField(m.field, m.name));
    // Footer payload: prior answers as ${data.x}, this screen's as ${form.x}.
    const payload: Record<string, string> = {};
    for (const p of prior) payload[p.name] = `\${data.${p.name}}`;
    for (const m of mine) payload[m.name] = `\${form.${m.name}}`;
    const action = isLast
      ? { name: "complete", payload }
      : { name: "navigate", next: { type: "screen", name: `SCREEN_${i + 1}` }, payload };
    children.push({ type: "Footer", label: (s.cta ?? (isLast ? "Submit" : "Continue")).slice(0, 30), "on-click-action": action });

    const screen: Record<string, unknown> = {
      id: `SCREEN_${i}`,
      title: s.title.trim().slice(0, 30) || `Step ${i + 1}`,
      // Display text (TextBody) must sit in the layout OUTSIDE the Form — a Form
      // holds only inputs + the Footer, else Meta rejects the Flow JSON on publish.
      layout: { type: "SingleColumnLayout", children: [...(s.bodyText?.trim() ? [{ type: "TextBody", text: s.bodyText.trim().slice(0, 4096) }] : []), { type: "Form", name: `form_${i}`, children }] },
    };
    // Declare incoming data (everything collected before this screen). Examples
    // must be non-empty or Meta flags the data model on publish.
    if (prior.length) { const data: Record<string, unknown> = {}; for (const p of prior) data[p.name] = { type: "string", __example__: "sample" }; screen.data = data; }
    if (isLast) screen.terminal = true;
    return screen;
  });
  return { version: "7.0", screens: out };
}

// A standard in-chat checkout: delivery details → confirm. The order is created
// from the contact's open cart when the submission arrives on the webhook.
export function buildCheckoutFlowJson(): Record<string, unknown> {
  return buildMultiScreenFlowJson([
    { title: "Delivery details", cta: "Continue", fields: [
      { type: "text", label: "Full name", required: true },
      { type: "phone", label: "Phone", required: true },
      { type: "textarea", label: "Delivery address", required: true },
    ] },
    { title: "Confirm order", cta: "Place order", bodyText: "Review your details and place your order. We'll confirm here on WhatsApp.", fields: [
      { type: "optin", label: "I confirm my order and delivery details", required: true },
    ] },
  ]);
}

// ── WABA Flows API ────────────────────────────────────────────────────────────

type MetaErr = { error?: { message?: string; error_user_msg?: string } };
const errMsg = (d: MetaErr, status: number) => d?.error?.error_user_msg || d?.error?.message || `HTTP ${status}`;

async function uploadFlowJson(token: string, flowId: string, flowJson: Record<string, unknown>): Promise<{ errors: string[]; error?: string }> {
  const fd = new FormData();
  fd.append("file", new Blob([JSON.stringify(flowJson)], { type: "application/json" }), "flow.json");
  fd.append("name", "flow.json");
  fd.append("asset_type", "FLOW_JSON");
  const res = await fetch(`${GRAPH}/${flowId}/assets`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { errors: [], error: errMsg(data, res.status) };
  const errors = ((data.validation_errors as { message?: string; error_user_msg?: string }[]) ?? [])
    .map(e => e.error_user_msg || e.message || "validation error");
  return { errors };
}

// Create a draft form (Flow asset) on the WABA. Returns validation errors, if any.
export async function createWaForm(name: string, flowJson: Record<string, unknown>, channel?: ChannelCreds): Promise<{ id?: string; validationErrors?: string[]; error?: string }> {
  const { token, wabaId } = getCreds(channel);
  if (!token || !wabaId) return { error: "Missing META_WA_ACCESS_TOKEN / META_WA_WABA_ID" };
  try {
    const res = await fetch(`${GRAPH}/${wabaId}/flows`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 200), categories: ["LEAD_GENERATION"] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) return { error: errMsg(data, res.status) };
    const up = await uploadFlowJson(token, data.id as string, flowJson);
    if (up.error) return { id: data.id as string, error: `Created, but the form content failed to upload: ${up.error}` };
    return { id: data.id as string, validationErrors: up.errors };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Publish a draft — makes it live immediately (Meta validates, no review queue).
export async function publishWaForm(id: string, channel?: ChannelCreds): Promise<{ success: boolean; error?: string }> {
  const { token } = getCreds(channel);
  if (!token) return { success: false, error: "Missing META_WA_ACCESS_TOKEN" };
  try {
    const res = await fetch(`${GRAPH}/${id}/publish`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) return { success: false, error: errMsg(data, res.status) };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Reads an existing form's fields back from Meta (downloads its Flow JSON asset)
// so it can be re-opened in the builder. Read-only — safe on any form.
export async function getWaFormDef(id: string, channel?: ChannelCreds): Promise<{ title: string; fields: WaFormField[]; error?: string }> {
  const { token } = getCreds(channel);
  if (!token) return { title: "", fields: [], error: "Missing META_WA_ACCESS_TOKEN" };
  try {
    const res = await fetch(`${GRAPH}/${id}/assets`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { title: "", fields: [], error: errMsg(data, res.status) };
    const asset = ((data.data as Record<string, unknown>[]) ?? []).find(a => a.asset_type === "FLOW_JSON");
    const url = asset?.download_url as string | undefined;
    if (!url) return { title: "", fields: [], error: "No Flow JSON found for this form." };
    const flowJson = await fetch(url).then(r => r.json()).catch(() => ({}));
    return parseFlowJson(flowJson as Record<string, unknown>);
  } catch (err) {
    return { title: "", fields: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// Renames a form. Meta allows updating a Flow's NAME (metadata) in any status,
// even published — only its content is locked once published.
export async function renameWaForm(id: string, name: string, channel?: ChannelCreds): Promise<{ success: boolean; error?: string }> {
  const { token } = getCreds(channel);
  if (!token) return { success: false, error: "Missing META_WA_ACCESS_TOKEN" };
  if (!name.trim()) return { success: false, error: "name required" };
  try {
    const res = await fetch(`${GRAPH}/${id}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 200) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) return { success: false, error: errMsg(data, res.status) };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Replaces a DRAFT form's content with new Flow JSON (Meta allows editing only
// while a Flow is in draft — published Flows are immutable, so clone instead).
export async function updateWaFormJson(id: string, flowJson: Record<string, unknown>, channel?: ChannelCreds): Promise<{ validationErrors?: string[]; error?: string }> {
  const { token } = getCreds(channel);
  if (!token) return { error: "Missing META_WA_ACCESS_TOKEN" };
  const up = await uploadFlowJson(token, id, flowJson);
  if (up.error) return { error: up.error };
  return { validationErrors: up.errors };
}

export async function listWaForms(channel?: ChannelCreds): Promise<WaForm[]> {
  const { token, wabaId } = getCreds(channel);
  if (!token || !wabaId) throw new Error("Missing META_WA_ACCESS_TOKEN / META_WA_WABA_ID");
  const res = await fetch(
    `${GRAPH}/${wabaId}/flows?fields=id,name,status,categories,validation_errors,preview.invalidate(false)&limit=100`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errMsg(data, res.status));
  return ((data.data as Record<string, unknown>[]) ?? []).map(r => ({
    id: r.id as string,
    name: r.name as string,
    status: (r.status as string) ?? "DRAFT",
    categories: (r.categories as string[]) ?? [],
    validationErrors: (((r.validation_errors as { message?: string; error_user_msg?: string }[]) ?? [])
      .map(e => e.error_user_msg || e.message || "")).filter(Boolean),
    previewUrl: ((r.preview as Record<string, unknown>)?.preview_url as string) ?? null,
  }));
}

// Drafts can be deleted outright; published forms can only be deprecated.
export async function deleteWaForm(id: string, channel?: ChannelCreds): Promise<{ success: boolean; deprecated?: boolean; error?: string }> {
  const { token } = getCreds(channel);
  if (!token) return { success: false, error: "Missing META_WA_ACCESS_TOKEN" };
  try {
    const res = await fetch(`${GRAPH}/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return { success: true };
    const dep = await fetch(`${GRAPH}/${id}/deprecate`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await dep.json().catch(() => ({}));
    if (dep.ok && data.success !== false) return { success: true, deprecated: true };
    return { success: false, error: errMsg(data, dep.status) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Send a published form as an interactive flow message (CTA opens the form).
export async function sendWaFormMessage(phone: string, params: { formId: string; bodyText: string; cta: string }, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: (phone || "").replace(/\D/g, ""),
        type: "interactive",
        interactive: {
          type: "flow",
          body: { text: params.bodyText.slice(0, 1024) },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: `${params.formId}.${Date.now()}`,
              flow_id: params.formId,
              flow_cta: params.cta.slice(0, 20) || "Open form",
              flow_action: "navigate",
              flow_action_payload: { screen: "FORM_SCREEN" },
            },
          },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: errMsg(data, res.status) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
