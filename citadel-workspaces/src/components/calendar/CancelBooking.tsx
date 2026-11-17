/**
 * Cancelling a booking from its event (design §3.6.1 step 5), or one of the reader's own events:
 * an optional reason and one button; who cancelled is recorded from the session, so the form never
 * asks. What happened is said
 * in the live region beside it.
 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CancelBookingProps {
  noun: 'booking' | 'event';
  /** Resolves null when cancelled, or the sentence that says what happened instead. */
  onCancel: (reason: string | null) => Promise<string | null>;
}

export function CancelBooking({ noun, onCancel }: CancelBookingProps): JSX.Element {
  const id: string = useId();
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [said, setSaid] = useState<string>('');
  const cancel = async (): Promise<void> => {
    setBusy(true);
    const failed: string | null = await onCancel(reason.trim() === '' ? null : reason.trim());
    setBusy(false);
    setSaid(failed ?? `The ${noun} is cancelled.`);
  };
  return (
    <div className="mt-2 flex min-w-0 flex-col gap-2" data-testid={`calendar-cancel-${noun}`}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">Reason (optional)</label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input id={id} className="h-[44px] min-w-0 flex-1" value={reason} onChange={(e): void => setReason(e.target.value)} />
        <Button type="button" variant="outline" className="h-[44px]" disabled={busy} onClick={(): void => { void cancel(); }}>{busy ? 'Cancelling…' : `Cancel ${noun}`}</Button>
      </div>
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </div>
  );
}
