import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { typeTourDescription } from "../tour-motion";

describe("tour typing motion", () => {
  let dom: JSDOM;
  let frame: ((time: number) => void) | undefined;
  let description: HTMLElement;
  beforeEach(() => {
    dom = new JSDOM('<p id="description">Hello 👋 — welcome to your workspace.</p>');
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });
    description = document.getElementById("description")!;
  });
  afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });

  it("reveals progressively while preserving full accessible text and layout", () => {
    const text = description.textContent;
    typeTourDescription(description, false);
    expect(description.querySelector(".talko-tour-text-accessible")?.textContent).toBe(text);
    expect(description.querySelector(".talko-tour-text-layout")?.textContent).toBe(text);
    const visual = description.querySelector(".talko-tour-text-typed")!;
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(visual.textContent).toBe("");
    frame?.(0);
    frame?.(350);
    expect(visual.textContent!.length).toBeGreaterThan(0);
    expect(visual.textContent!.length).toBeLessThan(text!.length);
    frame?.(2200);
    expect(visual.textContent).toBe(text);
    expect(description.classList.contains("talko-tour-typing")).toBe(false);
  });

  it("shows full text immediately for reduced motion", () => {
    const text = description.textContent;
    typeTourDescription(description, true);
    expect(description.textContent).toBe(text);
    expect(description.querySelector(".talko-tour-text-typed")).toBeNull();
  });

  it("cancels pending frames and restores plain text when changing steps", () => {
    const text = description.textContent;
    const stop = typeTourDescription(description, false);
    frame?.(0);
    stop();
    expect(frame).toBeUndefined();
    expect(description.textContent).toBe(text);
    expect(description.children).toHaveLength(0);
  });
});
