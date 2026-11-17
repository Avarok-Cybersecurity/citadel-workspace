/**
 * One chat's Advanced settings: the encryption level and message retention an
 * account chose for one peer.
 *
 * Chat settings -> Advanced offered both with nothing behind them. They are
 * read from here by the code that keeps them. The level is dormant: no
 * control sets it above Standard until the SDK can honour it (see
 * ChatSettingsAdvanced), so every reader below sees the default.
 *
 *   securityLevel  P2POperations.openP2PConnection (the level the channel is
 *                  keyed at), incoming-connect (offers below it are declined),
 *                  and the message send path (each message's layer count).
 *   retention      retention-sweep, on opening the chat and on a timer.
 *
 * Scoped by account AND peer, like the file-transfer settings: several
 * accounts share this browser, and one account's choice must not become
 * another's.
 *
 * Kept in localStorage, like the file-transfer and privacy settings, and for
 * the reason those are: the send path reads it on every message, and an
 * IndexedDB read can stall on a follower tab under contention (see
 * current-cid) -- which here would stall every send. localStorage is shared by
 * every tab, so the leader, which opens channels for the others, reads the
 * same answer. The values are strings and numbers; nothing here is a BigInt.
 */
import { higherLevel } from './security-level-rank';

/**
 * The levels a chat can promise. The SDK also has `Ultra` and `Custom(n)`, but
 * the WASM message path (`parse_security_level`) knows only these four and
 * sends anything else at Standard -- offering Ultra would be offering a label.
 */
export type ChatSecurityLevel = 'Standard' | 'Reinforced' | 'High' | 'Extreme';
export const CHAT_SECURITY_LEVELS: readonly ChatSecurityLevel[] = ['Standard', 'Reinforced', 'High', 'Extreme'];

/** Days a message is kept on this device, or every message kept. */
export type RetentionDays = 1 | 7 | 30 | 90 | 365;
export type Retention = RetentionDays | 'forever';
export const RETENTION_CHOICES: readonly Retention[] = ['forever', 1, 7, 30, 90, 365];

export interface ChatAdvancedSettings {
  securityLevel: ChatSecurityLevel;
  retention: Retention;
}

/** What a chat nothing was chosen for does: exactly what every chat did before. */
export const DEFAULT_CHAT_ADVANCED_SETTINGS: Readonly<ChatAdvancedSettings> = {
  securityLevel: 'Standard',
  retention: 'forever',
};

/** The storage the settings live in; localStorage in production. */
export interface ChatSettingsStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: ChatAdvancedSettings): Promise<void>;
}

function keyFor(ownCid: bigint, peerCid: bigint): string {
  return `chat-advanced:${ownCid.toString()}:${peerCid.toString()}`;
}

/**
 * Field by field. An absent field is the default -- nothing was chosen. A
 * level this build cannot keep is an error, not Standard: quietly lowering a
 * chat's encryption is the one wrong answer. A retention period it does not
 * know keeps everything, the side that loses nothing.
 */
function parse(stored: unknown): ChatAdvancedSettings {
  const record: Record<string, unknown> = typeof stored === 'object' && stored !== null ? stored as Record<string, unknown> : {};
  const level: ChatSecurityLevel | undefined = CHAT_SECURITY_LEVELS.find((l: ChatSecurityLevel): boolean => l === record.securityLevel);
  if (record.securityLevel !== undefined && level === undefined) {
    throw new Error(`This chat's saved encryption level (${String(record.securityLevel)}) is not one this version can use`);
  }
  const retention: Retention | undefined = RETENTION_CHOICES.find((r: Retention): boolean => r === record.retention);
  return {
    securityLevel: level ?? DEFAULT_CHAT_ADVANCED_SETTINGS.securityLevel,
    retention: retention ?? DEFAULT_CHAT_ADVANCED_SETTINGS.retention,
  };
}

export class ChatAdvancedSettingsStore {
  private readonly storage: ChatSettingsStorage;

  constructor(storage: ChatSettingsStorage) {
    this.storage = storage;
  }

  async get(ownCid: bigint, peerCid: bigint): Promise<ChatAdvancedSettings> {
    return parse(await this.storage.get(keyFor(ownCid, peerCid)));
  }

  /** An unreadable stored record is replaced: this is the user choosing again. */
  async set(ownCid: bigint, peerCid: bigint, change: Partial<ChatAdvancedSettings>): Promise<ChatAdvancedSettings> {
    const current: ChatAdvancedSettings = await this.get(ownCid, peerCid).catch((): ChatAdvancedSettings => ({ ...DEFAULT_CHAT_ADVANCED_SETTINGS }));
    const next: ChatAdvancedSettings = parse({ ...current, ...change });
    await this.storage.put(keyFor(ownCid, peerCid), next);
    return next;
  }

  /**
   * The level to open a channel between `initiator` and `target` at.
   *
   * Both directions are read because the leader opens channels on behalf of
   * the other session when both are in this browser: opening at only the
   * initiator's choice would have the target decline it, and nobody else would
   * open it. For a peer in another browser the reverse key is simply absent.
   */
  async openingLevel(initiator: bigint, target: bigint): Promise<ChatSecurityLevel> {
    const [ours, theirs] = await Promise.all([this.get(initiator, target), this.get(target, initiator)]);
    return higherLevel(ours.securityLevel, theirs.securityLevel);
  }
}

/**
 * A stored value that is not JSON throws rather than reading as the defaults:
 * for a security setting, "unreadable" must not quietly become "Standard".
 */
const localStorageBacked: ChatSettingsStorage = {
  get: async (key: string): Promise<unknown> => {
    const raw: string | null = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  },
  put: async (key: string, value: ChatAdvancedSettings): Promise<void> => {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

export const chatAdvancedSettings: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(localStorageBacked);
