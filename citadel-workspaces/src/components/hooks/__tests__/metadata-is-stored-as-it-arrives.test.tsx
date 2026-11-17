/**
 * `workspace.metadata` holds what the wire sent, not what we parsed out of it.
 *
 * `WorkspaceState.workspace.metadata` is `WorkspaceMetadataBytes` and its type
 * file says why at length: the wire type is `Vec<u8>`, the context once
 * declared it `Record<string, any>` instead, and that broke `getWorkspaceLogo`,
 * which tested `metadata.logo` on a byte array so every workspace fell back to
 * initials.
 *
 * The declaration was true and the writer was not: `useWorkspaceEventSetup`
 * stored the JSON it had parsed to compute `initialized`. Nothing caught it
 * because the two state interfaces were bridged by `state as WorkspaceState` —
 * remove the cast and the mismatch is a compile error, which is how it was
 * found.
 *
 * `deserializeTheme` tolerates both shapes, so this was a lie rather than a
 * breakage. A field whose declared type is false is one dotted-property away
 * from being a breakage again.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { useWorkspaceEventSetup } from '../useWorkspaceEventSetup';
import { deserializeTheme, serializeTheme } from '@/lib/theme/theme-serialization';
import { defaultTheme } from '@/lib/theme/presets';
import type { WorkspaceEventState } from '../../WorkspaceEventHandler';

vi.mock('@/lib/workspace-service', () => ({ default: {} }));
// The handler continues asynchronously into the user service, which reads
// IndexedDB. Unmocked, that rejection lands after the test has finished and
// vitest reports it as an unhandled error while every assertion still passes --
// green tests beside a non-zero exit.
vi.mock('@/lib/user-service', () => ({
  userService: { getCurrentUser: async (): Promise<null> => null },
  default: { getCurrentUser: async (): Promise<null> => null },
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<null> => null,
  getTabData: async (): Promise<null> => null,
  setTabData: async (): Promise<void> => {},
}));

/** A theme envelope as it arrives: JSON, encoded to bytes. */
function bytesOf(document: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(document)));
}

function harness(): { state: () => Partial<WorkspaceEventState> } {
  let current: Partial<WorkspaceEventState> = {
    loading: { workspace: false, members: false, nodes: false },
  };
  const setState = (update: unknown): void => {
    current = typeof update === 'function'
      ? (update as (p: Partial<WorkspaceEventState>) => Partial<WorkspaceEventState>)(current)
      : (update as Partial<WorkspaceEventState>);
  };
  renderHook(() => useWorkspaceEventSetup({ setState: setState as never }));
  return { state: (): Partial<WorkspaceEventState> => current };
}

describe('workspace metadata in state', () => {
  it('is the bytes that arrived, not the parse', async () => {
    const h: ReturnType<typeof harness> = harness();
    const metadata: number[] = bytesOf({ initialized: true, note: 'hello' });

    await act(async (): Promise<void> => {
      eventEmitter.emit('workspace:loaded', {
        workspace: { id: 'w1', name: 'W', metadata },
        connection: {},
      });
      await Promise.resolve();
    });

    expect(Array.isArray(h.state().workspace?.metadata)).toBe(true);
    expect(h.state().workspace?.metadata).toEqual(metadata);
  });

  it('still reads initialized out of those bytes', async () => {
    // The positive control: storing the bytes must not cost the thing the
    // parse was for.
    const h: ReturnType<typeof harness> = harness();

    await act(async (): Promise<void> => {
      eventEmitter.emit('workspace:loaded', {
        workspace: { id: 'w1', name: 'W', metadata: bytesOf({ initialized: true }) },
        connection: {},
      });
      await Promise.resolve();
    });

    expect(h.state().needsWorkspaceInitialization).toBe(false);
  });

  it('leaves the theme readable from what is stored', () => {
    // The consumer's whole job: bytes in, theme out.
    //
    // `serializeTheme` and `deserializeTheme` are NOT inverses, deliberately.
    // The first produces the envelope the SERVER merges into the metadata
    // document under a `theme` key; the second reads that whole document. Its
    // docstring says so, and a round-trip test written without reading it fails
    // and looks exactly like broken theming.
    const envelope: unknown = JSON.parse(
      new TextDecoder().decode(serializeTheme(defaultTheme())),
    );
    const asStoredByTheServer: number[] = bytesOf({ initialized: true, theme: envelope });

    expect(deserializeTheme(asStoredByTheServer)).not.toBeNull();
  });

  it('does not read a theme out of a document that has none', () => {
    // The positive control: metadata is shared, and initialisation writes into
    // it. A reader that returned a theme for any object would apply one to a
    // workspace that never chose it.
    expect(deserializeTheme(bytesOf({ initialized: true }))).toBeNull();
  });
});
