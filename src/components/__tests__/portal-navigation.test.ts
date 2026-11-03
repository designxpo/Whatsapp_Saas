// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '../SegmentedControl';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
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
