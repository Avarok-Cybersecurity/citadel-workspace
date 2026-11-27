/**
 * Registers this window's recovery ports (ports-store.ts) and hosts the bug reporter. Mounted
 * once, inside the router, because several ports navigate.
 */
import { useEffect } from 'react';
import { recoveryPortsStore } from '@/lib/recovery-route/ports-store';
import type { RecoveryPorts } from '@/lib/recovery-route/ports';
import { BugReportHost } from '@/components/bug-report/BugReportHost';
import { useRecoveryPorts } from './use-recovery-ports';

export function RecoveryPortsProvider(): JSX.Element {
  const ports: RecoveryPorts = useRecoveryPorts();
  useEffect((): (() => void) => {
    recoveryPortsStore.set(ports);
    return (): void => { if (recoveryPortsStore.get() === ports) recoveryPortsStore.set(null); };
  }, [ports]);
  return <BugReportHost />;
}
