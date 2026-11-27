/**
 * The window's recovery ports, registered by RecoveryPortsProvider once the router exists. One
 * place both renderers read: the notice component and the toast adapter, which lib code calls
 * from outside React. Unregistered is a wiring bug, so running a control then fails loudly.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { AskOutcome, RecoveryPorts } from './ports';

export const recoveryPortsStore: ValueStore<RecoveryPorts | null> = createValueStore<RecoveryPorts | null>('recovery-ports', null);

export function currentPorts(): RecoveryPorts {
  const ports: RecoveryPorts | null = recoveryPortsStore.get();
  if (ports === null) throw new Error('recovery ports are not registered: RecoveryPortsProvider is not mounted');
  return ports;
}

/**
 * Ports that defer to whatever is registered when a control runs, so a toast raised before the
 * provider mounted still works once it has.
 */
export const lateBoundPorts: RecoveryPorts = {
  reload: (): void => currentPorts().reload(),
  applyUpdate: (): void => currentPorts().applyUpdate(),
  openSettings: (tab): void => currentPorts().openSettings(tab),
  navigate: (to): void => currentPorts().navigate(to),
  signIn: (account): void => currentPorts().signIn(account),
  installAgent: (reason): void => currentPorts().installAgent(reason),
  requestPermission: (permission): void => currentPorts().requestPermission(permission),
  askAdmins: (request, about): Promise<AskOutcome> => currentPorts().askAdmins(request, about),
  openChat: (member, draft): void => currentPorts().openChat(member, draft),
  reportBug: (surface): void => currentPorts().reportBug(surface),
};
