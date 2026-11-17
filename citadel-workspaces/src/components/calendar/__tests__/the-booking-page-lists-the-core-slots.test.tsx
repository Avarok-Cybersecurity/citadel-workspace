/**
 * The booking page over the real core: the times it lists for a day are the core's slots for the
 * type's own rules, nothing inside the minimum notice; switching the zone regroups and relabels
 * them; a required question blocks the booking until it is answered; and a lost race shows the
 * host's alternatives and moves focus to them.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { INTRO, WORKING_HOURS } from '@/lib/calendar/__tests__/booking-fixture';
import { NY, realEngine, utc } from '@/lib/calendar/__tests__/engine-rig';
import type { BookingChoice, BookOutcome } from '@/lib/calendar/booking-form';
import type { HostBusy } from '@/lib/calendar/booking-pages';
import { formatDayLong, formatTimeIn } from '@/lib/calendar/format';
import type { Interval } from '@/lib/calendar/generated/Interval';
import { slotRequest } from '@/lib/calendar/slot-list';
import { hostSlots } from '@/lib/calendar/team-slots';
import { BookingPage } from '../BookingPage';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const TODAY: { y: number; m: number; d: number; } = { y: 2024, m: 7, d: 15 };
const NOW: bigint = utc('2024-07-15T13:30:00Z');
const BUSY: Interval = { start_ms: utc('2024-07-16T14:00:00Z'), end_ms: utc('2024-07-16T15:00:00Z') };
const busyFor = (): HostBusy => ({ busy: [BUSY], booked: [] });

function page(onBook: (c: BookingChoice) => Promise<BookOutcome>): void {
  render(
    <BookingPage hostName="ana" types={[INTRO]} closed={null} engine={engine} displayZone={NY} deviceZone={NY}
      today={TODAY} nowMs={NOW} slotsFor={(ask) => hostSlots(engine, ask, WORKING_HOURS, busyFor)} initialTypeId={null} onBook={onBook} />,
  );
}

const shownTimes = (): string[] => screen.getAllByTestId('calendar-slot').map((b) => b.textContent ?? '');
const coreTimes = (zone: string, day: number): string[] => engine.freeSlots(slotRequest({
  type: INTRO, durationMin: 30, availability: WORKING_HOURS, busy: [BUSY], booked: [], nowMs: NOW, from: TODAY, to: engine.addDays(TODAY, 13),
})).filter((s) => engine.civilOf(zone, s.start_ms).date.d === day).map((s) => formatTimeIn(s.start_ms, zone));

const pickDay = (d: number): void => {
  const name: RegExp = new RegExp(`^${formatDayLong({ y: 2024, m: 7, d })},`);
  fireEvent.click(within(screen.getByRole('group', { name: 'Days with free times' })).getByRole('button', { name }));
};

describe('the booking page', () => {
  it("lists the core's slots for the day, with nothing inside the minimum notice", () => {
    page(async () => ({ kind: 'failed', reason: 'unused' }));
    pickDay(15);
    expect(shownTimes()).toEqual(coreTimes(NY, 15));
    // Four hours' notice from 09:30 EDT: the first time offered today is 13:30.
    expect(shownTimes()[0]).toBe(formatTimeIn(utc('2024-07-15T17:30:00Z'), NY));
    pickDay(16);
    expect(shownTimes()).toEqual(coreTimes(NY, 16));
    expect(shownTimes()).not.toContain(formatTimeIn(BUSY.start_ms, NY));
  });

  it('regroups and relabels the times in the zone the invitee switches to', () => {
    page(async () => ({ kind: 'failed', reason: 'unused' }));
    fireEvent.change(screen.getByLabelText('Show times in'), { target: { value: 'Asia/Tokyo' } });
    pickDay(16);
    expect(shownTimes()).toEqual(coreTimes('Asia/Tokyo', 16));
    expect(screen.getAllByTestId('calendar-slot')[0]?.getAttribute('aria-label')).toMatch(/GMT\+9|JST/);
  });

  it('does not book until the required question is answered, then hands over the choice as seen', async () => {
    const onBook: Mock<(c: BookingChoice) => Promise<BookOutcome>> = vi.fn(async (c: BookingChoice): Promise<BookOutcome> => ({ kind: 'failed', reason: `kept ${c.answers.length}` }));
    page(onBook);
    pickDay(16);
    fireEvent.click(screen.getAllByTestId('calendar-slot')[0] as HTMLElement);
    await act(async () => { fireEvent.click(screen.getByTestId('calendar-confirm-booking')); });
    expect(onBook).not.toHaveBeenCalled();
    expect(screen.getByText('What should we cover? is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/What should we cover\?/), { target: { value: 'Roadmap' } });
    await act(async () => { fireEvent.click(screen.getByTestId('calendar-confirm-booking')); });
    expect(onBook).toHaveBeenCalledTimes(1);
    const choice: BookingChoice = onBook.mock.calls[0]?.[0] as BookingChoice;
    expect([choice.type.id, choice.durationMin, choice.zone, choice.answers]).toEqual(['t1', 30, NY, [{ question_id: 'q-topic', value: 'Roadmap' }]]);
    expect(choice.slot.start_ms).toBe(utc('2024-07-16T13:00:00Z'));
    expect(screen.getByTestId('calendar-booking-said')).toHaveTextContent('Not booked: kept 1.');
  });

  it('shows the alternatives after a lost race', async () => {
    const alternative: Interval = { start_ms: utc('2024-07-17T15:00:00Z'), end_ms: utc('2024-07-17T15:30:00Z') };
    page(async () => ({ kind: 'taken', alternatives: [alternative] }));
    pickDay(16);
    fireEvent.click(screen.getAllByTestId('calendar-slot')[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText(/What should we cover\?/), { target: { value: 'Roadmap' } });
    await act(async () => { fireEvent.click(screen.getByTestId('calendar-confirm-booking')); });
    expect(screen.getByTestId('calendar-booking-said')).toHaveTextContent('That time was just taken. ana offers 1 other times.');
    expect(within(screen.getByRole('group', { name: 'Other times ana offers' })).getAllByRole('button')).toHaveLength(1);
  });
});
