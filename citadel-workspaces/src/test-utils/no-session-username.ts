/**
 * The username reader for group-binding tests whose senders are CIDs only.
 *
 * Rationale for the fixed answer: those tests identify "you" by the tab's CID, so there is no
 * signed-in username to read; a real one would only matter for an office-channel sender, which
 * `your-own-office-message-is-not-unread` and `group-messages-interrupt` cover.
 */
export const noSessionUsername = (): undefined => undefined;
