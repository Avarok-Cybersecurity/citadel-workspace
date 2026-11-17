/**
 * The chat header's files button: the file manager at the top of the storage you
 * share with this peer. Null until you are registered peers, because until then
 * there is no shared storage to open.
 */
import { useLocation } from 'react-router-dom';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';
import { fileManagerHref } from '@/lib/file-manager-location';

export function usePeerFilesOpener(peerCid: bigint, isRegistered: boolean): (() => void) | null {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: GuardedNavigate = useGuardedNavigate();
  if (!isRegistered) return null;
  return (): void => {
    void navigate(fileManagerHref(location.search, { storage: { kind: 'peer', cid: peerCid }, path: '/', item: null, via: null }));
  };
}
