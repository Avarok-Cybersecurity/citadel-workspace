import type { WorkspaceMetadataBytes } from '@/types/workspace-metadata';
import { useEffect } from 'react';
import { workspaceEvents } from '@/lib/workspace-events';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { connectionManager } from '@/lib/connection';
import { getSelectedUser } from '@/lib/tab-context';
import { tabIdentity, type TabIdentity } from '@/lib/tab-identity';
import { metadataDocument } from '@/lib/workspace-metadata/metadata-document';
import type { WorkspaceEventState } from '../WorkspaceEventHandler';
import { setLoading, runAsyncSetup } from './event-setup-utils';
import { applyOwnMemberRecord, mergeCurrentUser } from './merge-current-user';
import type { StoredSession } from '@/types/session-types';
import type { User } from '@/types/workspace-entities';

interface UseWorkspaceEventSetupProps {
  setState: React.Dispatch<React.SetStateAction<WorkspaceEventState>>;
}

export function useWorkspaceEventSetup({ setState }: UseWorkspaceEventSetupProps): void {
  useEffect(() => {
    // Kept, not discarded.
    //
    // `onMemberEvent` and `onWorkspaceEvent` return their unsubscribe
    // SYNCHRONOUSLY, and `await` on a plain value throws nothing away by
    // itself -- but nothing here captured the result, and the effect returned
    // no cleanup. Every remount left another set of live listeners behind, each
    // retaining a closure over `setState`, and every event then ran an
    // ever-growing pile of dead handlers.
    //
    // Nothing broke visibly, because setState on an unmounted component is a
    // no-op, which is exactly why it accumulated. `use-domain-members` carries
    // the same paragraph about the same mistake, fixed there and not here.
    //
    // The sibling `useMessageEventSetup` calls `cleanupAllListeners()` on
    // unmount, which does remove these -- and also removes every listener this
    // hook did not create. That is not a substitute for owning your own
    // unsubscribe.
    const unsubscribes: Array<() => void> = [];
    let cancelled: boolean = false;
    /** Unsubscribes immediately if the effect has already been cleaned up. */
    const keep = (unsubscribe: () => void): void => {
      if (cancelled) unsubscribe();
      else unsubscribes.push(unsubscribe);
    };

    const setupWorkspaceListeners = async (): Promise<void> => {
      // Loading state
      keep(workspaceEvents.onWorkspaceEvent('workspace:loading', () => {
        setLoading(setState, 'workspace', true);
      }));

      // Workspace loaded event
      keep(workspaceEvents.onWorkspaceEvent('workspace:loaded', async (payload) => {
        // The event carries what the wire carries: `Workspace.metadata` is
        // `Vec<u8>`, emitted as `response.Workspace.metadata || []`. The
        // payload's declared type says otherwise, which is why the object
        // branch below exists.
        const rawMetadata: WorkspaceMetadataBytes | Record<string, unknown> | undefined =
          payload.workspace.metadata as WorkspaceMetadataBytes | Record<string, unknown> | undefined;

        // Decoded by the one metadata reader (theme and logo use it too). This
        // parsed number arrays only: typed-array bytes read as "not initialised".
        const parsedMetadata: Record<string, unknown> | null = metadataDocument(rawMetadata);
        const isInitialized: boolean = parsedMetadata?.initialized === true;

        setState(prev => ({
          ...prev,
          workspace: {
            id: payload.workspace.id,
            name: payload.workspace.name,
            // Copied, so the settings dialog shows the stored description.
            description: payload.workspace.description,
            // The BYTES, not the parse. `WorkspaceState.workspace.metadata` is
            // declared `WorkspaceMetadataBytes` and says "Raw Vec<u8> from the
            // wire. Decode it; do not read properties off it" -- and storing
            // the decoded object here made that declaration false for every
            // consumer. `parsedMetadata` is still what decides `isInitialized`
            // just above; it simply is not what the field holds.
            //
            // The type file argues this at length because the opposite once
            // broke something: `getWorkspaceLogo` tested `metadata.logo` on a
            // byte array, so every workspace fell back to initials.
            metadata: rawMetadata as WorkspaceMetadataBytes | undefined
          },
          loading: { ...prev.loading, workspace: false },
          needsWorkspaceInitialization: !isInitialized,
          // The workspace answered this account, so any refusal heard before is over.
          membershipRefused: false,
        }));

        // Broadcast workspace state to other tabs
        broadcastChannelService.broadcastStateSync({
          type: 'workspace',
          data: {
            workspace: { id: payload.workspace.id, name: payload.workspace.name, description: payload.workspace.description, metadata: parsedMetadata ?? undefined },
            loading: { workspace: false },
            needsWorkspaceInitialization: !isInitialized,
          }
        });

        // Who this tab is: the tab's selection, then its saved account. This read
        // `UserService`'s per-tab record, which only registration writes -- so a
        // tab that resumed a session or signed in with a password never had a
        // `currentUser` at all, and everything reading it fell back or went dark
        // (the Profile Visibility switch stayed disabled). See tab-identity.ts.
        const storedSession: StoredSession | null = await connectionManager.getTabSelectedSession();
        const identity: TabIdentity = tabIdentity(await getSelectedUser(), storedSession);
        const username: string | undefined = identity.username;

        if (username) {
          // Merged, not assigned. `UserRegistrationInfo` has no avatar in it, so
          // building a fresh object here dropped `avatarUrl` on every workspace
          // load -- and the profile-update event is its only writer, so a photo
          // a user had just set vanished at the next workspace event and never
          // survived a reload. See merge-current-user.ts.
          setState(prev => ({
            ...prev,
            currentUser: applyOwnMemberRecord(
              mergeCurrentUser(prev.currentUser, { username, fullName: identity.fullName, role: storedSession?.role }),
              Object.values(prev.members).find((m: User): boolean => m.username === username),
            ),
          }));
        }

        // `listWorkspaces()` used to run here on every workspace load, and its
        // result was written into `state.workspaces` -- which nothing in the
        // tree ever read. A network round trip per load feeding dead state, and
        // a field in the context type that made the app look as though it
        // tracked a workspace list. The switcher reads stored sessions, not
        // this. Removed rather than left as a decoy; one line brings it back if
        // something ever needs it.
      }));

      // Workspace not initialized event
      keep(workspaceEvents.onWorkspaceEvent('workspace:not-initialized', () => {
        setState(prev => ({
          ...prev,
          needsWorkspaceInitialization: true,
          loading: { ...prev.loading, workspace: false }
        }));
      }));
    };

    runAsyncSetup(setupWorkspaceListeners);

    return (): void => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes.length = 0;
    };
  }, [setState]);
}
