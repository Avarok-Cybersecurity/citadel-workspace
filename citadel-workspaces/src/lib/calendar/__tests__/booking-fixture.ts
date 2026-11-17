/** Booking values for tests and harness scenarios: plain data, safe in Node and in a browser. */
import type { Availability } from '../generated/Availability';
import type { EventType } from '../generated/EventType';
import { NY } from './event-fixture';

export const INTRO: EventType = {
  id: 't1', name: 'Intro call', kind: 'one_on_one', durations_min: [30, 60], color: 'primary', locked: false, zone_lock: null,
  questions: [
    { id: 'q-topic', label: 'What should we cover?', kind: 'long_text', required: true },
    { id: 'q-format', label: 'Format', kind: { choice: { options: ['Video', 'Voice'] } }, required: false },
  ],
  rules: { buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 4 * 60, max_per_day: null, increment_min: 30, range: 'indefinite', cancel_policy: null },
};

const workday: { start_min: number; end_min: number; }[] = [{ start_min: 9 * 60, end_min: 12 * 60 }, { start_min: 13 * 60, end_min: 17 * 60 }];
export const WORKING_HOURS: Availability = { id: 'a1', name: 'Working hours', zone: NY, weekly: [workday, workday, workday, workday, workday, [], []], overrides: [] };
