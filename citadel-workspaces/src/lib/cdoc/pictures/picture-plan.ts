/**
 * How a document's pictures will be kept, as the shell states it before cdoc loads: the store
 * itself is loaded with the editor (`load`), so none of lib/cdoc/pictures is in the shell's
 * bundle. `none` says why the document keeps no pictures; the Insert ribbon shows it.
 */
import type { PictureAccess } from './document-pictures';

export type PicturePlan =
  | { readonly kind: 'stored'; readonly load: () => Promise<PictureAccess> }
  | { readonly kind: 'none'; readonly reason: string };
