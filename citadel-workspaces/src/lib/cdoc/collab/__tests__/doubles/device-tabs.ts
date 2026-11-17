/**
 * Tabs whose device storage is the production one: indexedDbDocumentCache over the
 * storage-utils stand-in the test file installs (a Map through structuredClone, as
 * document-cache.test.ts), with memoryLocks for the Web Locks API jsdom lacks. Reloading is
 * closing a tab and opening another of the same account on the same storage.
 */
import { indexedDbDocumentCache } from '../../document-cache';
import type { DocumentSessionConfig } from '../../ports';
import type { EditorSession } from '../../../editor/editor-session';
import type { DocumentsRequest } from 'citadel-workspace-client-ts';
import { newDocument, openTab, type Tab } from './harness';
import { memoryLocks, type MemoryLocks } from './memory-device';
import { realReplicas } from './real-replicas';
import type { ScriptedKernel } from './scripted-kernel';
import type { ManualClock } from './manual-clock';

export type RealTab = Tab<EditorSession>;

export interface Device {
  readonly kernel: ScriptedKernel;
  readonly clock: ManualClock;
  readonly locks: MemoryLocks;
  /** A tab of `cid` on this device, opened and settled. */
  open(cid: bigint, config: Partial<DocumentSessionConfig>): Promise<RealTab>;
  settle(...tabs: RealTab[]): Promise<void>;
  /** The Appends `cid` has sent so far. */
  appendsOf(cid: bigint): number;
}

export async function device(): Promise<Device> {
  const { kernel, clock } = await newDocument({});
  const locks: MemoryLocks = memoryLocks();
  const settle = (...tabs: RealTab[]): Promise<void> => kernel.settle(tabs.map((t: RealTab) => t.session));
  return {
    kernel,
    clock,
    locks,
    open: async (cid: bigint, config: Partial<DocumentSessionConfig>): Promise<RealTab> => {
      const tab: RealTab = openTab(kernel, clock, cid, config, realReplicas(), indexedDbDocumentCache(cid, locks));
      await tab.session.open();
      await settle(tab);
      return tab;
    },
    settle,
    appendsOf: (cid: bigint): number => kernel.requests.filter((r: { readonly cid: bigint; readonly request: DocumentsRequest }) => r.cid === cid && 'Append' in r.request).length,
  };
}
