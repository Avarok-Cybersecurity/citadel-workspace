/**
 * The title bar's save status as people meet it: typing with AutoSave on leaves the quiet cloud
 * alone (nothing flickers, nothing is announced), a save that takes long says "Saving…" for at
 * least its minimum, and offline, refused and unsaved-here show at once, in words, and stay.
 * The production control and indicator; a stepped clock (ManualClock) stands in for time.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ManualClock } from '@/lib/cdoc/collab/__tests__/doubles/manual-clock';
import type { SaveInputs } from '@/lib/document-save/save-status';
import { SAVE_INDICATOR_TIMING } from '@/lib/document-save/save-indicator-timing';
import { DocumentSaveControls } from '../DocumentSaveControls';
import { saveControl, type BindableSaveControl } from '../save-control';

const AT_REST: SaveInputs = { autoSave: true, link: 'up', unacknowledged: 0, syncRequested: false, local: 'written', halted: false, locked: false };
const SENDING: SaveInputs = { ...AT_REST, unacknowledged: 1 };

function mount(): { readonly control: BindableSaveControl; readonly clock: ManualClock } {
  const control: BindableSaveControl = saveControl('doc');
  const clock: ManualClock = new ManualClock();
  act((): void => control.inputs.set(AT_REST));
  render(<DocumentSaveControls control={control} clock={clock} timing={SAVE_INDICATOR_TIMING} />);
  return { control, clock };
}

const indicator = (): HTMLElement => screen.getByTestId('docs-save-status');
const shown = (): string | null => indicator().getAttribute('data-status');
const label = (): HTMLElement => screen.getByTestId('docs-save-status-label');

describe('the save status while typing', () => {
  it('stays the quiet cloud through every keystroke\'s save, saying the same thing throughout', () => {
    const { control, clock } = mount();
    const spoken: string | null = screen.getByTestId('docs-save-announcer').textContent;
    for (let key: number = 0; key < 30; key += 1) {
      act((): void => control.inputs.set({ ...SENDING, local: 'writing' }));
      expect(shown()).toBe('saved');
      act((): void => control.inputs.set(SENDING));
      act((): void => clock.advance(150));
      act((): void => control.inputs.set(AT_REST));
      expect(shown()).toBe('saved');
      expect(screen.getByTestId('docs-save-announcer').textContent).toBe(spoken);
    }
    // The words are there for a screen reader and on hover, not drawn beside the cloud.
    expect(label()).toHaveClass('sr-only');
    expect(label()).toHaveTextContent('All changes saved');
  });

  it('says "Saving…" once a save has taken 1.5 s, and keeps it at least a second', () => {
    const { control, clock } = mount();
    act((): void => control.inputs.set(SENDING));
    act((): void => clock.advance(1499));
    expect(shown()).toBe('saved');
    act((): void => clock.advance(1));
    expect(shown()).toBe('saving');
    expect(label()).toHaveTextContent('Saving…');
    act((): void => control.inputs.set(AT_REST));
    expect(shown()).toBe('saving');
    act((): void => clock.advance(999));
    expect(shown()).toBe('saving');
    act((): void => clock.advance(1));
    expect(shown()).toBe('saved');
  });

  it('shows offline at once, in words, with what it means, and keeps it until the link is back', () => {
    const { control, clock } = mount();
    act((): void => control.inputs.set({ ...SENDING, link: 'down' }));
    expect(shown()).toBe('offline');
    expect(label()).not.toHaveClass('sr-only');
    expect(label()).toHaveTextContent('Offline');
    expect(screen.getByTestId('docs-save-announcer')).toHaveTextContent('Offline. Changes are kept on this device and will sync when you\'re back online.');
    act((): void => clock.advance(60_000));
    expect(shown()).toBe('offline');
  });

  it('names a refusal and an unkept edit plainly, and offers Try again only where it can help', () => {
    const { control } = mount();
    act((): void => control.inputs.set({ ...SENDING, halted: true }));
    expect(shown()).toBe('refused');
    expect(label()).toHaveTextContent('Not saved');
    expect(screen.queryByTestId('docs-save-retry')).toBeNull();
    act((): void => control.inputs.set({ ...SENDING, local: 'unavailable' }));
    expect(shown()).toBe('unsavedOnDevice');
    expect(screen.queryByTestId('docs-save-retry')).toBeNull();
    act((): void => control.inputs.set({ ...SENDING, local: 'failed' }));
    expect(label()).toHaveTextContent('Not saved to this device');
    expect(screen.getByTestId('docs-save-retry')).toHaveTextContent('Try again');
  });

  it('is a button named by its state, which shows what the state means on a tap', async () => {
    mount();
    expect(screen.getByRole('button', { name: 'All changes saved' })).toBe(indicator());
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    act((): void => { fireEvent.click(indicator()); });
    expect((await screen.findAllByText('Every change you have made is saved.')).length).toBeGreaterThan(0);
  });
});
