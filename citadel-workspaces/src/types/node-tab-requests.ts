/**
 * The requests that change a node's tabs, as `WorkspaceProtocolRequestTS` sends them: a node's
 * own list rides in `UpdateNode.metadata` (merged into the node's metadata by the server), the
 * workspace default in `SetDefaultAppTabs`. Mirrors `citadel-workspace-types/src/lib.rs`.
 */
export interface UpdateNodeRequestTS {
  node_id: string;
  name?: string;
  description?: string;
  mdx_content?: string;
  rules?: string;
  chat_enabled?: boolean;
  is_default?: boolean;
  /** A JSON object merged key by key into the node's metadata; needs UpdateNodeSettings. */
  metadata?: number[];
}

export interface NodeTabRequestsTS {
  /** The root workspace's `default_app_tabs`; needs EditWorkspaceConfig. */
  SetDefaultAppTabs?: { app_tabs: string[] };
}
