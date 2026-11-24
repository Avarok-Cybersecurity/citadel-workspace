/**
 * Ctrl/Cmd+B folds the sidebar, but never while someone is typing.
 *
 * Measured live: in a document, Ctrl+B bolded the selection AND collapsed the
 * sidebar. The canvas editor's hidden textarea handled the key (preventDefault),
 * and the sidebar's window listener checked neither that nor where the key began.
 *
 * Real: SidebarProvider and its window listener; keys are dispatched on real
 * elements and bubble to the window as a browser's would. Nothing is mocked.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';

function State(): JSX.Element {
  return <output data-testid="sidebar-state">{useSidebar().state}</output>;
}

beforeEach((): void => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }); });

/** Ctrl+B on `target`, bubbling and cancelable as a real keydown; answers whether the sidebar is still expanded. */
function pressCtrlB(target: EventTarget, handledFirst: boolean = false): boolean {
  const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true, composed: true });
  if (handledFirst) event.preventDefault();
  act((): void => { target.dispatchEvent(event); });
  return screen.getByTestId('sidebar-state').textContent === 'expanded';
}

function mount(surface: JSX.Element | null = null): void {
  render(<SidebarProvider><State />{surface}</SidebarProvider>);
}

describe('the sidebar shortcut', () => {
  it('folds the sidebar from the page itself (the positive control)', () => {
    mount();
    expect(pressCtrlB(document.body)).toBe(false);
  });

  it('works with Cmd on a Mac too', () => {
    mount();
    act((): void => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true })); });
    expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed');
  });

  it.each([
    ['an input', <input key="s" data-testid="surface" />],
    ['a textarea (the docs editor takes keys through one)', <textarea key="s" data-testid="surface" />],
    ['a select', <select key="s" data-testid="surface"><option>a</option></select>],
    ['a contenteditable', <div key="s" contentEditable suppressContentEditableWarning data-testid="surface">text</div>],
    ['a child of a contenteditable', <div key="s" contentEditable suppressContentEditableWarning><p><b data-testid="surface">deep</b></p></div>],
    ['an ARIA textbox', <div key="s" role="textbox" tabIndex={0} data-testid="surface" />],
  ])('leaves the key to %s', (_name: string, surface: JSX.Element) => {
    mount(surface);
    expect(pressCtrlB(screen.getByTestId('surface'))).toBe(true);
  });

  it('still answers inside contenteditable="false" on the page', () => {
    mount(<div contentEditable suppressContentEditableWarning><span contentEditable={false} data-testid="surface">chip</span></div>);
    expect(pressCtrlB(screen.getByTestId('surface'))).toBe(false);
  });

  it('leaves the key to an editor inside a shadow root', () => {
    mount(<div data-testid="host" />);
    const host: HTMLElement = screen.getByTestId('host');
    const editor: HTMLTextAreaElement = document.createElement('textarea');
    host.attachShadow({ mode: 'open' }).appendChild(editor);
    expect(pressCtrlB(editor)).toBe(true);
  });

  it('leaves a key that something already handled', () => {
    mount(<button type="button" data-testid="surface">a button</button>);
    expect(pressCtrlB(screen.getByTestId('surface'), true)).toBe(true);
  });

  it('answers from a plain button, which takes no text', () => {
    mount(<button type="button" data-testid="surface">a button</button>);
    expect(pressCtrlB(screen.getByTestId('surface'))).toBe(false);
  });
});
