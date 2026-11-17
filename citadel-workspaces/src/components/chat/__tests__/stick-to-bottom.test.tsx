/**
 * The chat follows the newest message for a reader at the bottom, and for a
 * reader who scrolled away it hangs a "N new messages -- View" notch on the
 * bottom edge instead of moving them.
 *
 * Real hook, real pill, real pure rules. jsdom has no layout, so the viewport's
 * geometry, `scrollTo` and ResizeObserver are stubbed on the element: those are
 * the browser facts the hook reads, and the only stand-ins here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, type RenderResult, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useRef, type RefObject } from 'react';
import { useStickToBottom, type StickToBottom } from '../use-stick-to-bottom';
import { NewMessagesPill } from '../NewMessagesPill';

interface Item { id: string }

let geometry: { scrollTop: number; scrollHeight: number; clientHeight: number };
let scrollTo: ReturnType<typeof vi.fn>;
let resizeCallbacks: Array<() => void>;

beforeEach(() => {
  geometry = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 };
  scrollTo = vi.fn();
  resizeCallbacks = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly cb: () => void) {}
    observe(): void { resizeCallbacks.push(this.cb); } // fires only for what was observed, as a real one does
    disconnect(): void {}
  });
});

function Harness({ items }: { items: Item[] }): JSX.Element {
  const ref: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const stick: StickToBottom = useStickToBottom(ref, items, 'Messages with Alice');
  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={(el) => {
          (ref as { current: HTMLDivElement | null }).current = el;
          if (!el) return;
          for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
            Object.defineProperty(el, key, { configurable: true, get: () => geometry[key], set: (v: number) => { geometry[key] = v; } });
          }
          el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
        }}
        data-testid="viewport"
      ><div /></div>
      <NewMessagesPill count={stick.unseen} onView={stick.reveal} />
    </div>
  );
}

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));
const scrollUserTo = (top: number): void => { geometry.scrollTop = top; fireEvent.scroll(screen.getByTestId('viewport')); };
const grow = (): void => { geometry.scrollHeight += 300; };

describe('a reader at the bottom', () => {
  it('is carried to a new message even though the message grew the list first', () => {
    const { rerender } = render(<Harness items={items('a', 'b')} />);
    scrollUserTo(600);
    scrollTo.mockClear();
    grow(); // the new message makes the distance 300px before the hook looks
    rerender(<Harness items={items('a', 'b', 'c')} />);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1300 }));
    expect(screen.queryByTestId('new-messages-pill')).toBeNull();
  });

  it('stays at the bottom when a late image resizes the content', () => {
    render(<Harness items={items('a', 'b')} />);
    scrollUserTo(600);
    scrollTo.mockClear();
    grow();
    act(() => resizeCallbacks.forEach((cb) => cb()));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1300 }));
  });
});

describe('a reader who scrolled up', () => {
  function scrolledUp(): RenderResult {
    const view: RenderResult = render(<Harness items={items('a', 'b')} />);
    scrollUserTo(100);
    scrollTo.mockClear();
    return view;
  }

  it('is not moved, and a notch counts what they have not seen', () => {
    const { rerender } = scrolledUp();
    rerender(<Harness items={items('a', 'b', 'c')} />);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-messages-pill').textContent).toContain('1 new message');
    expect(screen.getByTestId('new-messages-pill').textContent).not.toContain('messages');
    rerender(<Harness items={items('a', 'b', 'c', 'd')} />);
    expect(screen.getByTestId('new-messages-pill').textContent).toContain('2 new messages');
  });

  it('does not count an older page loading above them', () => {
    const { rerender } = scrolledUp();
    rerender(<Harness items={items('x', 'y', 'a', 'b')} />);
    expect(screen.queryByTestId('new-messages-pill')).toBeNull();
  });

  it('is taken to the newest by View, and the notch goes', async () => {
    const { rerender } = scrolledUp();
    rerender(<Harness items={items('a', 'b', 'c')} />);
    fireEvent.click(screen.getByRole('button', { name: /view/i }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }));
    await waitFor(() => expect(screen.queryByTestId('new-messages-pill')).toBeNull());
  });

  it('keeps keyboard focus in the message area when View unmounts, instead of dropping it to the page', async () => {
    const { rerender } = scrolledUp();
    rerender(<Harness items={items('a', 'b', 'c')} />);
    const view: HTMLElement = screen.getByRole('button', { name: /view/i });
    view.focus();
    fireEvent.click(view);
    await waitFor(() => expect(screen.queryByTestId('new-messages-pill')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('viewport'));
  });

  it('loses the notch on scrolling to the bottom by hand', async () => {
    const { rerender } = scrolledUp();
    rerender(<Harness items={items('a', 'b', 'c')} />);
    scrollUserTo(600);
    await waitFor(() => expect(screen.queryByTestId('new-messages-pill')).toBeNull());
  });
});

describe('the notch', () => {
  it('sits in a live region that exists before it does, and View is a real, 44px button', () => {
    const { rerender } = render(<Harness items={items('a', 'b')} />);
    const live: HTMLElement = screen.getByTestId('new-messages-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    scrollUserTo(100);
    rerender(<Harness items={items('a', 'b', 'c')} />);
    expect(live.contains(screen.getByTestId('new-messages-pill'))).toBe(true);
    const view: HTMLElement = screen.getByRole('button', { name: /view/i });
    expect(view.className).toContain('min-h-11');
    expect(view.className).toContain('min-w-11');
    expect(view.tabIndex).toBe(0);
  });

  it('makes the scrollable message area a keyboard-focusable, named region', () => {
    render(<Harness items={items('a')} />);
    const viewport: HTMLElement = screen.getByTestId('viewport');
    expect(viewport.tabIndex).toBe(0);
    expect(viewport.className).toContain('focus-visible:outline-2');
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe('Messages with Alice');
  });
});
