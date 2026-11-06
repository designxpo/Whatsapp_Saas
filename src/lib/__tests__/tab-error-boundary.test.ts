// @vitest-environment jsdom
// A screen that throws no longer blanks the whole portal: only its area shows
// what went wrong, with a way out. A screen whose code is from an older deploy
// reloads the page once (not in a loop).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TabErrorBoundary } from "@/components/tab-error-boundary";
import { isChunkLoadError, reloadForNewDeploy } from "@/lib/chunk-reload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLDivElement, root: Root;
const reload = vi.fn();
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el);
  sessionStorage.clear(); reload.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { act(() => root.unmount()); el.remove(); vi.restoreAllMocks(); });

const Boom = ({ error }: { error: Error }) => { throw error; };
const mount = (error: Error | null, onHome?: () => void) => act(() => {
  root.render(createElement(TabErrorBoundary, { title: "Integrations", onHome }, error ? createElement(Boom, { error }) : createElement("p", null, "Screen works")));
});

describe("chunk-load errors", () => {
  it("recognises the browsers' messages for code from an older deploy", () => {
    expect(isChunkLoadError(Object.assign(new Error("Loading chunk 4521 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://app/x.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
  });
  it("reloads once, then not again within a minute", () => {
    expect(reloadForNewDeploy(1_000_000)).toBe(true);
    expect(reloadForNewDeploy(1_030_000)).toBe(false);
    expect(reloadForNewDeploy(1_070_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("a screen that crashes", () => {
  it("shows the screen normally when nothing is wrong", () => {
    mount(null);
    expect(el.textContent).toBe("Screen works");
  });

  it("keeps the error inside its own area, shows the message, and offers a way out", () => {
    const home = vi.fn();
    mount(new TypeError("Cannot read properties of undefined (reading 'map')"), home);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent).toMatch(/Integrations couldn't open/);
    expect(el.textContent).toMatch(/reading 'map'/);
    expect(reload).not.toHaveBeenCalled();
    act(() => { (Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Go to Home") as HTMLButtonElement).click(); });
    expect(home).toHaveBeenCalled();
  });

  it("reloads once when the screen's code is from an older deploy", () => {
    mount(Object.assign(new Error("Loading chunk 77 failed."), { name: "ChunkLoadError" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(el.textContent).toMatch(/Updating to the latest version/);
  });
});
