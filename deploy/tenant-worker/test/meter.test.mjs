/** The metering arithmetic (control/meter.mjs) and the overage rule (control/monitor.mjs): pure. */
import { describe, expect, it } from "vitest";
import { calendarMonth, Meter, periodAt } from "../control/meter.mjs";
import { overageGb } from "../control/monitor.mjs";

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0); // ms
const S0 = T0 / 1000;
const period = { start: S0 - 3600, end: S0 + 3600 };

describe("periods", () => {
  it("without a Stripe period, the UTC calendar month", () => {
    expect(calendarMonth(T0)).toEqual({ start: Date.UTC(2026, 8, 1) / 1000, end: Date.UTC(2026, 9, 1) / 1000 });
    expect(calendarMonth(Date.UTC(2026, 11, 31, 23, 59))).toEqual({ start: Date.UTC(2026, 11, 1) / 1000, end: Date.UTC(2027, 0, 1) / 1000 });
    expect(periodAt({ period_start: null, period_end: null }, T0)).toEqual(calendarMonth(T0));
    expect(periodAt(null, T0)).toEqual(calendarMonth(T0));
  });
  it("the Stripe period while it lasts, then rolled on by its own length", () => {
    const e = { period_start: S0 - 100, period_end: S0 + 100 };
    expect(periodAt(e, T0)).toEqual({ start: S0 - 100, end: S0 + 100 });
    expect(periodAt(e, (S0 + 100) * 1000)).toEqual({ start: S0 + 100, end: S0 + 300 });
    expect(periodAt(e, (S0 + 650) * 1000)).toEqual({ start: S0 + 500, end: S0 + 700 });
  });
});

describe("meter", () => {
  it("counts bytes and frames per connection and for the tenant", () => {
    const m = new Meter(period, null, T0);
    m.connect(1, T0);
    m.connect(2, T0);
    m.inbound(1, 100);
    m.inbound(1, 50);
    m.inbound(2, 7);
    m.outbound(2, 1000);
    m.inbound(99, 1_000_000); // not open: not counted
    expect(m.connections().map((c) => [c.n, c.frames, c.bytes_in, c.bytes_out])).toEqual([[1, 2, 150, 0], [2, 1, 7, 1000]]);
    expect(m.snapshot(T0)).toMatchObject({ bytes_in: 157, bytes_out: 1000, frames_in: 3, connections: 2 });
  });

  it("counts active seconds only while a socket is open, and the peak of open sockets", () => {
    const m = new Meter(period, null, T0);
    m.connect(1, T0 + 1000);
    m.connect(2, T0 + 2000);
    expect(m.disconnect(1, T0 + 5000)).toMatchObject({ n: 1, open_ms: 4000 });
    expect(m.disconnect(1, T0 + 6000)).toBeNull();
    m.disconnect(2, T0 + 11_000);
    // Idle from 11 s to 20 s: not active.
    m.connect(3, T0 + 20_000);
    expect(m.snapshot(T0 + 22_500)).toMatchObject({ active_seconds: 12, peak_connections: 2, connections: 1 });
    expect(m.admits(2)).toBe(true);
    m.connect(4, T0 + 23_000);
    expect(m.admits(2)).toBe(false);
  });

  it("resumes the totals an earlier instance persisted for the same period", () => {
    const saved = { period_start: period.start, bytes_in: 10, bytes_out: 20, frames_in: 3, active_seconds: 40, peak_connections: 5 };
    const m = new Meter(period, saved, T0);
    m.connect(1, T0);
    m.inbound(1, 5);
    expect(m.snapshot(T0 + 2000)).toMatchObject({ bytes_in: 15, bytes_out: 20, frames_in: 4, active_seconds: 42, peak_connections: 5 });
  });
});

describe("rollover", () => {
  it("a later period closes this one, and counting restarts from the sockets still open", () => {
    const m = new Meter(period, null, T0);
    m.connect(1, T0);
    m.inbound(1, 500);
    const next = { start: period.end, end: period.end + 7200 };
    const closed = m.adopt(next, T0 + 10_000);
    expect(closed).toMatchObject({ period_start: period.start, period_end: period.end, bytes_in: 500, active_seconds: 10 });
    expect(m.snapshot(T0 + 10_000)).toMatchObject({ period_start: next.start, bytes_in: 0, active_seconds: 0, peak_connections: 1 });
    m.inbound(1, 3);
    // The same period again (a repeated alarm, a repeated setEntitlements) resets nothing.
    expect(m.adopt(next, T0 + 11_000)).toBeNull();
    expect(m.snapshot(T0 + 11_000)).toMatchObject({ bytes_in: 3, active_seconds: 1 });
  });

  it("the same period with a corrected end is adopted in place; an earlier one is ignored", () => {
    const m = new Meter(period, null, T0);
    m.connect(1, T0);
    m.inbound(1, 9);
    expect(m.adopt({ start: period.start, end: period.end + 60 }, T0)).toBeNull();
    expect(m.adopt({ start: period.start - 7200, end: period.start }, T0)).toBeNull();
    expect(m.snapshot(T0)).toMatchObject({ period_start: period.start, period_end: period.end + 60, bytes_in: 9 });
  });
});

describe("overage", () => {
  it("is whole GB beyond what the tier includes, never negative", () => {
    expect(overageGb(0, 50)).toBe(0);
    expect(overageGb(50e9, 50)).toBe(0);
    expect(overageGb(50.999e9, 50)).toBe(0);
    expect(overageGb(51e9, 50)).toBe(1);
    expect(overageGb(152.5e9, 150)).toBe(2);
    expect(overageGb(3e9, 5)).toBe(0);
  });
});
