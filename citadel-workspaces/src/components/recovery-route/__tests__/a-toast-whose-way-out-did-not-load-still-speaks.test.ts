/**
 * recovery-toast.ts loads the toast's way out with the first one shown. When that chunk does not
 * load, the person still reads what went wrong (and main.tsx reloads on a failed chunk load).
 */
import { describe, expect, it, vi } from 'vitest';

interface Shown { title: string; action?: unknown }
const shown: Shown[] = vi.hoisted((): Shown[] => []);
vi.mock('@/hooks/use-toast', () => ({ toast: (t: Shown): { dismiss: () => void } => { shown.push(t); return { dismiss: (): void => undefined }; } }));
vi.mock('../recovery-toast-view', (): never => { throw new Error('Failed to fetch dynamically imported module'); });

import { recoveryToast } from '../recovery-toast';
import { recovery } from '@/lib/recovery-route/recovery';

describe('a recovery toast whose view did not load', () => {
  it('still shows its title, without an action it cannot run', async () => {
    recoveryToast(recovery('call.system-unavailable', {}), { title: 'The call system could not start' });
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].title).toBe('The call system could not start');
    expect(shown[0].action).toBeUndefined();
  });
});
