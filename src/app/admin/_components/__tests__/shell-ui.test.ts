// @vitest-environment jsdom
// The shell's search dialog and the phone tab bar, rendered: keyboard use and
// ARIA of the search combobox, and the words behind each badge.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";
import { MobileTabBar } from "../MobileTabBar";
import type { PaletteEntry } from "../shell-logic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = (el: React.ReactElement) => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(el)); };
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ""; });

const entries: PaletteEntry[] = [
  { id: "act:broadcast", group: "Actions", label: "New broadcast", tab: "broadcast" },
  { id: "tab:templates", group: "Go to", label: "Templates", hint: "Message formats WhatsApp has approved", tab: "templates" },
  { id: "tab:contacts", group: "Go to", label: "Contacts", tab: "contacts" },
  { id: "settings:team", group: "Settings", label: "Settings › Team", keywords: "staff invite", tab: "settings", section: "team" },
];

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("search dialog", () => {
  it("is a combobox over a listbox, filtered by typing and driven by the arrows", () => {
    const onPick = vi.fn();
    mount(createElement(CommandPalette, { open: true, onClose: () => {}, entries, onPick }));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(4);

    type(input, "staff");
    const options = () => Array.from(document.querySelectorAll('[role="option"]'));
    expect(options().map(o => o.textContent)).toEqual(["Settings › Team"]);
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");

    type(input, "t");
    expect(options().length).toBeGreaterThan(1);
    key(input, "ArrowDown");
    const second = options()[1];
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(second.id);
    key(input, "ArrowUp");
    key(input, "ArrowUp");   // wraps to the last
    expect(options()[options().length - 1].getAttribute("aria-selected")).toBe("true");
    key(input, "Enter");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("says so when nothing matches", () => {
    mount(createElement(CommandPalette, { open: true, onClose: () => {}, entries, onPick: () => {} }));
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    type(input, "qqqq");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Nothing matches");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("phone tab bar", () => {
  it("carries the waiting and overdue counts, in words for screen readers", () => {
    const onGo = vi.fn(), onMore = vi.fn();
    mount(createElement(MobileTabBar, { tab: "home", onGo, onMore, moreOpen: false, waiting: 3, overdue: 1, contactsLabel: "Students", show: () => true }));
    const buttons = Array.from(document.querySelectorAll("nav button"));
    expect(buttons.map(b => b.textContent?.replace(/\d+/g, "").replace(/,.*$/, "").trim())).toEqual(["Home", "Inbox", "Today", "Students", "More"]);
    const inbox = buttons[1], today = buttons[2];
    expect(inbox.querySelector(".sr-only")?.textContent).toContain("3 waiting for you");
    expect(today.querySelector(".sr-only")?.textContent).toContain("1 overdue");
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    act(() => { (inbox as HTMLButtonElement).click(); });
    expect(onGo).toHaveBeenCalledWith("livechat");
    act(() => { (buttons[4] as HTMLButtonElement).click(); });
    expect(onMore).toHaveBeenCalled();
    expect(buttons[4].getAttribute("aria-controls")).toBe("portal-nav");
  });
});
