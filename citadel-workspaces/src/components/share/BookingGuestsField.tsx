/**
 * Booking guests on a secure link: accounts outside the workspace that may open one booking page,
 * book on it, and nothing else. The creator says how many (1 to MAX_BOOKING_GUESTS); the server
 * takes the access back when the link is deleted or expires.
 */
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { MAX_BOOKING_GUESTS, isGuestCount, type GrantDraft } from '@/lib/share/grant-draft';

export const GUEST_COPY: { add: string; count: string; detail: string; invalid: string } = {
  add: 'Guests from outside the workspace',
  count: 'How many guests it lets in',
  detail: 'Each guest can see and book on this page only. They lose that when the link is deleted or expires.',
  invalid: `Enter a whole number from 1 to ${MAX_BOOKING_GUESTS}.`,
};

interface BookingGuestsFieldProps {
  draft: GrantDraft;
  onChange: (draft: GrantDraft) => void;
  disabled: boolean;
}

/** Rendered only while the draft has booking guests chosen. */
export function BookingGuestsField({ draft, onChange, disabled }: BookingGuestsFieldProps): JSX.Element | null {
  const inputId: string = useId();
  const booking: GrantDraft['booking'] = draft.booking;
  if (booking === null) return null;
  const count: number | null = booking.maxGuests;
  const invalid: boolean = count !== null && !isGuestCount(count);
  const read = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw));
  return (
    <div className="min-w-0 space-y-1" data-testid="share-booking-guests">
      <label htmlFor={inputId} className="text-sm font-medium">{GUEST_COPY.count}</label>
      <Input
        id={inputId} type="number" inputMode="numeric" min={1} max={MAX_BOOKING_GUESTS} step={1}
        className="h-[44px] w-28" disabled={disabled} value={count === null ? '' : String(count)}
        aria-invalid={invalid} aria-describedby={`${inputId}-detail`}
        onChange={(e: React.ChangeEvent<HTMLInputElement>): void => onChange({ ...draft, booking: { ...booking, maxGuests: read(e.currentTarget.value) } })}
        data-testid="share-booking-guest-count"
      />
      <p id={`${inputId}-detail`} className={`text-xs ${invalid ? 'text-destructive-emphasis' : 'text-muted-foreground'}`}>
        {invalid ? GUEST_COPY.invalid : GUEST_COPY.detail}
      </p>
    </div>
  );
}
