import { PauseConnectionCard } from './PauseConnectionCard';
import { usePeerPause, type PeerPauseBinding } from './hooks/use-peer-pause';

/** The settings card, bound to this contact's pause record. */
export function PauseConnectionControl({ peerCid, peerName }: { peerCid: bigint; peerName: string }): JSX.Element {
  const pause: PeerPauseBinding = usePeerPause(peerCid);
  return (
    <PauseConnectionCard
      status={pause.status} peerName={peerName} busy={pause.busy}
      onPause={pause.pause} onResume={pause.resume}
    />
  );
}
