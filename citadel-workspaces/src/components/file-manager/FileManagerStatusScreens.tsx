/**
 * What the file manager shows in place of a folder while it cannot show one.
 * The top bar stays above these, so the way to another storage is always there.
 */
import { Loader2, FolderOpen, RefreshCw, Server, UserX } from "lucide-react";
import type { StorageRef } from '@/lib/file-manager-location';
import { peerDisplayName } from '@/lib/peer-display';

const SCREEN: string = "flex flex-1 flex-col items-center justify-center gap-4 bg-background p-8 text-center text-muted-foreground";
const ACTION: string = "flex items-center gap-2 rounded bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90";

export function ConnectingScreen(): JSX.Element {
  return (
    <div className={SCREEN} role="status">
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p>Connecting...</p>
    </div>
  );
}

interface LoadingScreenProps {
  label: string;
}

export function LoadingScreen({ label }: LoadingScreenProps): JSX.Element {
  return (
    <div className={SCREEN} role="status">
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

interface UnknownPeerScreenProps {
  /** What the address named. */
  storage: StorageRef;
  onOpenServer: () => void;
}

/**
 * The address names a storage this account cannot open: not a CID, your own,
 * or someone you are not registered with. Said as such, with the way out --
 * never by quietly opening some other member's files in its place.
 */
export function UnknownPeerScreen({ storage, onOpenServer }: UnknownPeerScreenProps): JSX.Element {
  const named: string = storage.kind === 'invalid' ? `“${storage.raw}”` : storage.kind === 'peer' ? peerDisplayName({ cid: storage.cid }) : 'the server';
  return (
    <div className={SCREEN} data-testid="vfs-unknown-peer">
      <UserX className="h-12 w-12" aria-hidden="true" />
      <h2 className="text-xl text-foreground">This storage isn&rsquo;t available</h2>
      <p className="max-w-md text-sm">
        The link points to storage shared with {named}, and you are not registered peers with them on this account.
        Storage is shared between two members once they are registered peers. Choose a peer above, or open your server storage.
      </p>
      <button type="button" onClick={onOpenServer} className={ACTION}>
        <Server className="h-4 w-4" aria-hidden="true" />
        Open Server Storage
      </button>
    </div>
  );
}

interface ErrorScreenProps {
  error: string | null;
  /**
   * Re-fetch the tree. The hook has always exposed this; the screen just never
   * offered it, so one timed-out fetch on a flaky link (the tree request has a
   * 30s budget) painted a permanent dead end for what was a transient blip.
   * The only way out was to navigate away and back.
   */
  onRetry: () => void;
}

export function ErrorScreen({ error, onRetry }: ErrorScreenProps): JSX.Element {
  return (
    <div className={SCREEN}>
      <FolderOpen className="h-12 w-12" aria-hidden="true" />
      <h2 className="text-xl text-foreground">File System Error</h2>
      <p className="max-w-md text-sm">{error ?? 'Failed to load tree'}</p>
      <button type="button" onClick={onRetry} className={ACTION}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Try Again
      </button>
    </div>
  );
}
