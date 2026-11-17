/**
 * "Page N of M" lives in a store only the status bar subscribes to: a change re-renders the
 * bar, the same page again notifies nobody, and nothing else has to re-render for a scroll.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { pageStatusStore, type PageStatusStore } from '../page-status';
import { DocsStatusBar } from '../DocsStatusBar';

describe('the page status store', () => {
  it('tells its subscribers when the page changes, and not when it is the same page again', () => {
    const store: PageStatusStore = pageStatusStore();
    let told: number = 0;
    store.subscribe((): void => { told++; });
    store.set({ current: 1, total: 9 });
    store.set({ current: 1, total: 9 });
    store.set({ current: 2, total: 9 });
    expect(told).toBe(2);
    expect(store.get()).toEqual({ current: 2, total: 9 });
  });

  it('is what the status bar shows', () => {
    const store: PageStatusStore = pageStatusStore();
    render(<DocsStatusBar status={store} notice={null} zoom={1} onZoomChange={(): void => undefined} />);
    expect(screen.getByTestId('docs-page-status')).toHaveTextContent('Opening…');
    act(() => store.set({ current: 3, total: 40 }));
    expect(screen.getByTestId('docs-page-status')).toHaveTextContent('Page 3 of 40');
  });
});
