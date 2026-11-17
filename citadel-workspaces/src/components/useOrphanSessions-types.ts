/**
 * What `useOrphanSessions` returns.
 *
 * Its own module because the hook was 261 lines with it inline, and a result
 * shape is exactly the cohesive unit the length gate asks for rather than
 * compressed prose.
 */
import type { SignInRequest } from '@/lib/sessions/sign-in-request';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveSession } from '@/types/session-types';
import type { DisconnectAction } from './DisconnectConfirmModal';
import type { DisconnectStatus } from './LoadingModal';
import type { OrphanSessionWithWorkspace } from './useOrphanSessions';
import type { notificationService } from '@/lib/notification-service';

export interface UseOrphanSessionsResult {
  sessions: OrphanSessionWithWorkspace[];
  disconnectTarget: { session: ActiveSession; workspaceName: string } | null;
  setDisconnectTarget: Dispatch<SetStateAction<{ session: ActiveSession; workspaceName: string } | null>>;
  glowingSessionCid: bigint | null;
  notificationCounts: Map<string, number>;
  loadingModal: { open: boolean; status: DisconnectStatus; workspaceName: string; errorMessage?: string };
  loadActiveSessions: () => Promise<void>;
  handleNavigate: (session: OrphanSessionWithWorkspace) => Promise<void>;
  handleDisconnect: (session: OrphanSessionWithWorkspace) => void;
  handleConfirmDisconnect: (action: DisconnectAction) => Promise<void>;
  handleLoadingComplete: () => void;
  notificationService: typeof notificationService;
  /** The sign-in open from this bar: a session held in another window, or one the agent no longer holds. */
  signInRequest: SignInRequest | null;
  clearTakeover: () => void;
}
