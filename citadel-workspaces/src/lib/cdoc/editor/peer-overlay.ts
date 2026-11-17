/**
 * Other people's carets and selections, drawn over the pages the page view shows. The
 * collaboration wiring owns presence: it turns each peer's awareness record into a PeerView
 * (EditorController.peerView) and hands the whole set here; the page view draws it on the
 * selection and caret overlay canvases, beside the local selection, with the peer's name as a
 * label at the caret.
 */
import type { HexColor } from './model-values';
import type { PeerView } from './controller';

export interface PeerPresence {
  /** The peer's display name, drawn as the caret label. */
  readonly name: string;
  /** The peer's colour: its caret, its label's background, and its selection at reduced alpha. */
  readonly color: HexColor;
  readonly view: PeerView;
}

export interface PeerOverlay {
  /**
   * Replaces every drawn peer with `peers` (keyed by `view.client`); a peer not in the set is
   * cleared. Call it again after each awareness change and after every `pages` event, since a
   * repaint can move the rectangles of a peer whose awareness did not change.
   */
  setPeers(peers: readonly PeerPresence[]): void;
  /** Removes every peer, e.g. when the collaboration session ends. */
  clear(): void;
}
