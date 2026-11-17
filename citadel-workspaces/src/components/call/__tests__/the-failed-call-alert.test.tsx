import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorPanel } from '@/components/call/CallStagePanels';

const UDP: string =
  'no UDP channel for peer 2181040939592097811 within 5s; it may still be negotiating ' +
  '(retry shortly), or the peer connection was established with UdpMode disabled';

describe('the alert a failed call renders', () => {
  it('does not read a CID out to a screen reader', () => {
    render(<ErrorPanel title="The call could not start" detail={UDP} />);
    const alert: HTMLElement = screen.getByRole('alert');
    expect(alert.textContent ?? '').not.toContain('2181040939592097811');
    expect(alert.textContent ?? '').not.toMatch(/UdpMode/i);
  });

  it('still carries the raw text for support', () => {
    render(<ErrorPanel title="The call could not start" detail={UDP} />);
    expect(screen.getByTestId('call-error').getAttribute('data-raw-reason')).toBe(UDP);
  });
});
