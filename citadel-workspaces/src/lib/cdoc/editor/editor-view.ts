/**
 * What an EditorSession is built from and what the page view reads of it beyond the controller
 * (editor-session.ts re-exports both).
 */
import type { CdocClient } from '../worker/cdoc-client';
import type { PageRenderer } from '../paint/page-renderer';
import type { PictureAccess } from '../pictures/document-pictures';
import type { EditorState } from './controller';
import type { PeerSet } from './peer-set';

export interface EditorSessionDeps {
  readonly client: CdocClient;
  readonly renderer: PageRenderer;
  /** Where this document's pictures are kept, or why it keeps none (lib/cdoc/pictures). */
  readonly pictures: PictureAccess;
}

/** What the page view reads beyond the controller: page geometry and the peers to draw. */
export interface EditorView {
  readonly pageSizes: Int32Array;
  readonly peers: PeerSet;
  /** The element that takes keystrokes (the IME bridge's textarea), or null to detach it. */
  attachFocus(target: (() => void) | null): void;
  /** The pages on screen: results then carry selection rectangles for those and the repainted ones. */
  setViewport(pages: readonly number[]): Promise<EditorState>;
}
