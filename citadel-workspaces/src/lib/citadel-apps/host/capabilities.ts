/**
 * The capabilities a manifest can declare and an install can grant, and the group each opens,
 * read from the generated SSOT (`Capability`, `CAPABILITY_GROUP`, `INTRINSIC_CAPABILITIES`).
 */
import type { AbiGroup } from './abi';
import { CAPABILITY_GROUP, INTRINSIC_CAPABILITIES as INTRINSIC_LIST } from '../sdk/generated/AbiConstants';
import type { Capability } from '../sdk/generated/Capability';

export type { Capability };
export { CAPABILITY_GROUP };

export const CAPABILITIES: readonly Capability[] = Object.keys(CAPABILITY_GROUP) as Capability[];

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && Object.hasOwn(CAPABILITY_GROUP, value);
}

/** Every install holds these: they reach nothing outside the app's own surface. */
export const INTRINSIC_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(INTRINSIC_LIST);

/** The groups a manifest's declared capabilities (plus the intrinsic ones) may import. */
export function declaredGroups(declared: ReadonlySet<Capability>): ReadonlySet<AbiGroup> {
  const groups: Set<AbiGroup> = new Set<AbiGroup>();
  for (const cap of INTRINSIC_CAPABILITIES) groups.add(CAPABILITY_GROUP[cap]);
  for (const cap of declared) groups.add(CAPABILITY_GROUP[cap]);
  return groups;
}

/** The capabilities in force: what the install granted plus the intrinsic ones. */
export function effectiveGrant(granted: ReadonlySet<Capability>): ReadonlySet<Capability> {
  return new Set<Capability>([...INTRINSIC_CAPABILITIES, ...granted]);
}
