import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ active: false, drive: vi.fn(), destroy: vi.fn(), setSteps: vi.fn() }));
vi.mock("driver.js", () => ({ driver: () => ({
  drive: mock.drive, destroy: mock.destroy, setSteps: mock.setSteps, isActive: () => mock.active,
}) }));
import { installProductTour, tourStorageKey, workspaceTourSteps } from "../product-tour";

describe("workspace onboarding", () => {
  let dom: JSDOM;
  let frame: (() => void) | undefined;
  let controller: ReturnType<typeof installProductTour> | undefined;
  const key = tourStorageKey("workspace-1", "person@example.test");
  beforeEach(() => {
    vi.clearAllMocks();
    dom = new JSDOM('<button data-tour-nav="livechat" data-help="Review and reply to conversations.">Live Chat</button><button data-tour="replay">Take a tour</button>', { url: "https://talko.test" });
    for (const name of ["window", "document", "HTMLElement", "localStorage"] as const) vi.stubGlobal(name, dom.window[name]);
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });
    Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    mock.active = false;
    mock.drive.mockImplementation(() => { mock.active = true; });
    mock.destroy.mockImplementation(() => { mock.active = false; });
  });
  afterEach(() => {
    controller?.cleanup();
    dom.window.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows once, persists dismissal and permits replay", () => {
    controller = installProductTour({ storageKey: key });
    frame?.();
    expect(mock.drive).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBe("shown");
    expect(fetch).toHaveBeenCalledWith("/api/admin/walkthrough", { method: "POST" });
    controller.cleanup();
    controller = installProductTour({ storageKey: key });
    frame?.();
    expect(mock.drive).toHaveBeenCalledTimes(1);
    controller.start();
    expect(mock.drive).toHaveBeenCalledTimes(2);
  });

  it("does not consume a visit during Strict Mode cleanup", () => {
    controller = installProductTour({ storageKey: key });
    controller.cleanup();
    frame?.();
    expect(localStorage.getItem(key)).toBeNull();
    controller = installProductTour({ storageKey: key });
    frame?.();
    expect(mock.drive).toHaveBeenCalledTimes(1);
  });

  it("isolates workspaces and users while normalizing email case", () => {
    expect(key).toBe(tourStorageKey("workspace-1", " Person@Example.Test "));
    expect(key).not.toBe(tourStorageKey("workspace-2", "person@example.test"));
    expect(key).not.toBe(tourStorageKey("workspace-1", "other@example.test"));
  });

  it("does not consume another user's onboarding during impersonation", () => {
    controller = installProductTour({ storageKey: key, impersonating: true });
    frame?.();
    expect(mock.drive).not.toHaveBeenCalled();
    controller.start();
    expect(mock.drive).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("only tours rendered navigation and escapes workspace vocabulary", () => {
    const nav = document.querySelector<HTMLElement>("[data-tour-nav]")!;
    nav.textContent = '<img src=x onerror="alert(1)">';
    nav.dataset.help = "<b>Custom help</b>";
    const steps = workspaceTourSteps();
    expect(steps).toHaveLength(3);
    expect(steps[1].popover?.title).toContain("&lt;img");
    expect(steps[1].popover?.description).toBe("&lt;b&gt;Custom help&lt;/b&gt;");
    nav.remove();
    expect(workspaceTourSteps()).toHaveLength(2);
  });

  it("allows manual replay when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } });
    controller = installProductTour({ storageKey: key });
    frame?.();
    expect(mock.drive).not.toHaveBeenCalled();
    expect(() => controller!.start()).not.toThrow();
    expect(mock.drive).toHaveBeenCalledTimes(1);
  });
});
