import { describe, it, expect, vi } from "vitest";

// flowengine pulls in store/whatsapp → supabase; the pure platform helpers never
// touch it, so stub the heaviest leaf to keep the import offline.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure platform tests"); } }));

import { platformKinds, flowRunsOn } from "@/lib/flowengine";

describe("platformKinds — resolve a flow's stored platform", () => {
  it("a single kind → just that kind", () => {
    expect([...platformKinds("whatsapp")]).toEqual(["whatsapp"]);
    expect(platformKinds("webchat").has("webchat")).toBe(true);
  });
  it("a comma-set → exactly those kinds", () => {
    const k = platformKinds("whatsapp,messenger");
    expect(k.has("whatsapp")).toBe(true);
    expect(k.has("messenger")).toBe(true);
    expect(k.has("instagram")).toBe(false);
    expect(k.has("webchat")).toBe(false);
  });
  it("legacy 'all' → every kind; 'both' → WhatsApp + Instagram", () => {
    expect(platformKinds("all").size).toBe(4);
    expect([...platformKinds("both")].sort()).toEqual(["instagram", "whatsapp"]);
  });
  it("empty / nullish → defaults to whatsapp", () => {
    expect([...platformKinds("")]).toEqual(["whatsapp"]);
    expect([...platformKinds(null)]).toEqual(["whatsapp"]);
  });
});

describe("flowRunsOn — does a flow run on a given channel kind", () => {
  it("multi-select runs on each ticked channel only", () => {
    expect(flowRunsOn("whatsapp,webchat", "whatsapp")).toBe(true);
    expect(flowRunsOn("whatsapp,webchat", "webchat")).toBe(true);
    expect(flowRunsOn("whatsapp,webchat", "instagram")).toBe(false);
    expect(flowRunsOn("whatsapp,webchat", "messenger")).toBe(false);
  });
  it("'all' runs everywhere; 'both' is WhatsApp+Instagram only (not Messenger/web)", () => {
    expect(flowRunsOn("all", "messenger")).toBe(true);
    expect(flowRunsOn("all", "webchat")).toBe(true);
    expect(flowRunsOn("both", "instagram")).toBe(true);
    expect(flowRunsOn("both", "messenger")).toBe(false);
    expect(flowRunsOn("both", "webchat")).toBe(false);
  });
});
