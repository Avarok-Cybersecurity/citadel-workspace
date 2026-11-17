/**
 * A test's session singleton (`connectionManager`, `eventEmitter`, a store): the
 * real one with only the named members replaced.
 *
 * A bare object (`{ getConnectionInfo }`) leaves every other member undefined, and the
 * production code that runs around the test -- a poll, a startup sequence, a listener --
 * calls them from timers and promise chains: "x is not a function", logged or thrown
 * long after the assertion that caused it. The double keeps every real member, and its
 * overrides are typed against the real class, so a renamed or retyped member fails to
 * compile instead of silently diverging. (Same approach as instance-manager-double.)
 */
export type Overrides<T extends object> = { [K in keyof T]?: T[K] };

export function doubleOf<T extends object>(real: T, overrides: Overrides<T>): T {
  return Object.create(real, Object.getOwnPropertyDescriptors(overrides)) as T;
}
