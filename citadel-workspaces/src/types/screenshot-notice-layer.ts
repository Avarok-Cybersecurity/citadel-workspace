/**
 * The P2P wire form of "I may have taken a screenshot": one MessagingLayer
 * variant, sent in-band over the reliable path like a reaction or an edit.
 *
 * Kept out of messaging-layer.ts, which is already past the size limit; that
 * file only names the variant in its enum and union.
 *
 * An older client has no case for this type and drops it in
 * `handleMessagingLayerCommand`'s default arm; nothing is rendered.
 */
import { MessagingLayerType } from './messaging-layer';

export interface ScreenshotNoticeLayer {
  type: MessagingLayerType.ScreenshotNotice;
  /** The sender's clock when the key was seen. */
  taken_at: number;
}

export function createScreenshotNotice(takenAt: number): ScreenshotNoticeLayer {
  return { type: MessagingLayerType.ScreenshotNotice, taken_at: takenAt };
}
