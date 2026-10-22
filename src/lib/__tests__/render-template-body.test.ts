// The chat bubble has to show what the LEAD received, not the template's name.
//
// A template send stored only the name, so Live Chat showed
// `template "rnr_03_about_us"` where the message copy belonged — the one part
// of the message the lead never sees was also the only part the counsellor
// saw. renderTemplateBody() fills the approved BODY with the step's params,
// and — because a drip drain would otherwise fan one Graph call per send into
// the per-WABA rate limit (#80008) — caches the template list per WABA.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ calls: 0, templates: [] as unknown[], ok: true }));

// SaaS whatsapp.ts fetches templates through the global fetch.
beforeEach(() => {
  h.calls = 0; h.ok = true; h.templates = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    if (String(url).includes("/message_templates")) {
      h.calls++;
      return { ok: h.ok, status: h.ok ? 200 : 500, json: async () => ({ data: h.templates }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
});

import { renderTemplateBody } from "../whatsapp";

const tpl = (name: string, language: string, bodyText: string) => ({
  name, language, status: "APPROVED", category: "MARKETING",
  components: [{ type: "BODY", text: bodyText }],
});

// Each test uses its OWN wabaId: the per-WABA cache is module-level and lives
// across tests, so a shared key would let one test's list answer the next.
let wabaN = 0;
const freshCreds = () => ({ token: "t", wabaId: `WABA_${++wabaN}`, phoneId: "p" });

describe("renderTemplateBody", () => {
  it("fills {{n}} with the resolved params the lead was actually sent", async () => {
    const creds = freshCreds();
    h.templates = [tpl("rnr_03_about_us", "en_US", "Hi {{1}}, here's more about {{2}}.")];
    const out = await renderTemplateBody("rnr_03_about_us", "en_US", ["Tristan", "AnalytixLabs"], creds);
    expect(out).toBe("Hi Tristan, here's more about AnalytixLabs.");
  });

  it("returns the body verbatim when the template has no variables", async () => {
    const creds = freshCreds();
    h.templates = [tpl("welcome", "en_US", "Welcome aboard!")];
    expect(await renderTemplateBody("welcome", "en_US", [], creds)).toBe("Welcome aboard!");
  });

  it("prefers the matching language when a name exists in several", async () => {
    const creds = freshCreds();
    h.templates = [tpl("greet", "en_US", "Hello {{1}}"), tpl("greet", "hi", "Namaste {{1}}")];
    expect(await renderTemplateBody("greet", "hi", ["Priya"], creds)).toBe("Namaste Priya");
  });

  it("returns null when the template is not on this WABA, so the caller keeps its label", async () => {
    const creds = freshCreds();
    h.templates = [tpl("other", "en_US", "x")];
    expect(await renderTemplateBody("missing", "en_US", [], creds)).toBeNull();
  });

  it("returns null rather than throwing when Graph fails", async () => {
    const creds = freshCreds();
    h.ok = false;
    expect(await renderTemplateBody("whatever", "en_US", [], creds)).toBeNull();
  });

  it("reads Graph once per WABA across many sends, not once per send", async () => {
    const creds = freshCreds();
    h.templates = [tpl("rnr_03_about_us", "en_US", "Hi {{1}}")];
    for (let i = 0; i < 25; i++) {
      await renderTemplateBody("rnr_03_about_us", "en_US", [`lead${i}`], creds);
    }
    expect(h.calls).toBe(1);
  });
});
