/**
 * When a zone starts its app relative to its member's direct-connection answers. An app holds the
 * answers it started with, and each plane is its own write, so a zone that has not started waits
 * while the answers panel is open (peer-answering.ts) and starts once it closes. A running app is
 * never restarted for an answer: a restart leaves and rejoins its topics, and the SDK keeps a left
 * group's state, so the rejoined instance's every publish was refused (Compute Pool, UI runs
 * 40019755026 and 40035826353). And another release starts only once the last one finished closing.
 */
import { describe, expect, it } from 'vitest';
import { act, render, waitFor, type RenderResult } from '@testing-library/react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { AppZone } from '../AppZone';
import { NO_GLUE, NO_TABS } from './doubles/no-tabs';
import { AppZoneContext, zoneClaims, type AppZoneEnvironment, type AppZoneHandle, type AppZoneMount, type AppZoneRuntime, type ZoneHost } from '../app-zone-environment';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { markPeerAnswering } from '@/lib/citadel-apps/peer-answering';
import { recordPeerConsent } from '@/lib/citadel-apps/peer-for-me';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { installOf, listingOf } from '@/test/app-manifests';

const POOL: ListedApp = listedApps([listingOf({ id: 'com.acme.kanban', name: 'Kanban', version: '1.4.0' })])[0];
const GRANTED: AppInstall['granted'] = ['canvas', 'ihttp.p2p.serve', 'ihttp.p2p.call'];

interface Recorder extends AppZoneRuntime { readonly mounts: AppInstall[]; readonly closes: CloseReason[]; readonly finish: (() => void)[] }

/** `held`: closes settle only when the test lets them (finish), as one waiting on the agent does. */
function recorder(held: boolean): Recorder {
  const mounts: AppInstall[] = [];
  const closes: CloseReason[] = [];
  const finish: (() => void)[] = [];
  return {
    mounts, closes, finish, mountPane: NO_TABS, bindGlue: NO_GLUE,
    mount: (_host: ZoneHost, zone: AppZoneMount): AppZoneHandle => {
      mounts.push(zone.install);
      return {
        close: (reason: CloseReason): Promise<void> => {
          closes.push(reason);
          return held ? new Promise<void>((resolve: () => void) => { finish.push(resolve); }) : Promise.resolve();
        },
      };
    },
  };
}

function env(installs: AppInstall[], runtime: AppZoneRuntime, claims: Pick<AppZoneEnvironment, 'claim' | 'release'>): AppZoneEnvironment {
  return {
    nodeId: 'n-2', me: 'alice', ancestors: ['workspace-root'], mayInstall: 'yes', runtime,
    data: {
      listing: async () => ({ ok: true, value: POOL }),
      installs: async () => ({ ok: true, value: installs }),
      setDisabledForMe: async (_id: string, d: boolean) => ({ ok: true, value: d }),
    },
    openLink: (): void => undefined, linkUrl: (): string => '', copyText: async (): Promise<void> => undefined, ...claims,
  };
}

const page = (e: AppZoneEnvironment): JSX.Element => <AppZoneContext.Provider value={e}><AppZone app="com.acme.kanban" zone="board" height={300} /></AppZoneContext.Provider>;
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

describe('a zone and its member’s answers', () => {
  it('waits while the answers are open, then starts once, holding them all (control: closed, it starts)', async () => {
    const pool: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'answers-open', granted: GRANTED });
    const runtime: Recorder = recorder(false);
    act(() => markPeerAnswering(pool.id, true));
    try {
      render(page(env([pool], runtime, zoneClaims())));
      act(() => recordPeerConsent(pool.id, { serve: true, call: false, topics: false, at_ms: 1n }));
      act(() => recordPeerConsent(pool.id, { serve: true, call: true, topics: false, at_ms: 2n }));
      await settle();
      expect(runtime.mounts).toHaveLength(0);
    } finally {
      act(() => markPeerAnswering(pool.id, false));
    }
    await waitFor(() => expect(runtime.mounts).toHaveLength(1));
  });

  it('a running app is not restarted when its member changes an answer, nor stopped when they open them', async () => {
    const pool: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'answers-running', granted: GRANTED });
    const runtime: Recorder = recorder(false);
    act(() => recordPeerConsent(pool.id, { serve: true, call: true, topics: false, at_ms: 1n }));
    render(page(env([pool], runtime, zoneClaims())));
    await waitFor(() => expect(runtime.mounts).toHaveLength(1));
    act(() => markPeerAnswering(pool.id, true));
    try {
      act(() => recordPeerConsent(pool.id, { serve: false, call: true, topics: false, at_ms: 2n }));
      act(() => recordPeerConsent(pool.id, { serve: true, call: true, topics: false, at_ms: 3n }));
      await settle();
    } finally {
      act(() => markPeerAnswering(pool.id, false));
    }
    await settle();
    expect([runtime.mounts.length, runtime.closes]).toEqual([1, []]);
  });

  it('another release starts only once the last one finished closing (control: closed, it starts)', async () => {
    const pool: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'release-waits', granted: ['canvas'] });
    const runtime: Recorder = recorder(true);
    const claims: Pick<AppZoneEnvironment, 'claim' | 'release'> = zoneClaims();
    const view: RenderResult = render(page(env([pool], runtime, claims)));
    await waitFor(() => expect(runtime.mounts).toHaveLength(1));
    view.rerender(page(env([{ ...pool, version: '1.5.0', manifest_sha256: '2'.repeat(64) }], runtime, claims)));
    await waitFor(() => expect(runtime.closes).toEqual(['version_update']));
    await settle();
    expect(runtime.mounts).toHaveLength(1);
    act(() => { for (const done of runtime.finish.splice(0)) done(); });
    await waitFor(() => expect(runtime.mounts).toHaveLength(2));
  });
});
