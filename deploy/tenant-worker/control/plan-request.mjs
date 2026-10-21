/**
 * The paid half of a plan in a request -- interval, seats, add-on quantities -- checked field by
 * field, for creation (control/tenants.mjs) and a coupon preview (control/coupons.mjs) alike.
 */
import { ADDONS, intervalsOf, maxSeats } from "./plans.mjs";
import { refuse } from "./http.mjs";

export const isCount = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export const malformed = (detail) => ({ error: refuse("malformed-request", detail, 400) });

/** `{fields: {interval, seats, ...quantities}}` for a paid `body.tier`, or `{error: Response}`. */
export function readPaidPlan(body) {
  if (!intervalsOf(body.tier).includes(body.interval)) return malformed(`interval is one of ${intervalsOf(body.tier).join(", ")}`);
  if (!isCount(body.seats, 1, maxSeats(body.tier))) return malformed(`seats is an integer from 1 to ${maxSeats(body.tier)}`);
  const quantities = {};
  for (const a of ADDONS) {
    // Leaving an add-on out of the request is buying none of it.
    const n = body[a.quantityField] ?? 0;
    if (!isCount(n, 0, a.max)) return malformed(`${a.quantityField} is an integer from 0 to ${a.max}`);
    if (n > 0 && !a.offeredOn(body.tier)) return malformed(`${a.id} is not sold on ${body.tier}`);
    quantities[a.quantityField] = n;
  }
  return { fields: { interval: body.interval, seats: body.seats, ...quantities } };
}
