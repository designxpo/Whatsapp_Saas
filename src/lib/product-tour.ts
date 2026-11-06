import { driver, type DriveStep } from "driver.js";
import { typeTourDescription } from "./tour-motion";

export function tourStorageKey(tenantId: string, email: string): string {
  return `talko.onboarding.v1:${encodeURIComponent(tenantId)}:${encodeURIComponent(email.trim().toLowerCase())}`;
}

/**
 * Whether a tour target is really on screen. A closed phone menu still has
 * layout boxes (it is only moved off-canvas and hidden), so a box alone is not
 * enough: the element must be visible and inside the viewport horizontally.
 */
export function isOnScreen(element: HTMLElement): boolean {
  if (!element.getClientRects().length) return false;
  const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
  if (style && (style.visibility === "hidden" || style.display === "none")) return false;
  const rect = element.getBoundingClientRect?.();
  if (rect && (rect.width || rect.height) && (rect.right <= 0 || rect.left >= window.innerWidth)) return false;
  return true;
}

/** The first on-screen element for each key: the sidebar on a computer, the bottom bar on a phone. */
function firstShown(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) if (isOnScreen(el)) return el;
  return null;
}

/** Build from the rendered navigation so role, plan and workspace vocabulary stay accurate. */
export function workspaceTourSteps(): DriveStep[] {
  const steps: DriveStep[] = [{ popover: {
    title: "Welcome to Talko AI",
    description: "Let's find your conversations, customer records and setup tools. This tour only explains the controls; it won't send messages or change your settings.",
  } }];
  // "more" is the phone's bottom-bar button that opens the full menu.
  for (const key of ["home", "livechat", "today", "contacts", "analytics", "assistant", "broadcast", "setup", "settings", "more"]) {
    const element = firstShown(`[data-tour-nav="${key}"]`);
    if (!element) continue;
    const side = element.dataset.tourSide === "top" ? "top" : "right";
    steps.push({ element, popover: {
      // Driver renders HTML; copy labels into escaped text rather than injecting custom vocabulary.
      title: escapeText(element.dataset.tourTitle || element.textContent?.trim() || "Your workspace"),
      description: escapeText(element.dataset.help || "Open this screen to see its available tools."),
      side, align: "center",
    } });
  }
  const replay = firstShown('[data-tour="replay"]');
  steps.push({ ...(replay ? { element: replay } : {}), popover: {
    title: "Help whenever you need it",
    description: "Choose Take a tour to restart this walkthrough. To find any screen and see what it's for, use Search (Ctrl+K, or ⌘K on a Mac).",
    side: "bottom",
  } });
  return steps;
}

function escapeText(text: string): string {
  const node = document.createElement("span");
  node.textContent = text;
  return node.innerHTML;
}

/**
 * `autoStart` decides whether the first visit opens the tour by itself (the
 * shell says no on phones and tablets, where the menu is folded away); a
 * replay from "Take a tour" always works.
 */
export function installProductTour({ storageKey, impersonating = false, autoStart = () => true }: { storageKey: string; impersonating?: boolean; autoStart?: () => boolean }) {
  let disposed = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stopTyping = () => {};
  let focusFrame = 0;
  const stopMotion = () => {
    stopTyping();
    stopTyping = () => {};
    cancelAnimationFrame(focusFrame);
  };
  const tour = driver({
    animate: !reducedMotion,
    smoothScroll: !reducedMotion,
    stagePadding: 4,
    stageRadius: 24,
    popoverOffset: 16,
    overlayColor: "#0a1a2f",
    overlayOpacity: 0.48,
    popoverClass: "talko-tour",
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    showButtons: ["previous", "next", "close"],
    prevBtnText: "Previous", nextBtnText: "Next", doneBtnText: "Done",
    allowClose: true, disableActiveInteraction: true,
    onHighlightStarted: stopMotion,
    onDestroyed: stopMotion,
    onPopoverRender: ({ closeButton, description, wrapper }) => {
      stopMotion();
      closeButton.setAttribute("aria-label", "Close tour");
      wrapper.tabIndex = -1;
      stopTyping = typeTourDescription(description, reducedMotion);
      // Driver focuses the first control (Close) by default. Focus the dialog instead;
      // keyboard users can still Tab to Close and receive its visible focus indicator.
      focusFrame = requestAnimationFrame(() => {
        if (wrapper.isConnected) wrapper.focus({ preventScroll: true });
      });
    },
  });
  const start = () => {
    if (disposed || tour.isActive()) return;
    tour.setSteps(workspaceTourSteps());
    tour.drive();
    if (!tour.isActive() || impersonating) return;
    // Count dismissal as seen too; never repeat automatically just because someone skipped.
    try { localStorage.setItem(storageKey, "shown"); } catch { /* Replay works without storage. */ }
    // Preserve the existing tenant onboarding metadata used by the setup flow.
    void fetch("/api/admin/walkthrough", { method: "POST" }).catch(() => {});
  };
  const frame = requestAnimationFrame(() => {
    if (impersonating || !autoStart()) return;
    try {
      if (localStorage.getItem(storageKey) === "shown") return;
      const probe = `${storageKey}:probe`;
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
    } catch { return; }
    start();
  });
  const close = () => tour.destroy();
  window.addEventListener("resize", close);
  return {
    start,
    cleanup: () => {
      disposed = true;
      stopMotion();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", close);
      tour.destroy();
    },
  };
}
