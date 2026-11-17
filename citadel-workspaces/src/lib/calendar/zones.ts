/**
 * The Calendar's zones (design 3.4): a node's zone is its own `time_zone` metadata or its nearest
 * ancestor's, else the workspace's, else none; the member's display zone is what they chose in
 * `cal/settings` (storage.user), and until they choose, the Calendar asks. Nothing here falls
 * back to the device's zone on its own: following the device is one of the two answers a member
 * gives, never a default.
 */
import { decodeCbor, encodeCbor, type Decoded } from '@/lib/citadel-apps/host/cbor';
import { metadataDocument, type MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { TIME_ZONE_KEY } from '@/lib/node-tabs/tab-keys';

export type DisplayZoneChoice = { readonly kind: 'device' } | { readonly kind: 'fixed'; readonly zone: string };

export interface CalendarSettings {
  readonly displayZone: DisplayZoneChoice;
}

/** Where the member's settings live in storage.user (design 3.3.2). */
export const SETTINGS_KEY: string = 'cal/settings';
const SETTINGS_VERSION: number = 1;

export interface ZonedNode {
  readonly parent_id: string | null;
  readonly metadata: MetadataSource;
}

function zoneIn(metadata: MetadataSource): string | null {
  const value: unknown = metadataDocument(metadata)?.[TIME_ZONE_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The zone `nodeId` keeps time in, nearest first; null when neither it, its ancestors nor the workspace names one. */
export function nodeZone(nodes: Readonly<Record<string, ZonedNode>>, nodeId: string, workspace: MetadataSource): string | null {
  const seen: Set<string> = new Set();
  let at: string | null = nodeId;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const node: ZonedNode | undefined = nodes[at];
    if (node === undefined) break;
    const own: string | null = zoneIn(node.metadata);
    if (own !== null) return own;
    at = node.parent_id;
  }
  return zoneIn(workspace);
}

export function displayZoneOf(choice: DisplayZoneChoice, deviceZone: string): string {
  return choice.kind === 'device' ? deviceZone : choice.zone;
}

export function encodeSettings(settings: CalendarSettings): Uint8Array {
  const zone: Record<string, string> = settings.displayZone.kind === 'device' ? { kind: 'device' } : { kind: 'fixed', zone: settings.displayZone.zone };
  return encodeCbor({ v: SETTINGS_VERSION, display_zone: zone });
}

/** The settings, or null when the bytes are not version-1 settings (the Calendar then asks again). */
export function decodeSettings(bytes: Uint8Array): CalendarSettings | null {
  const decoded: Decoded = decodeCbor(bytes);
  if (!decoded.ok || typeof decoded.value !== 'object' || decoded.value === null) return null;
  const { v, display_zone: zone } = decoded.value as { v?: unknown; display_zone?: unknown };
  if (v !== SETTINGS_VERSION || typeof zone !== 'object' || zone === null) return null;
  const { kind, zone: name } = zone as { kind?: unknown; zone?: unknown };
  if (kind === 'device') return { displayZone: { kind: 'device' } };
  if (kind === 'fixed' && typeof name === 'string' && name !== '') return { displayZone: { kind: 'fixed', zone: name } };
  return null;
}
