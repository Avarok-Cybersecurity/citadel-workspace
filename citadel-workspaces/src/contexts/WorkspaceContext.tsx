import React, { createContext, useContext, useMemo } from 'react';
import { User } from '../types/workspace-entities';
// From the type module, not the component that re-exports it: this context is
// read above the router (PeerRefusalNotice), and the component uses router hooks.
import type { DomainNode, TreeSchema } from '@/components/layout/sidebar/tree-node-types';
import type { WorkspaceMetadataBytes } from '@/types/workspace-metadata';

// Define the shape of our workspace state
export interface WorkspaceState {
  workspace?: {
    id: string;
    name: string;
    description?: string;
    /** Raw `Vec<u8>` from the wire. Decode it; do not read properties off it. */
    metadata?: WorkspaceMetadataBytes;
  };
  currentUser?: {
    id: string;
    username: string;
    name: string;
    /** The legacy role mirror; only `Banned` means anything. Authority is `roleId`. */
    role?: string;
    /** Your role in the workspace's role table (`workspace_roles[root]`); undefined until known. */
    roleId?: string;
    displayName?: string;
    avatarUrl?: string; // Base64 data URL for avatar image
    /** From the member record's metadata; see lib/profile-metadata.ts. */
    email?: string;
    title?: string;
    /** Server-enforced; undefined until the own record has arrived. See lib/profile-privacy.ts. */
    showProfileToStrangers?: boolean;
  };
  members: Record<string, User>;
  nodes: Record<string, DomainNode>;
  treeSchema: TreeSchema | null;
  loading: {
    workspace: boolean;
    members: boolean;
    nodes: boolean;
  };
  /**
   * The node list's deadline expired without an answer.
   *
   * `loading.nodes` going false is not evidence the workspace is empty. The
   * tree said "Your workspace is empty. Click the + button to create your first
   * space" after a load that never came back -- and acting on that advice
   * creates a duplicate space in a workspace whose contents merely failed to
   * fetch. `use-domain-members` reached the same conclusion for members first.
   */
  nodesUnavailable: boolean;
  /** The server refused this account the workspace: it is not a member (lib/membership-refusal.ts). */
  membershipRefused: boolean;

  error?: string;
  protocolWarning?: {
    message: string;
    requestType: string;
    timestamp: number;
  };
  messages: {
    byPeer: Record<string, Array<{
      content: string;
      timestamp: number;
      id?: string;
      pending?: boolean;
    }>>;
    lastMessageTimestamp?: number;
  };
  typing: {
    peerIds: string[];
    lastUpdated: number;
  };
}

// Default initial state
const initialState: WorkspaceState = {
  workspace: undefined,
  currentUser: undefined,
  members: {},
  nodes: {},
  nodesUnavailable: false,
  membershipRefused: false,
  treeSchema: null,
  loading: {
    workspace: false,
    members: false,
    nodes: false,
  },
  messages: {
    byPeer: {},
  },
  typing: {
    peerIds: [],
    lastUpdated: 0
  }
};

// Create the context
export const WorkspaceContext: React.Context<{ state: WorkspaceState; }> = createContext<{
  state: WorkspaceState;
}>({
  state: initialState
});

// Custom hook to use the workspace context
export const useWorkspace: () => { state: WorkspaceState; } = (): { state: WorkspaceState; } => useContext(WorkspaceContext);

// Provider component
export interface WorkspaceProviderProps {
  children: React.ReactNode;
  state: WorkspaceState;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
  children,
  state
}) => {
  // Memoised: an object literal here is a new reference on every render of the
  // provider, and context propagation bypasses React's element-identity
  // bailout — so all 20 useWorkspace() consumers re-rendered whenever the
  // provider did, regardless of whether `state` had changed.
  const value: { state: WorkspaceState; } = useMemo((): { state: WorkspaceState; } => ({ state }), [state]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};
