/**
 * The document title bar's encryption lock, mounted as DocumentSaveControls mounts it, over the browser's
 * real store. `?atRest=on` writes this device's "on" record for the account before the first render, the
 * record turning encryption on leaves; without it nothing is stored, which reads as off. Its request to open
 * Settings is answered as the top bar answers it.
 */
import { useEffect, useState } from 'react';
import { AtRestStatus } from '@/components/documents/save/AtRestStatus';
import { LazySettingsModal } from '@/components/LazySettingsModal';
import { useSettingsRequests } from '@/hooks/use-settings-requests';
import { atRestModeKey } from '@/lib/document-replica-cache';
import { dbDelete, dbPut } from '@/lib/storage-utils';
import { Shell } from './scenarios-screens.jsx';

const ACCOUNT = 7_000_000_000_000_000_001n;

/** What the top bar does with a request to open Settings (TopBar.tsx), with the same hook. */
function SettingsAnswerer() {
  const [tab, setTab] = useState(null);
  useSettingsRequests(setTab);
  return tab === null ? null : <LazySettingsModal open onOpenChange={(open) => { if (!open) setTab(null); }} tab={tab} />;
}

function TitleBarLock() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = new URLSearchParams(location.search).get('atRest') === 'on';
    const key = atRestModeKey(ACCOUNT);
    void (on ? dbPut('keyValue', key, { on: true, converting: false }) : dbDelete('keyValue', key)).then(() => setReady(true));
  }, []);
  return (
    <Shell>
      <header className="flex items-center justify-end gap-[12px] border-b border-border p-2">
        {ready && <AtRestStatus account={ACCOUNT} />}
      </header>
      <SettingsAnswerer />
    </Shell>
  );
}

export const AT_REST_SCENARIOS = { 'docs-at-rest': TitleBarLock };
