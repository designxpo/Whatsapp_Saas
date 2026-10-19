const TARGETS = '[data-help], [data-tour-link], [data-tour]:not([data-tour="navigation"]), button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]';

export function helpFor(element: HTMLElement): { title: string; description: string } | null {
  const labels = (element as HTMLInputElement).labels;
  const title = (element.dataset.helpTitle || element.getAttribute('aria-label') || element.getAttribute('title') ||
    labels?.[0]?.textContent || (element.matches('input, select, textarea') ? element.getAttribute('placeholder') : element.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!title) return null;
  let description = element.dataset.help;
  if (element.dataset.tour === "replay") description = "Restart the guided walkthrough. Close it anytime to return to your work.";
  if (!description) {
    if (element.matches(':disabled, [aria-disabled="true"]')) description = 'This control is currently unavailable. Complete the required fields or steps on this screen first.';
    else if (element.matches('input[type="checkbox"], input[type="radio"]')) description = 'Select this option to change your selection. Review the form before saving.';
    else if (element.matches('select')) description = 'Open the list and choose an option.';
    else if (element.matches('input, textarea')) description = 'Enter or edit this field. Follow any format or validation message shown beside it.';
    else if (element.matches('a')) description = 'Open this link to view the named page or resource.';
    else description = 'Activate this control to perform the named action. Review any options or confirmation shown before continuing.';
  }
  return { title, description };
}

/** Delegated listeners cover controls added by queries, sheets and route updates. */
export function installHoverHelp(): () => void {
  let target: HTMLElement | null = null;
  let bubble: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let previousDescription: string | null = null;
  const id = 'talko-context-help';

  const hide = () => {
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
    text.textContent = help.description;
    bubble.append(heading, text);
    document.body.append(bubble);
    const rect = target.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();
    bubble.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12))}px`;
    const top = rect.bottom + 8 + box.height < window.innerHeight ? rect.bottom + 8 : rect.top - box.height - 8;
    bubble.style.top = `${Math.max(12, Math.min(top, window.innerHeight - box.height - 12))}px`;
    previousDescription = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [previousDescription, id].filter(Boolean).join(' '));
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
    timer = setTimeout(show, 4000);
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
