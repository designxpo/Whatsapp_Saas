import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_DELAY_MS, helpFor, installHoverHelp } from '../hover-help';

describe('contextual help during normal use', () => {
  let cleanup: () => void;
  let dom: JSDOM;
  const over = (element: Element) => element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  const tip = () => document.querySelector('[role="tooltip"]');

  beforeEach(() => {
    vi.useFakeTimers();
    dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    for (const name of ['window', 'document', 'Element', 'HTMLElement', 'Node', 'PointerEvent', 'FocusEvent', 'KeyboardEvent', 'DOMRect', 'MutationObserver'] as const) {
      vi.stubGlobal(name, dom.window[name]);
    }
    document.body.innerHTML = '<a href="/admin?tab=livechat" data-help="Review incoming conversations and reply to customers." aria-describedby="existing">Orders</a><button data-help="Save your changes.">Save</button>';
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ 0: new DOMRect(), length: 1, item: () => new DOMRect(), [Symbol.iterator]: function* () { yield new DOMRect(); } } as DOMRectList);
    cleanup = installHoverHelp();
  });
  afterEach(() => {
    cleanup();
    dom.window.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('waits a moment (not four seconds) and describes how to use the hovered control', () => {
    over(document.querySelector('a')!);
    vi.advanceTimersByTime(HELP_DELAY_MS - 1);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(tip()?.textContent).toContain('Review incoming conversations');
    expect(document.querySelector('a')?.getAttribute('aria-describedby')).toContain('existing talko-context-help');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()).toBeNull();
    expect(document.querySelector('a')?.getAttribute('aria-describedby')).toBe('existing');
  });

  it('cancels on leaving a control and restarts the wait on another', () => {
    const link = document.querySelector('a')!;
    over(link);
    vi.advanceTimersByTime(HELP_DELAY_MS - 100);
    link.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    over(document.querySelector('button')!);
    vi.advanceTimersByTime(HELP_DELAY_MS - 100);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(100);
    expect(tip()?.textContent).toContain('Save');
  });

  it('does not compete with the onboarding tour', async () => {
    over(document.querySelector('a')!);
    vi.advanceTimersByTime(HELP_DELAY_MS);
    document.body.classList.add('driver-active');
    await Promise.resolve();
    expect(tip()).toBeNull();
    over(document.querySelector('button')!);
    vi.advanceTimersByTime(HELP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it('supports keyboard focus and dismisses on interaction', () => {
    document.querySelector('button')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(HELP_DELAY_MS);
    expect(tip()).not.toBeNull();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(tip()).toBeNull();
  });

  it('lets the pointer move onto the help bubble to read it', () => {
    const link = document.querySelector('a')!;
    over(link);
    vi.advanceTimersByTime(HELP_DELAY_MS);
    link.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    over(tip()!);
    vi.advanceTimersByTime(200);
    expect(tip()).not.toBeNull();
    tip()!.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    vi.advanceTimersByTime(150);
    expect(tip()).toBeNull();
  });

  it('ignores touch and removes pending tips on cleanup', () => {
    document.querySelector('a')!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
    vi.advanceTimersByTime(HELP_DELAY_MS);
    expect(tip()).toBeNull();
    over(document.querySelector('a')!);
    cleanup();
    vi.advanceTimersByTime(HELP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it('explains fields without including sensitive values and escapes labels', () => {
    document.body.innerHTML = '<label for="password">Password</label><input id="password" type="password" value="secret" data-help="At least 8 characters.">';
    expect(helpFor(document.querySelector('input')!)).toEqual({ title: 'Password', description: 'At least 8 characters.' });
    const button = document.createElement('button');
    button.dataset.help = 'Does a thing.';
    button.textContent = '<img src=x onerror=alert(1)>';
    document.body.append(button);
    over(button);
    vi.advanceTimersByTime(HELP_DELAY_MS);
    expect(tip()).not.toBeNull();
    expect(tip()?.querySelector('img')).toBeNull();
  });

  it('never calls an enabled control unavailable, and says nothing generic', () => {
    document.body.innerHTML = '<button id="plain">Save</button><button id="off" disabled>Send</button><button id="why" disabled data-help-disabled="Pick a template first.">Send</button><button id="icon" aria-label="Close"><svg></svg></button><input id="field" placeholder="Name">';
    const el = (id: string) => document.getElementById(id) as HTMLElement;
    expect(helpFor(el('plain'))).toBeNull();
    expect(helpFor(el('field'))).toBeNull();
    expect(helpFor(el('off'))).toEqual({ title: 'Send', description: 'Not available right now.' });
    expect(helpFor(el('why'))?.description).toBe('Pick a template first.');
    expect(helpFor(el('icon'))).toEqual({ title: 'Close', description: '' });
    (el('off') as HTMLButtonElement).disabled = false;
    expect(helpFor(el('off'))).toBeNull();
  });

  it('takes the help down when its control switches on or off', async () => {
    document.body.innerHTML = '<button disabled data-help-disabled="Fill in the name first.">Save</button>';
    const button = document.querySelector('button')!;
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(HELP_DELAY_MS);
    expect(tip()?.textContent).toContain('Fill in the name first.');
    button.disabled = false;
    await Promise.resolve();
    expect(tip()).toBeNull();
  });
});
