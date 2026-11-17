import { useEffect, useMemo, useState } from 'react';
import { RingingCall } from './RingingCall';
import { CallProvider } from './CallProvider';
import { CallSoundEffects } from './CallSoundEffects';
import { CallAudioHost } from './CallAudioHost';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { connectionManager } from '@/lib/connection';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';

/**
 * Mounts calling for the whole app: the provider that owns a call, and the
 * ringing card that has to be reachable from wherever the user happens to be.
 */
export function CallLayer({ children }: { children: React.ReactNode }): JSX.Element {
  const [selfCid, setSelfCid] = useState<bigint | null>(null);

  useEffect(() => {
    // Polled rather than subscribed because connection identity settles
    // asynchronously during login, and calling is unavailable until it has.
    const read = (): void => setSelfCid(connectionManager.getConnectionInfo()?.cid ?? null);
    read();
    const timer: number = window.setInterval(read, 2000);
    return (): void => window.clearInterval(timer);
  }, []);

  const senderConfig: Pick<MessageSenderConfig, "getCurrentCid"> = useMemo<Pick<MessageSenderConfig, 'getCurrentCid'>>(
    () => ({
      // The authority, not `connectionManager.getConnectionInfo()` -- which is
      // the LAST resort in that chain, and is the connection's identity rather
      // than this tab's. With two sessions in one browser the call layer was
      // answering "who am I" differently from the messenger beside it.
      getCurrentCid,
    }),
    [],
  );

  return (
    <CallProvider selfCid={selfCid} senderConfig={senderConfig as MessageSenderConfig}>
      <CallSoundEffects />
      <CallAudioHost />
      <RingingCall />
      {/*
        OngoingCallBar is NOT here, though it belongs to this layer and used to
        be. It calls useNavigate() -- its whole purpose is a Return button --
        and CallLayer is mounted ABOVE <BrowserRouter> so that a call survives
        navigation. A hook runs before the component's early returns, so the
        bar threw react-router's "useNavigate() may be used only in the context
        of a <Router>" on EVERY render, with no call in progress and no bar on
        screen.

        That took the whole application down: the throw propagated to the root
        error boundary, so every production load -- and every dev load --
        rendered "Something went wrong" instead of the app. It is rendered
        inside the router in App.tsx, where it can both navigate and still sit
        above every route.
      */}
      {children}
    </CallProvider>
  );
}

