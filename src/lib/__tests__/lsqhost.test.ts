// LeadSquared calls may only go to LeadSquared (lsqhost.ts).
import { describe, it, expect } from "vitest";
import { lsqApiHost } from "../lsqhost";

describe("lsqApiHost", () => {
  it("accepts LeadSquared's API hosts however they were typed, as one https origin", () => {
    for (const raw of [
      "https://api-in21.leadsquared.com", "https://api-in21.leadsquared.com/", " https://API-IN21.leadsquared.com// ",
      "api-in21.leadsquared.com", "http://api-in21.leadsquared.com", "https://api-in21.leadsquared.com/v2/",
    ]) expect(lsqApiHost(raw), raw).toBe("https://api-in21.leadsquared.com");
    expect(lsqApiHost("https://api.leadsquared.com")).toBe("https://api.leadsquared.com");
    expect(lsqApiHost("https://api-us11.leadsquared.com")).toBe("https://api-us11.leadsquared.com");
  });

  it("refuses any other host, so a workspace setting cannot point the server elsewhere", () => {
    for (const raw of [
      "http://10.0.0.5:8080/admin#", "http://127.0.0.1", "http://169.254.169.254", "localhost",
      "https://api-in21.leadsquared.com.evil.com", "https://evil.com/api-in21.leadsquared.com",
      "https://api-in21.leadsquared.com@evil.com", "https://user:pw@api-in21.leadsquared.com",
      "https://api-in21.leadsquared.com:8443", "ftp://api-in21.leadsquared.com",
      "https://app-in21.leadsquared.com", "https://notleadsquared.com",
      "", null, undefined,
    ]) expect(lsqApiHost(raw), String(raw)).toBe("");
  });
});
