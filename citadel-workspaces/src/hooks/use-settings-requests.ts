import { useEffect, useRef, type MutableRefObject } from 'react';
import type { SettingsTab } from '@/lib/settings-request';
import { takeLinkTarget } from '@/lib/onboarding/link-target';
import { settingsRequest } from '@/lib/settings-request';

/**
 * Opens Settings for whoever asked: a native notice's "settings" link (at Privacy, once, on
 * mount; lib/onboarding/link-target.ts) and every requestSettings(tab) from the page. Each
 * request is taken when answered, so it opens Settings once.
 */
export function useSettingsRequests(open: (tab: SettingsTab) => void): void {
  const opener: MutableRefObject<(tab: SettingsTab) => void> = useRef(open);
  opener.current = open;
  useEffect((): (() => void) => {
    if (takeLinkTarget(['settings'])) opener.current('privacy');
    const answer = (): void => {
      const tab: SettingsTab | null = settingsRequest.get();
      if (tab === null) return;
      settingsRequest.set(null);
      opener.current(tab);
    };
    answer();
    return settingsRequest.subscribe(answer);
  }, []);
}
