/**
 * The loading pane every app shows: a sheet of paper where the document will be (never an empty
 * pane), a sentence in a live region that changes once per stage, and a bar that is measured only
 * when the stage has a fraction. No mocks.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppLoadingPane } from '../AppLoadingPane';

describe('the loading pane', () => {
  it('draws a page with lines on it, hidden from screen readers, under the indicator', () => {
    render(<AppLoadingPane appName="Citadel Docs" stage={{ kind: 'app' }} />);
    const sheet: HTMLElement = screen.getByTestId('app-loading-sheet');
    expect(sheet).toHaveAttribute('aria-hidden', 'true');
    expect(sheet.querySelectorAll('.animate-pulse').length).toBeGreaterThan(8);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Citadel Docs…');
  });

  it('is indeterminate while nothing is measured: no value, and the bar sweeps', () => {
    render(<AppLoadingPane appName="Citadel Docs" stage={{ kind: 'document' }} />);
    const bar: HTMLElement = screen.getByRole('progressbar', { name: 'Opening the document…' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar.firstElementChild).toHaveAttribute('data-indeterminate');
  });

  it('is measured during a download of known size, with the bytes as its value text', () => {
    render(<AppLoadingPane appName="Citadel Docs" stage={{ kind: 'engine', bytes: { loaded: 1024 * 1024, total: 4 * 1024 * 1024 } }} />);
    const bar: HTMLElement = screen.getByRole('progressbar', { name: 'Downloading the Citadel Docs engine…' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '1 MB of 4 MB');
    expect(bar.firstElementChild).not.toHaveAttribute('data-indeterminate');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%');
    // Shown to the eye; the progressbar already says it to a screen reader.
    expect(screen.getByTestId('app-loading-detail')).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces the stage, not the bytes: the live region holds only the sentence', () => {
    render(<AppLoadingPane appName="Citadel Docs" stage={{ kind: 'engine', bytes: { loaded: 10, total: 40 } }} />);
    const live: HTMLElement = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live.textContent).toBe('Downloading the Citadel Docs engine…');
  });
});
