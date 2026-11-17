/**
 * Centralized timeout and interval constants.
 * Extracted from magic numbers scattered across the codebase.
 */

export const TIMEOUT: { readonly SERVER_REQUEST_MS: 5000; readonly DISCONNECT_REQUEST_MS: 30000; readonly FILE_PICKER_MS: 120000; readonly LOCALDB_REQUEST_MS: 5000; readonly GET_SELECTED_USER_MS: 2000; readonly P2P_CONNECT_REQUEST_MS: 30000; readonly P2P_ACCEPT_REQUEST_MS: 10000; readonly P2P_DISCONNECT_MS: 10000; readonly P2P_MESSAGE_MS: 500; readonly SEARCH_DEBOUNCE_MS: 300; readonly SESSION_MANAGEMENT_MS: 3000; readonly CLAIM_SESSION_MS: 10000; readonly PEER_REGISTER_MS: 10000; readonly PERMISSION_FETCH_MS: 10000; readonly PEER_LIST_MS: 35000; readonly FILE_SEND_MS: 30000; readonly FILE_DOWNLOAD_MS: 60000; readonly OUTBOUND_ACK_MS: 30000; readonly CHECKSTATE_MS: 3000; readonly SW_ACTIVATION_MS: 3000; readonly CID_REPORT_WINDOW_MS: 5000; readonly ACCOUNT_LINK_SIGN_IN_MS: 2500; readonly AGENT_UPDATE_REQUEST_MS: 10000; readonly AGENT_UPDATE_CHECK_MS: 600000; } = {
  /** Default timeout for server requests (WebSocket round-trip) */
  SERVER_REQUEST_MS: 5000,
  /** Timeout for disconnect requests (may involve cleanup) */
  DISCONNECT_REQUEST_MS: 30000,
  /** Timeout for file picker dialog */
  FILE_PICKER_MS: 120000,
  /** Timeout for LocalDB (IndexedDB) operations */
  LOCALDB_REQUEST_MS: 5000,
  /** Timeout for getSelectedUser() tab context lookup */
  GET_SELECTED_USER_MS: 2000,
  /** Timeout for P2P connection establishment */
  P2P_CONNECT_REQUEST_MS: 30000,
  /** Timeout for P2P accept request */
  P2P_ACCEPT_REQUEST_MS: 10000,
  /** Timeout for P2P disconnect */
  P2P_DISCONNECT_MS: 10000,
  /** Timeout for P2P message send acknowledgment */
  P2P_MESSAGE_MS: 500,
  /** Debounce timeout for search input */
  SEARCH_DEBOUNCE_MS: 300,
  /** Timeout for session management operations (SetOrphanMode) */
  SESSION_MANAGEMENT_MS: 3000,
  /** Timeout for ClaimSession / DisconnectOrphan */
  CLAIM_SESSION_MS: 10000,
  /** Timeout for peer registration operations */
  PEER_REGISTER_MS: 10000,
  /** Timeout for permission fetch operations */
  PERMISSION_FETCH_MS: 10000,
  /**
   * Timeout for peer list operations.
   *
   * Must exceed the agent's own PEER_LIST_TIMEOUT, which is 30s
   * (citadel-internal-service .../requests/peer/mod.rs). It was 6000, chosen
   * against a 5s wrapper that no longer exists — so under load the browser
   * declared discovery failed while the service was still legitimately working,
   * and the late answer arrived with no listener.
   *
   * Longer than the thing it waits on, not shorter: giving up first turns a
   * slow answer into a wrong one.
   */
  PEER_LIST_MS: 35000,
  /** Timeout for file send requests */
  FILE_SEND_MS: 30000,
  /** Timeout for file download requests */
  FILE_DOWNLOAD_MS: 60000,
  /** Timeout for outbound ACK from leader */
  OUTBOUND_ACK_MS: 30000,
  /** Timeout for CheckState (peer readiness check) */
  CHECKSTATE_MS: 3000,

  /**
   * How long to wait for a waiting service worker to take control after being
   * sent SKIP_WAITING, before reloading anyway. Short on purpose: the user has
   * pressed a recovery button on a crashed screen, so a reload that misses the
   * update beats a button that appears to hang.
   */
  SW_ACTIVATION_MS: 3000,
  /**
   * How long the leader waits for every tab to answer a cid-report request
   * before treating a silent one as gone (follower-session-claims). A live
   * tab answers in milliseconds; one dropped by mistake re-registers on its
   * next cid-update or report.
   */
  CID_REPORT_WINDOW_MS: 5000,
  /**
   * How long an account link (the menu bar's "Log in") waits for the agent's session list
   * before opening sign-in with its username; a live session answering later still switches.
   */
  ACCOUNT_LINK_SIGN_IN_MS: 2500,
  /** An agent updater request that answers from what it holds (status, settings, install) */
  AGENT_UPDATE_REQUEST_MS: 10000,
  /** "Check now": the agent answers after reading the release and downloading and verifying it */
  AGENT_UPDATE_CHECK_MS: 600000,
} as const;

export const INTERVAL: { readonly HEALTH_CHECK_MS: 30000; readonly HEARTBEAT_MS: 2000; readonly LEADER_ELECTION_MS: 3000; readonly LEADER_TIMEOUT_MS: 5000; readonly LEADER_CHALLENGE_MS: 1000; readonly CLEANUP_MS: 60000; readonly REQUEST_TRACKING_MS: 300000; readonly PERMISSION_CACHE_MS: 60000; readonly DEPLOYED_VERSION_MS: 600000; readonly STALE_HIDDEN_RELOAD_MS: 60000; } = {
  /** Health check polling interval */
  HEALTH_CHECK_MS: 30000,
  /** WebSocket heartbeat/keep-alive interval */
  HEARTBEAT_MS: 2000,
  /** Leader election broadcast interval */
  LEADER_ELECTION_MS: 3000,
  /** Leader heartbeat timeout (declare leader dead) */
  LEADER_TIMEOUT_MS: 5000,
  /**
   * How long a challenger waits for a live, older leader to answer before it leads. A leader
   * in a background tab sends heartbeats about once a minute, but answers a challenge at once.
   */
  LEADER_CHALLENGE_MS: 1000,
  /** Periodic cleanup interval (stale requests, etc.) */
  CLEANUP_MS: 60000,
  /** Request tracking expiry interval */
  REQUEST_TRACKING_MS: 300000,
  /** Permission cache TTL */
  PERMISSION_CACHE_MS: 60000,
  /**
   * How often an open page asks `/version.json` whether a new build is out.
   * Tab focus and coming online also check, so this only bounds how long a page
   * left in the foreground can run a superseded build: ten minutes of a
   * ~50-byte, uncached request per open tab.
   */
  DEPLOYED_VERSION_MS: 600000,
  /**
   * How long a tab running a superseded build must have been hidden before it reloads by
   * itself (stale-auto-reload.ts): long enough that nobody is in the middle of using it.
   */
  STALE_HIDDEN_RELOAD_MS: 60000,
} as const;

export const POLLING: { readonly P2P_REGISTRATION_INTERVAL_MS: 30000; readonly SERVER_POLL_INTERVAL_MS: 60000; readonly OUTGOING_REQUESTS_INTERVAL_MS: 300000; readonly GET_SESSIONS_POLL_INTERVAL_MS: 5000; } = {
  /** P2P registration polling interval */
  P2P_REGISTRATION_INTERVAL_MS: 30000,
  /** Server auto-reconnect polling interval */
  SERVER_POLL_INTERVAL_MS: 60000,
  /** Outgoing request check interval */
  OUTGOING_REQUESTS_INTERVAL_MS: 300000,
  /** GetSessions polling interval for peer connection state sync (fallback consistency) */
  GET_SESSIONS_POLL_INTERVAL_MS: 5000,
} as const;

// NETWORK.WORKSPACE_SERVER_PORT (12349) was removed: it was the address resolver's default port
// while the address field assumed 12400, so the same typed address compared as two servers. The
// one default is DEFAULT_WORKSPACE_PORT in workspace-address.ts.
