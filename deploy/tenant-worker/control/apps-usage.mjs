/**
 * The node's app usage host (server-wasm usage.rs `UsageHost`): the kernel reports each metered
 * use of an app by kind (kernel::apps::usage_meter `Usage`), and `add(kind, bytes)` counts it
 * into `meter()`, the object's current meter, rolled to the period it falls in. An increment in
 * memory only: it persists with the rest of the period's totals (worker.mjs flush) and reaches
 * D1 through the monitor's sample, never per use.
 */

/** Each `Usage` kind, and the meter method that counts it. */
export const APP_USAGE_KINDS = Object.freeze({
  EgressIn: (meter, bytes) => meter.appEgress(bytes),
  RelayIhttp: (meter, bytes) => meter.appRelay(bytes),
});

export class AppsUsageIntake {
  constructor(meter) {
    this.meter = meter;
  }

  add(kind, bytes) {
    if (!Object.hasOwn(APP_USAGE_KINDS, kind)) throw new Error(`no app usage kind ${JSON.stringify(kind)}`);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`app usage is a byte count (${JSON.stringify(bytes)})`);
    APP_USAGE_KINDS[kind](this.meter(), bytes);
  }
}
