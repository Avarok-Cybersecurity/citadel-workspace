/**
 * The user's privacy choices, as a source the code that must obey them can read.
 *
 * These lived entirely inside `PrivacySettingsTab`: it wrote them to
 * localStorage and dispatched a `privacy-settings-changed` event that nothing
 * subscribed to. No field was read anywhere outside the tab that wrote it. On a
 * product whose pitch is that the user controls their own data, "Send read
 * receipts: off" still sent receipts and "Show typing indicators: off" still
 * showed them.
 *
 * Five settings are honoured from here. The rest live elsewhere, and saying
 * where is part of the fix:
 *
 * - `acceptRequestsFromStrangers` is enforced where the decision is made: this
 *   client answers an incoming P2P registration request, and a stranger's is
 *   declined (p2p-registration-service/incoming-request-policy.ts). A copy is
 *   published on the member record only so the refused requester can be told
 *   why; the decision never reads that copy.
 * - Profile visibility is NOT here. The avatar, email and title are served by
 *   the workspace server, so only the server can withhold them; the choice is
 *   stored on the user's record there (lib/profile-privacy.ts).
 * - `notifyOnScreenshot` is best effort and says so: a page sees only the
 *   PrintScreen key on Windows/Linux (lib/p2p/screenshot-detection.ts). The
 *   setting governs whether THIS user is shown the peer's notice.
 *
 * `acceptRequestsFromStrangers` replaced `allowDirectMessages`, a three-way
 * select that could not be changed (it was disabled) but was saved on every
 * visit to the tab. A new name, so a stored value nobody chose cannot start
 * refusing requests.
 */

const STORAGE_KEY: "citadel:privacy-settings" = 'citadel:privacy-settings';
const CHANGE_EVENT: "privacy-settings-changed" = 'privacy-settings-changed';

export interface PrivacySettings {
  showOnlineStatus: boolean;
  showTypingIndicators: boolean;
  sendReadReceipts: boolean;
  /** Off: a P2P registration request from someone not already a contact is declined. */
  acceptRequestsFromStrangers: boolean;
  notifyOnScreenshot: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  showOnlineStatus: true,
  showTypingIndicators: true,
  sendReadReceipts: true,
  // On: a contact can only be made by one side accepting the other's request,
  // so refusing strangers by default would leave two default users unable to
  // connect at all. It is also what every user has had until now.
  acceptRequestsFromStrangers: true,
  notifyOnScreenshot: false,
};

/** Which settings this client can actually act on today. */
export const PRIVACY_ENFORCEMENT: Record<keyof PrivacySettings, boolean> = {
  showOnlineStatus: true,
  showTypingIndicators: true,
  sendReadReceipts: true,
  acceptRequestsFromStrangers: true,
  notifyOnScreenshot: true,
};

/**
 * Cached because the send paths consult this per keystroke (typing indicator)
 * and per message (read receipt); a synchronous localStorage read on each would
 * be a needless main-thread hit. Invalidated by every write, including writes
 * from another tab.
 */
let cached: PrivacySettings | null = null;

function readFromStorage(): PrivacySettings {
  try {
    const stored: string | null = localStorage.getItem(STORAGE_KEY);
    // Merged over defaults, never returned verbatim: a blob saved by an older
    // build is missing every field added since, and `undefined` reads as "off"
    // for a boolean — silently turning a privacy setting the user never saw
    // into the more permissive answer, or the more restrictive one, at random.
    if (stored) return { ...DEFAULT_PRIVACY_SETTINGS, ...JSON.parse(stored) };
  } catch {
    // A corrupt or unreadable blob must not leave callers without an answer.
    // Defaults are the documented behaviour; failing open on a privacy setting
    // is not an option, and neither is throwing into a send path.
  }
  return DEFAULT_PRIVACY_SETTINGS;
}

export function getPrivacySettings(): PrivacySettings {
  if (!cached) cached = readFromStorage();
  return cached;
}

export function savePrivacySettings(settings: PrivacySettings): void {
  cached = settings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked. The in-memory value still governs this session,
    // which is better than dropping the user's choice on the floor.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: settings }));
}

/** Call `listener` whenever this tab saves new settings; answers the unsubscribe. */
export function onPrivacySettingsSaved(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/** Drop the cache when another tab changes the settings. */
export function initPrivacySettingsSync(): () => void {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY) cached = null;
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
