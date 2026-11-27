/**
 * The recovery ports replaced by a recorder. Justified: the ports are the module's whole I/O edge
 * (reload, navigation, the wire); the tests check which one a control reaches and with what.
 */
import type { AskOutcome, RecoveryPorts } from '../ports';

export interface PortCall { readonly port: keyof RecoveryPorts; readonly args: readonly unknown[] }

export function recordingPorts(ask: AskOutcome): { ports: RecoveryPorts; calls: PortCall[] } {
  const calls: PortCall[] = [];
  const note = (port: keyof RecoveryPorts) => (...args: unknown[]): void => { calls.push({ port, args }); };
  const ports: RecoveryPorts = {
    reload: note('reload'),
    applyUpdate: note('applyUpdate'),
    openSettings: note('openSettings'),
    navigate: note('navigate'),
    signIn: note('signIn'),
    installAgent: note('installAgent'),
    requestPermission: note('requestPermission'),
    askAdmins: async (...args: unknown[]): Promise<AskOutcome> => { calls.push({ port: 'askAdmins', args }); return ask; },
    openChat: note('openChat'),
    reportBug: note('reportBug'),
  };
  return { ports, calls };
}
