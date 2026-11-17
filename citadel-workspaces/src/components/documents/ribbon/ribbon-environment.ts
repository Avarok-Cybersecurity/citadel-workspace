/**
 * What the ribbons need from the world: the engine takes comment ids, authors and dates from
 * its caller (cdoc-edit has no clock or randomness), the clipboard belongs to the browser, and
 * shortcut labels depend on the platform. The browser adapter is the only place these are read.
 */
export interface RibbonEnvironment {
  /** A comment id no other comment in the document has. */
  newCommentId(): string;
  /** Now, RFC 3339. */
  now(): string;
  /** A chosen file's bytes. */
  readBytes(file: Blob): Promise<Uint8Array>;
  /** Puts plain text on the system clipboard; rejects when the browser refuses. */
  writeClipboard(text: string): Promise<void>;
  /** The system clipboard's plain text; rejects when the browser refuses to read it. */
  readClipboard(): Promise<string>;
  /** How shortcut labels name the command key. */
  readonly modifier: 'Ctrl' | '⌘';
}

/** The async Clipboard API, which a page served without HTTPS does not have. */
function systemClipboard(): Clipboard {
  // A lib.dom type says it is always there; an insecure origin leaves it undefined.
  const clipboard: Clipboard | undefined = (navigator as { readonly clipboard?: Clipboard }).clipboard;
  if (clipboard === undefined) throw new Error('This page has no access to the clipboard.');
  return clipboard;
}

export function browserRibbonEnvironment(): RibbonEnvironment {
  const mac: boolean = /Mac|iPhone|iPad/.test(navigator.platform);
  return {
    newCommentId: (): string => crypto.randomUUID(),
    now: (): string => new Date().toISOString(),
    readBytes: async (file: Blob): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer()),
    writeClipboard: async (text: string): Promise<void> => systemClipboard().writeText(text),
    readClipboard: async (): Promise<string> => systemClipboard().readText(),
    modifier: mac ? '⌘' : 'Ctrl',
  };
}
