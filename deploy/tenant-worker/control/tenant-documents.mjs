/**
 * Document appends, counted per billing period on the object's meter (control/meter.mjs) and
 * persisted with its other totals (usage-table.mjs). The Citadel Docs kernel (server-wasm's
 * TenantServer, branch feat/citadel-docs-r1) is given `host()` and calls `appended(n)` for every
 * append it stores, and asks `writable()` before storing one. Pure but for the callbacks.
 */
export class TenantDocuments {
  /**
   * `meter()`: the object's current meter, rolled onto the period `nowMs` falls in by `roll(nowMs)`
   * first; `writable()`: whether documents take appends now (the object decides).
   */
  constructor({ meter, roll, writable, nowMs }) {
    this.meter = meter;
    this.roll = roll;
    this.writable = writable;
    this.nowMs = nowMs;
  }

  /** `n` appends were stored. */
  appended(n) {
    this.roll(this.nowMs());
    this.meter().appended(n);
  }

  /** What the kernel is given. */
  host() {
    return Object.freeze({ appended: (n) => this.appended(n), writable: () => this.writable() });
  }
}

/** The recent periods `usage()` reports, each with the appends its plan includes. */
export const withAppendsIncluded = (periods, included) => {
  if (!Number.isInteger(included) || included < 0) throw new Error("document_appends_included is a non-negative integer");
  return periods.map((p) => ({ ...p, document_appends_included: included }));
};
