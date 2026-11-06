// @vitest-environment jsdom
// Shared portal UI pieces: Indian number/date formatting, toasts (with Undo,
// announced politely), and the in-page text dialog that replaces prompt().

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fmtAgo, fmtDay, fmtInr, fmtNum, fmtPct, fmtUpdated, fmtWait } from "../format";
import { Toaster, toast } from "../../components/toast";
import { usePromptDialog } from "../../components/prompt-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("formatting", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("groups numbers the Indian way and prints rupees", () => {
    expect(fmtNum(1234567)).toBe("12,34,567");
    expect(fmtInr(123456)).toBe("₹1,23,456");
    expect(fmtInr(99.5, { paise: true })).toBe("₹99.50");
    expect(fmtNum(null)).toBe("—");
    expect(fmtPct(0.8123)).toBe("81%");
    expect(fmtPct(64, { of100: true })).toBe("64%");
  });
  it("writes dates and waits in words people read at a glance", () => {
    expect(fmtDay("2026-11-06", new Date(now))).toBe("6 Nov");
    expect(fmtDay("2025-12-31", new Date(now))).toBe("31 Dec 2025");
    expect(fmtAgo(new Date(now - 30_000).toISOString(), now)).toBe("just now");
    expect(fmtAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 min ago");
    expect(fmtAgo(new Date(now - 26 * 3600_000).toISOString(), now)).toBe("1 day ago");
    expect(fmtWait(new Date(now - 125 * 60_000).toISOString(), now)).toBe("2 h 5 min");
    expect(fmtUpdated(now - 120_000, now)).toBe("Updated 2 min ago");
    expect(fmtDay("not a date")).toBe("—");
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = (el: React.ReactElement) => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(el)); };
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.useRealTimers(); });

describe("toast", () => {
  it("shows the message in a polite live region, runs Undo, and goes away by itself", () => {
    vi.useFakeTimers();
    mount(createElement(Toaster));
    const undo = vi.fn();
    act(() => toast({ text: "Booking cancelled", action: { label: "Undo", onClick: undo } }));
    const region = document.querySelector("[aria-live='polite']")!;
    expect(region.textContent).toContain("Booking cancelled");
    act(() => (Array.from(region.querySelectorAll("button")).find(b => b.textContent === "Undo") as HTMLButtonElement).click());
    expect(undo).toHaveBeenCalledOnce();
    expect(region.textContent).not.toContain("Booking cancelled");
    act(() => toast("Saved"));
    expect(region.textContent).toContain("Saved");
    act(() => { vi.advanceTimersByTime(4100); });
    expect(region.textContent).not.toContain("Saved");
  });
});

describe("prompt dialog", () => {
  it("returns what was typed, or null when closed", async () => {
    let ask: ReturnType<typeof usePromptDialog>[0] | null = null;
    function Host() { const [a, dialog] = usePromptDialog(); ask = a; return createElement("div", null, dialog); }
    mount(createElement(Host));
    let answer: Promise<string | null> = Promise.resolve(null);
    act(() => { answer = ask!({ title: "Cancel this booking?", label: "Reason", required: true, confirmLabel: "Cancel booking" }); });
    const input = document.getElementById("prompt-dialog-input") as HTMLInputElement;
    const confirm = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Cancel booking") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, "  Customer asked  "); input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { (document.getElementById("prompt-dialog-form") as HTMLFormElement).requestSubmit(); });
    expect(await answer).toBe("Customer asked");
    act(() => { answer = ask!({ title: "Rename", label: "Name" }); });
    act(() => (document.querySelector("[aria-label='Close']") as HTMLButtonElement).click());
    expect(await answer).toBeNull();
  });
});
