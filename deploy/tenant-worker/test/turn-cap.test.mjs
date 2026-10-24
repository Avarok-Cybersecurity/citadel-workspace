/**
 * The per-member hourly TURN ceiling (control/turn-cap.mjs): reports are counted until a member's
 * hour would pass it, refused whole and recorded past it, and each member and each hour is its own.
 */
import { describe, expect, it, vi } from "vitest";
import { Meter } from "../control/meter.mjs";
import { admitTurn, TURN_BYTES_PER_MEMBER_HOUR, TurnIntake } from "../control/turn-cap.mjs";
import tiers from "../../../billing/tiers.json";

const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000 * HOUR; // the start of a clock hour
const CAP = 1000;

describe("admitTurn", () => {
  it("admits up to the ceiling exactly and refuses one byte past it, typed", () => {
    const at = admitTurn(null, CAP, T0, CAP);
    expect(at).toEqual({ admitted: true, window: { hour: T0 / HOUR, counted: CAP } });
    const past = admitTurn(at.window, 1, T0 + 5, CAP);
    expect(past.admitted).toBe(false);
    expect(past.refusal).toEqual({ MemberHourlyCap: { cap_bytes: CAP, counted_bytes: CAP, claimed_bytes: 1 } });
    expect(past.window).toEqual(at.window);
  });

  it("refuses a single report over the ceiling whole, counting none of it", () => {
    const over = admitTurn({ hour: T0 / HOUR, counted: 400 }, 601, T0, CAP);
    expect(over.admitted).toBe(false);
    expect(over.window.counted).toBe(400);
  });

  it("starts each clock hour from nothing", () => {
    const full = { hour: T0 / HOUR, counted: CAP };
    expect(admitTurn(full, CAP, T0 + HOUR, CAP)).toMatchObject({ admitted: true, window: { counted: CAP } });
  });

  it("refuses a claim that is not a byte count", () => {
    for (const bad of [-1, 0.5, Number.NaN, "9"]) expect(() => admitTurn(null, bad, T0, CAP)).toThrow(/TURN usage/);
  });
});

describe("TurnIntake", () => {
  it("meters what it admits, records what it refuses, and holds each member to their own hour", () => {
    const meter = new Meter({ start: 0, end: 1e12, fallback: false }, null, T0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const intake = new TurnIntake(() => meter, () => T0, CAP);
    expect(intake.record("alice", 900)).toBeNull();
    expect(JSON.parse(intake.record("alice", 200))).toEqual({ MemberHourlyCap: { cap_bytes: CAP, counted_bytes: 900, claimed_bytes: 200 } });
    expect(intake.record("bob", 1000)).toBeNull();
    expect(meter.snapshot(T0)).toMatchObject({ turn_bytes: 1900, turn_refused_bytes: 200 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("member alice"));
    warn.mockRestore();
  });

  it("takes its ceiling from tiers.json", () => {
    expect(TURN_BYTES_PER_MEMBER_HOUR).toBe(tiers.paths.turn_gb_per_member_hour * tiers.metering.gb_bytes);
  });
});
