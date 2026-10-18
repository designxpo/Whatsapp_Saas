// The helper exists because 215 call sites forgot one line, so what matters
// is that it cannot be made to report success quietly. Every test here is a
// failure that previously looked like a success.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getJson, postJson, ApiError, apiErrorText, newGeneration } from "../apicall";

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); });

const res = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
}) as unknown as Response;

describe("a failure cannot be mistaken for a success", () => {
  it("throws on a 500 instead of resolving", async () => {
    mockFetch.mockResolvedValue(res(500, JSON.stringify({ error: "migration 0020 is not applied" })));
    await expect(postJson("/api/admin/settings", { ai: { enabled: false } })).rejects.toBeInstanceOf(ApiError);
  });

  it("carries the server's own message, because it is the specific one", async () => {
    mockFetch.mockResolvedValue(res(500, JSON.stringify({ error: "migration 0020 is not applied" })));
    await expect(postJson("/x")).rejects.toThrow("migration 0020 is not applied");
  });

  it("does not show a raw HTML error page to a person", async () => {
    // A platform-level 502 answers with HTML. Putting that on screen is worse
    // than saying nothing specific.
    mockFetch.mockResolvedValue(res(502, "<html><body>Bad Gateway</body></html>"));
    await expect(postJson("/x")).rejects.toMatchObject({ status: 502, message: "" });
    try { await postJson("/x"); } catch (e) { expect(apiErrorText(e)).toBe("The server returned an error (502)."); }
  });

  it("treats a 2xx with an unreadable body as a failure, not as undefined", async () => {
    // Returning undefined here is how a caller ends up reading a property of
    // nothing one line later.
    mockFetch.mockResolvedValue(res(200, "<!doctype html>"));
    await expect(getJson("/x")).rejects.toThrow(/could not read/i);
  });

  it("lets a network rejection through rather than swallowing it", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(getJson("/x")).rejects.toThrow();
  });

  it("accepts an empty 2xx body", async () => {
    mockFetch.mockResolvedValue(res(204, ""));
    await expect(postJson("/x")).resolves.toBeUndefined();
  });
});

describe("what the person is told", () => {
  it("names an expired session rather than blaming the network", async () => {
    mockFetch.mockResolvedValue(res(401, JSON.stringify({ error: "Unauthorized" })));
    try { await getJson("/x"); } catch (e) {
      expect((e as ApiError).auth).toBe(true);
      expect(apiErrorText(e)).toMatch(/session has expired/i);
    }
  });

  it("keeps a 403's own wording, which explains WHICH permission", async () => {
    mockFetch.mockResolvedValue(res(403, JSON.stringify({ error: "Admins only" })));
    try { await getJson("/x"); } catch (e) { expect(apiErrorText(e)).toBe("Admins only"); }
  });

  it("says the server is unreachable for a network failure", () => {
    expect(apiErrorText(new TypeError("Failed to fetch"))).toMatch(/could not reach the server/i);
  });

  it("never returns an empty string, whatever it was handed", () => {
    for (const e of [null, undefined, 0, "", {}, new Error("")]) {
      expect(apiErrorText(e).length).toBeGreaterThan(0);
    }
  });
});

describe("the request shape", () => {
  it("sends JSON on a post", async () => {
    mockFetch.mockResolvedValue(res(200, "{}"));
    await postJson("/api/x", { a: 1 });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("omits the body entirely when there is none", async () => {
    mockFetch.mockResolvedValue(res(200, "{}"));
    await postJson("/api/x");
    expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
  });
});

describe("only the newest request may write", () => {
  it("reports the older attempt as stale once a newer one starts", () => {
    const g = newGeneration();
    const first = g.next();
    const second = g.next();
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(true);
  });

  it("aborts the previous attempt when a new one starts", () => {
    const g = newGeneration();
    const first = g.next();
    expect(first.signal.aborted).toBe(false);
    g.next();
    expect(first.signal.aborted).toBe(true);
  });

  it("recognises its own cancellation so it is not shown as an error", () => {
    const g = newGeneration();
    expect(g.aborted(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(g.aborted(new Error("500"))).toBe(false);
  });

  it("the slow first answer loses to the fast second — the Alice/Bob case", async () => {
    // Search "Alice", then "Bob". Alice's response arrives last. Without the
    // generation check the table shows Alice under the word Bob.
    const g = newGeneration();
    const written: string[] = [];
    const alice = g.next();
    const bob = g.next();
    const settle = (who: string, tok: { current: () => boolean }) => { if (tok.current()) written.push(who); };
    settle("bob", bob);
    settle("alice", alice);        // arrives later, must be ignored
    expect(written).toEqual(["bob"]);
  });
});
