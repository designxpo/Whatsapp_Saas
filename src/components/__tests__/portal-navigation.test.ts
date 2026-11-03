// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalNavigation } from '@/app/admin/_components/PortalNavigation';
import { SegmentedControl } from '../SegmentedControl';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const groups = [
  { group: 'Daily work', items: [{ key: 'home' as const, label: 'Home', hint: 'Overview', icon: null }] },
  { group: 'Channels', items: [{ key: 'reviews' as const, label: 'Google Reviews', hint: 'Manage reviews', icon: null }] },
];
describe('portal navigation', () => {
  it('opens the active group and keeps other groups expandable', () => {
    const navigate = vi.fn();
    act(() => root.render(React.createElement(PortalNavigation, { groups, activeTab: 'home', waiting: 0, onNavigate: navigate, onWarm: vi.fn() })));
    const channels = [...container.querySelectorAll('button')].find(b => b.textContent === 'Channels')!;
    expect(channels.getAttribute('aria-expanded')).toBe('false');
    act(() => channels.click());
    expect(channels.getAttribute('aria-expanded')).toBe('true');
    act(() => container.querySelector<HTMLButtonElement>('[data-nav-key="reviews"]')!.click());
    expect(navigate).toHaveBeenCalledWith('reviews');
  });
  it('searches collapsed groups and clears a search with Escape', () => {
    act(() => root.render(React.createElement(PortalNavigation, { groups, activeTab: 'home', waiting: 0, onNavigate: vi.fn(), onWarm: vi.fn() })));
    const input = container.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Google');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-nav-key="home"]')).toBeNull();
    expect(container.querySelector('[data-nav-key="reviews"]')!.closest('[hidden]')).toBeNull();
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(input.value).toBe('');
    expect(container.querySelector('[data-nav-key="home"]')).not.toBeNull();
  });
});
it('supports arrow, Home and End keys on shared segmented controls', () => {
  const change = vi.fn();
  act(() => root.render(React.createElement(SegmentedControl, { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], value: 'a', onChange: change })));
  const buttons = container.querySelectorAll('button');
  act(() => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(change).toHaveBeenLastCalledWith('c'); expect(document.activeElement).toBe(buttons[2]);
  act(() => buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(change).toHaveBeenLastCalledWith('a'); expect(document.activeElement).toBe(buttons[0]);
  expect(buttons[1].tabIndex).toBe(-1);
});
