/**
 * Where a document's edits are, from the facts the session knows: whether AutoSave is on, the
 * link, how many of this tab's edits the server has not acknowledged, whether those are
 * written to this device, and whether copies kept here are locked. Pure: the title bar shows
 * it, beforeunload asks it.
 */
import type { LinkState } from '@/lib/cdoc/collab/ports';

/** How far this device's write of the held edits has got; `unavailable`: this device keeps no copy at all. */
export type LocalWrite = 'written' | 'writing' | 'failed' | 'unavailable';

export interface SaveInputs {
  readonly autoSave: boolean;
  readonly link: LinkState;
  /** This tab's edits the server has not acknowledged. */
  readonly unacknowledged: number;
  /** Save, AutoSave turned on or a share asked for edits to go while AutoSave is off. */
  readonly syncRequested: boolean;
  readonly local: LocalWrite;
  /** The server refused this session's writes (a revoked grant, an update over the limit). */
  readonly halted: boolean;
  /** Copies of the document this device keeps are sealed and cannot be opened here. */
  readonly locked: boolean;
}

export type SaveStatus =
  /** The server holds every edit. */
  | 'saved'
  /** Edits are on their way: to the server, or (a moment) to this device's copy. */
  | 'saving'
  /** Edits are due to go, and will once the link is back. */
  | 'offline'
  /** AutoSave is off: edits are kept on this device until a Save. */
  | 'savedToDevice'
  /** Edits this device could not keep a copy of: closing the page loses them. */
  | 'unsavedOnDevice'
  /** The server refused this session's writes; the edits are kept on this device, unsent. */
  | 'refused'
  /** Copies kept on this device cannot be opened here: they are sealed and no key is to be had. */
  | 'locked';

/**
 * A write to this device in flight is `saving`, not `unsavedOnDevice`: it takes milliseconds and
 * happens on every keystroke, so calling it unsaved made the title bar flicker as people typed.
 * (Closing the page during it still warns: warnsOnUnload reads `local` itself.)
 */
export function saveStatus(inputs: SaveInputs): SaveStatus {
  const held: boolean = inputs.unacknowledged > 0;
  if (held && (inputs.local === 'failed' || inputs.local === 'unavailable')) return 'unsavedOnDevice';
  if (held && inputs.halted) return 'refused';
  if (inputs.locked) return 'locked';
  if (!held) return 'saved';
  const sending: boolean = inputs.autoSave || inputs.syncRequested;
  if (sending && inputs.link === 'down') return 'offline';
  return sending || inputs.local === 'writing' ? 'saving' : 'savedToDevice';
}

/** Closing now would lose edits: some are neither acknowledged nor written to this device. */
export function warnsOnUnload(inputs: SaveInputs): boolean {
  return inputs.unacknowledged > 0 && inputs.local !== 'written';
}

/** Save has something to do: AutoSave is off, edits are held, and the server takes them. */
export function canSave(inputs: SaveInputs): boolean {
  return !inputs.autoSave && inputs.unacknowledged > 0 && !inputs.halted;
}
