/**
 * A test's `instanceManager`: the real one with only the named members replaced.
 *
 * Tests mocked it as a bare object (`{ cid: 42n }`). The instance channel's leader
 * election runs on a timer from module load and calls `setLeader` on whatever
 * `instanceManager` is -- so on a slow CI run the timer fired mid-file and threw
 * "instanceManager.setLeader is not a function" as an unhandled error. The double
 * keeps every real member, and its overrides are typed against the real class, so
 * a renamed or retyped member fails to compile instead of silently diverging.
 */
import type { InstanceManager } from '@/lib/multi-instance/instance-manager';

export type InstanceManagerOverrides = { [K in keyof InstanceManager]?: InstanceManager[K] };

export function instanceManagerWith(real: InstanceManager, overrides: InstanceManagerOverrides): InstanceManager {
  return Object.create(real, Object.getOwnPropertyDescriptors(overrides)) as InstanceManager;
}
