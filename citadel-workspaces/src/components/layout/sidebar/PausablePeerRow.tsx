import type { ComponentProps } from 'react';
import { PeerListRow } from './PeerListRow';
import { usePeerPause, type PeerPauseBinding } from '@/components/p2p/hooks/use-peer-pause';

type PausablePeerRowProps = Omit<ComponentProps<typeof PeerListRow>, 'pause'>;

/** A peer row bound to that contact's pause record, with its row menu. */
export function PausablePeerRow(props: PausablePeerRowProps): JSX.Element {
  // The row's cid is a string at this boundary; a CID is a bigint everywhere past it.
  const binding: PeerPauseBinding = usePeerPause(BigInt(props.cid));
  return (
    <PeerListRow
      {...props}
      pause={{ status: binding.status, busy: binding.busy, onPause: binding.pause, onResume: binding.resume }}
    />
  );
}
