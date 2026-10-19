import { driver, type DriveStep } from "driver.js";

export function tourStorageKey(tenantId: string, email: string): string {
  return `talko.onboarding.v1:${encodeURIComponent(tenantId)}:${encodeURIComponent(email.trim().toLowerCase())}`;
}

/** Build from the rendered navigation so role, plan and workspace vocabulary stay accurate. */
export function workspaceTourSteps(): DriveStep[] {
  const steps: DriveStep[] = [{ popover: {
    title: "Welcome to Talko AI",
    description: "Let's find your conversations, customer records and setup tools. This tour only explains the controls; it won't send messages or change your settings.",
  } }];
  for (const key of ["home", "livechat", "contacts", "pipeline", "assistant", "broadcast", "setup", "settings"]) {
    const element = document.querySelector<HTMLElement>(`[data-tour-nav="${key}"]`);
    if (!element || !element.getClientRects().length) continue;
    steps.push({ element, popover: {
      // Driver renders HTML; copy labels into escaped text rather than injecting custom vocabulary.
      title: escapeText(element.textContent?.trim() || "Your workspace"),
      description: escapeText(element.dataset.help || "Open this screen to see its available tools."),
      side: "right", align: "center",
    } });
  }
  const replay = document.querySelector<HTMLElement>('[data-tour="replay"]');
  steps.push({ ...(replay ? { element: replay } : {}), popover: {
    title: "Help whenever you need it",
    description: "Click Take a tour at the top to restart this walkthrough. During normal use, hover over a control for four seconds to see what it does and how to use it. Keyboard focus works too.",
    side: "bottom",
  } });
  return steps;
}

function escapeText(text: string): string {
  const node = document.createElement("span");
  node.textContent = text;
  return node.innerHTML;
}

export function installProductTour({ storageKey, impersonating = false }: { storageKey: string; impersonating?: boolean }) {
  let disposed = false;
  const tour = driver({
    animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    popoverClass: "talko-tour",
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    showButtons: ["previous", "next", "close"],
    prevBtnText: "Previous", nextBtnText: "Next", doneBtnText: "Done",
    allowClose: true, disableActiveInteraction: true,
    onPopoverRender: ({ closeButton }) => closeButton.setAttribute("aria-label", "Close tour"),
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
    if (impersonating) return;
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
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", close);
      tour.destroy();
    },
  };
}
