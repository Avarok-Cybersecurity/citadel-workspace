/**
 * What the marketplace is given, so it draws and acts the same under test as in the app: its I/O
 * (the apps transport, the static catalogue's fetch, the clipboard, the clock) and the viewer's world (who
 * they are, the page they came from, what they may do, how many people a scope reaches).
 */
import type { InstallScope } from 'citadel-workspace-client-ts';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';
import type { Clock } from '@/lib/cdoc/collab/ports';
import type { FetchText } from '@/lib/citadel-apps/listing-model';
import type { Authority } from '@/lib/citadel-apps/scope-options';
import type { Reach } from '@/lib/citadel-apps/scope-sentence';

export interface MarketplaceDeps {
  transport: AppsTransport;
  fetchText: FetchText;
  copyText: (text: string) => Promise<void>;
  /** What the consent panel's 600 ms guard runs on. */
  clock: Clock;
}

export interface MarketplaceViewer {
  me: string;
  rootId: string;
  /** The page it was opened on (or a link named); null for none. */
  nodeId: string | null;
  nodeName: (nodeId: string) => string | null;
  /** A page's ancestors, nearest first. */
  ancestors: (nodeId: string) => readonly string[];
  authority: Authority;
  /** How far a scope reaches: people and pages below, each null when not known. */
  reach: (scope: InstallScope) => Reach;
  /** Members who can be chosen for a "chosen people" install. */
  members: readonly string[];
  /** This tab's workspace server, for links shared outside this tab; null when not known. */
  serverAddress: string | null;
  origin: string;
}

export type MarketTab = 'global' | 'workspace' | 'installed' | 'requests';
