/**
 * Binding a first-party glue app's ports for one tab (design 2.4, 3.2): the glue analogue of
 * mount-steps.ts, with no worker and no canvas. It takes one of the page's instance slots, so a
 * glue tab counts against the same 8 as a worker's; binds the install's ports exactly as a worker's
 * are bound (host-ports.ts), with no zone ports since there is no canvas; adds the ports only a
 * first-party app is given, over what the page holds (nodes-port.ts, first-party-ports.ts); and
 * hands back a GlueInstance whose every call goes through `admits()`.
 *
 * The glue app's code ships in the UI bundle, so there is no release to fetch and verify: the
 * listing's manifest decides the surface and the limits, and the kernel re-checks every call.
 */
import type { GlueBound, GlueHandle, GlueTabMount } from '@/components/office/app-zone/app-zone-environment';
import type { DispatchClock } from '../host/dispatch';
import { glueInstance, type GlueInstance, type StorageChange } from '../host/glue-instance';
import { instanceLimits, type HostPolicy } from '../host/limits';
import type { InstanceSlots } from '../host/instance-slots';
import type { HostPorts } from '../host/ports';
import type { AppEvent } from '../sdk/generated/AppEvent';
import { badgedNotifyPort, rosterMembersPort } from './first-party-ports';
import { hostPortsFor, type BoundPorts, type PortWorld } from './host-ports';
import type { InstallPlaneRegistry } from './install-plane-registry';
import { treeNodesPort } from './nodes-port';
import { runsOn } from './placement';
import { onStorageChanged } from './storage-changed';
import { scopeKeyOf } from './zone-context';

export interface GlueDeps {
  readonly policy: HostPolicy;
  readonly slots: InstanceSlots;
  readonly clock: DispatchClock;
  readonly pageUrl: () => string;
  readonly newInstanceId: () => string;
  readonly portWorld: () => Promise<Omit<PortWorld, 'policy'>>;
  readonly report: (what: string, detail: unknown) => void;
}

const stopped = (why: string): GlueBound => ({ kind: 'stopped', why });

export function bindGlue(tab: GlueTabMount, deps: GlueDeps, planes: InstallPlaneRegistry): GlueHandle {
  const { install, manifest, firstParty } = tab;
  const name: string = manifest.name;
  const release: (() => void) | null = deps.slots.acquire();
  let closed: boolean = false;
  let bound: BoundPorts | null = null;
  let instance: GlueInstance | null = null;

  const bind = async (): Promise<GlueBound> => {
    if (release === null) return stopped(`This page is already running as many apps as it can, so ${name} was not started.`);
    if (!runsOn(manifest, 'tab')) return stopped(`${name} cannot run in a tab, so it was not started.`);
    const world: PortWorld = { ...(await deps.portWorld()), policy: deps.policy };
    const scopeKey: string = await scopeKeyOf(install.scope, world.sha256Hex);
    if (closed) return stopped(`${name} was closed before it started.`);
    bound = hostPortsFor(install, manifest.limits, deps.newInstanceId(), scopeKey, null, planes.attach(install.id, install.app_id), world);
    const ports: HostPorts = {
      ...bound.ports,
      nodes: treeNodesPort(install.scope, firstParty.tree),
      members: rosterMembersPort(firstParty.roster),
      notify: badgedNotifyPort({ id: manifest.id, name }, firstParty.notices),
    };
    const changes = (listener: (change: StorageChange) => void): (() => void) =>
      onStorageChanged(world.pushes, install.id, (event: AppEvent): void => {
        if (typeof event === 'object' && 'storage_changed' in event) listener(event.storage_changed);
      });
    instance = glueInstance({
      appId: install.app_id, ports, held: bound.held, policy: deps.policy, limits: instanceLimits(manifest.limits),
      clock: deps.clock, pageUrl: deps.pageUrl(), storageChanges: changes,
    });
    return { kind: 'bound', instance };
  };

  const ready: Promise<GlueBound> = bind().catch((error: unknown): GlueBound => {
    deps.report(`[apps] binding ${name}'s ports failed`, error);
    return stopped(`${name} could not be started.`);
  });

  return {
    ready,
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await ready;
      instance?.close();
      const held: BoundPorts | null = bound;
      try {
        if (held !== null) {
          await held.withdraw();
          await held.stop();
        }
      } catch (error: unknown) {
        deps.report(`[apps] closing ${name} failed`, error);
      } finally {
        release?.();
      }
    },
  };
}
