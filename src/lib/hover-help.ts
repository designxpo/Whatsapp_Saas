const TARGETS = '[data-help], [data-tour-link], [data-tour]:not([data-tour="navigation"]), button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]';

/** How long the pointer (or keyboard focus) rests on a control before its help shows. */
export const HELP_DELAY_MS = 700;

/** Truly unavailable right now: the control itself (or its fieldset) is disabled. */
function isDisabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  if ((element as HTMLButtonElement).disabled === true) return true;
  return element.matches(':disabled');
}

/**
 * The help for one control, or null when there is nothing worth saying.
 *
 * Only real help is shown: the control's own `data-help`, the reason a control
 * is unavailable (`data-help-disabled`, or a plain "not available" — and only
 * when it really is disabled), or the name of an icon-only button whose label
 * isn't visible. A generic "activate this control" line on every button said
 * nothing, and at a short delay it would follow the pointer everywhere.
 */
export function helpFor(element: HTMLElement): { title: string; description: string } | null {
  const labels = (element as HTMLInputElement).labels;
  const visibleText = (element.matches('input, select, textarea') ? '' : element.textContent || '').trim();
  const title = (element.dataset.helpTitle || element.getAttribute('aria-label') || element.getAttribute('title') ||
    labels?.[0]?.textContent || (element.matches('input, select, textarea') ? element.getAttribute('placeholder') : visibleText) || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!title) return null;
  if (isDisabled(element)) return { title, description: element.dataset.helpDisabled || element.dataset.help || 'Not available right now.' };
  if (element.dataset.tour === "replay") return { title, description: "Restart the guided walkthrough. Close it anytime to return to your work." };
  if (element.dataset.help) return { title, description: element.dataset.help };
  // An icon-only control: its name isn't on screen, so say it.
  if (!visibleText && !element.matches('input, select, textarea')) return { title, description: '' };
  return null;
}

/** Delegated listeners cover controls added by queries, sheets and route updates. */
export function installHoverHelp(): () => void {
  let target: HTMLElement | null = null;
  let bubble: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let previousDescription: string | null = null;
  const id = 'talko-context-help';

  const watch = new MutationObserver(() => hide());
  const hide = () => {
    watch.disconnect();
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    if (target && bubble) {
      if (previousDescription === null) target.removeAttribute('aria-describedby');
      else target.setAttribute('aria-describedby', previousDescription);
    }
    bubble?.remove();
    bubble = null;
    target = null;
  };
  const show = () => {
    if (!target?.isConnected || document.body.classList.contains('driver-active') || document.hidden) return;
    const help = helpFor(target);
    if (!help || !target.getClientRects().length) return;
    bubble = document.createElement('div');
    bubble.id = id;
    bubble.className = 'talko-hover-help';
    bubble.setAttribute('role', 'tooltip');
    const heading = document.createElement('strong');
    const text = document.createElement('p');
    // Never interpolate labels or user-provided values into HTML.
    heading.textContent = help.title;
    bubble.append(heading);
    if (help.description) {
      text.textContent = help.description;
      bubble.append(text);
    }
    document.body.append(bubble);
    const rect = target.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();
    bubble.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12))}px`;
    const top = rect.bottom + 8 + box.height < window.innerHeight ? rect.bottom + 8 : rect.top - box.height - 8;
    bubble.style.top = `${Math.max(12, Math.min(top, window.innerHeight - box.height - 12))}px`;
    previousDescription = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [previousDescription, id].filter(Boolean).join(' '));
    // A control that turns on or off while its help is up would leave the
    // wrong words showing ("not available" on a button that now works).
    watch.observe(target, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'data-help'] });
  };
  const enter = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerType === 'touch') return;
    const node = event.target instanceof Element ? event.target : null;
    if (node?.closest('.talko-hover-help')) { clearTimeout(leaveTimer); return; }
    if (document.body.classList.contains('driver-active') || node?.closest('.driver-popover')) return;
    const next = node?.closest<HTMLElement>(TARGETS) ?? null;
    if (next === target) { clearTimeout(leaveTimer); return; }
    hide();
    if (!next || !helpFor(next)) return;
    target = next;
    timer = setTimeout(show, HELP_DELAY_MS);
  };
  const leave = (event: Event) => {
    const related = (event as PointerEvent | FocusEvent).relatedTarget;
    if (related instanceof Node && (target?.contains(related) || bubble?.contains(related))) return;
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    // Allow moving from a target across the small gap onto its tooltip.
    if (bubble) leaveTimer = setTimeout(hide, 150);
    else hide();
  };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('driver-active')) hide();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('pointerover', enter);
  document.addEventListener('pointerout', leave);
  document.addEventListener('focusin', enter);
  document.addEventListener('focusout', leave);
  document.addEventListener('keydown', keydown);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('input', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('resize', hide);
  return () => {
    hide();
    observer.disconnect();
    document.removeEventListener('pointerover', enter);
    document.removeEventListener('pointerout', leave);
    document.removeEventListener('focusin', enter);
    document.removeEventListener('focusout', leave);
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('input', hide, true);
    document.removeEventListener('scroll', hide, true);
    document.removeEventListener('visibilitychange', hide);
    window.removeEventListener('resize', hide);
  };
}
