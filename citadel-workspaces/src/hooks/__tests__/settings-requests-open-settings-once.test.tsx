/**
 * requestSettings(tab) opens Settings at that tab, once, whether it was asked before or after the
 * top bar mounted. Real store and hook; the opener is the test's own callback, as TopBar's is.
 */
import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import type { SettingsTab } from '@/components/SettingsModal';
import { requestSettings, settingsRequest } from '@/lib/settings-request';
import { useSettingsRequests } from '../use-settings-requests';

function Answerer({ opened }: { readonly opened: SettingsTab[] }): null {
  useSettingsRequests((tab: SettingsTab): void => { opened.push(tab); });
  return null;
}

describe('a request to open Settings', () => {
  it('opens it at the tab asked for, once', () => {
    const opened: SettingsTab[] = [];
    render(<Answerer opened={opened} />);
    act((): void => { requestSettings('security'); });
    expect(opened).toEqual(['security']);
    expect(settingsRequest.get()).toBeNull();
  });

  it('is answered when the top bar mounts after it', () => {
    act((): void => { requestSettings('advanced'); });
    const opened: SettingsTab[] = [];
    render(<Answerer opened={opened} />);
    expect(opened).toEqual(['advanced']);
  });
});
