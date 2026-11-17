/**
 * The metadata keys behind a node's tabs, and the list limit, as the server names them
 * (`citadel-workspace-types/src/node_tabs.rs`; `tab-keys-match-the-rust.test.ts` holds the two
 * together). The server checks every write against the same rules, so this is what the UI
 * offers, never what it trusts.
 */

/** The node's own ordered app-tab list. Absent means "the workspace default". */
export const APP_TABS_KEY: 'app_tabs' = 'app_tabs';
/** The workspace's ordered app-tab list for nodes without their own. */
export const DEFAULT_APP_TABS_KEY: 'default_app_tabs' = 'default_app_tabs';
/** A node's (or the workspace's) IANA time zone; absent means the nearest ancestor's. */
export const TIME_ZONE_KEY: 'time_zone' = 'time_zone';
/** The most app tabs one list may name. */
export const MAX_APP_TABS: number = 8;
