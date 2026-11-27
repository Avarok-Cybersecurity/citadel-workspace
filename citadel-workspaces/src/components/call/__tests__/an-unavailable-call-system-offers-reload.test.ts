/**
 * "The call system could not start" carries Reload as its action, at each of the three moments,
 * and Reload reloads (through the registered ports). It used to ask for a reload in words only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Shown { title: string; action?: { label: string; onClick: () => void } }
const shown: Shown[] = vi.hoisted((): Shown[] => []);
vi.mock('@/hooks/use-toast', () => ({ toast: (t: Shown): { dismiss: () => void } => { shown.push(t); return { dismiss: (): void => undefined }; } }));

import { reportCallSystemUnavailable, type CallMoment } from '../report-call-system-unavailable';
import { recoveryPortsStore } from '@/lib/recovery-route/ports-store';
import { recordingPorts, type PortCall } from '@/lib/recovery-route/__tests__/fake-ports';
import type { RecoveryPorts } from '@/lib/recovery-route/ports';

afterEach(() => { shown.length = 0; recoveryPortsStore.set(null); });

describe('an unavailable call system', () => {
  it.each(['start', 'accept', 'inbound'] as CallMoment[])('%s: Reload is the action, and it reloads', async (moment: CallMoment) => {
    const { ports, calls }: { ports: RecoveryPorts; calls: PortCall[] } = recordingPorts({ kind: 'sent', admins: 0 });
    recoveryPortsStore.set(ports);
    reportCallSystemUnavailable(moment);
    // The toast's way out loads with the first one shown (recovery-toast.ts), so it appears a moment later.
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].action?.label).toBe('Reload');
    shown[0].action?.onClick();
    await vi.waitFor(() => expect(calls.map((c: PortCall) => c.port)).toContain('reload'));
  });
});
