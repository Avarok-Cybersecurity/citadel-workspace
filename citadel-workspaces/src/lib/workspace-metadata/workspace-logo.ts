/**
 * The workspace icon image, from the metadata's `logo` key.
 *
 * Only a WebP, PNG or JPEG data URL is ever returned, matching what the server accepts
 * (citadel-workspace-server-kernel `workspace_logo.rs`): a stored value that is anything else,
 * such as an SVG or a remote URL, would put script or a tracking request into every member's
 * switcher, so it is treated as no image at all.
 */
import { metadataDocument, type MetadataSource } from './metadata-document';

const RASTER_DATA_URL: RegExp = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

export function workspaceLogoOf(metadata: MetadataSource): string | null {
  const logo: unknown = metadataDocument(metadata)?.logo;
  return typeof logo === 'string' && RASTER_DATA_URL.test(logo) ? logo : null;
}
