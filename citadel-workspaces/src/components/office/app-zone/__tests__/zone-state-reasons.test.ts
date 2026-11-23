/**
 * Each reason an app does not reach a person is told apart (zone-state.ts): a request with no
 * answer, or an unreadable one, is `failed` (try again), not "not available"; and an app that is
 * installed in the workspace, but by no install that reaches this person here, says so. Pure.
 */
import { describe, expect, it } from 'vitest';
import { zoneView, type ZoneFacts, type ZoneProps } from '../zone-state';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { installOf, listingOf } from '@/test/app-manifests';

const KANBAN: ListedApp = listedApps([listingOf({ id: 'com.acme.kanban', name: 'Kanban', version: '1.4.0', surfaces: ['node_tab'] })])[0];
const PROPS: ZoneProps = { app: 'com.acme.kanban', zone: 'tab', height: 0, floor: null };
const facts = (f: Partial<ZoneFacts>): ZoneFacts => ({
  listing: KANBAN, installs: [], me: 'alice', nodeId: 'n-2', ancestors: ['n-1'], disabledForMe: new Set(), peerForMe: new Map(), mayInstall: 'yes', ...f,
});

describe('why an app does not reach you', () => {
  it('no answer is a failure to load, not "not available" (control: a refusal is not available)', () => {
    expect(zoneView(PROPS, facts({ listing: 'failed' }), 'tab')).toEqual({ kind: 'failed' });
    expect(zoneView(PROPS, facts({ installs: 'failed' }), 'tab')).toEqual({ kind: 'failed' });
    expect(zoneView(PROPS, facts({ listing: 'unavailable' }), 'tab')).toEqual({ kind: 'not-available' });
  });

  it('installed for someone else only: elsewhere (control: installed for no one is not)', () => {
    const bobs = installOf('com.acme.kanban', { SelfOnly: 'bob' });
    expect(zoneView(PROPS, facts({ installs: [bobs] }), 'tab')).toEqual({ kind: 'install', name: 'Kanban', elsewhere: true });
    expect(zoneView(PROPS, facts({ installs: [bobs], mayInstall: 'no' }), 'tab')).toEqual({ kind: 'ask-admin', name: 'Kanban', elsewhere: true });
    expect(zoneView(PROPS, facts({ installs: [] }), 'tab')).toEqual({ kind: 'install', name: 'Kanban', elsewhere: false });
    expect(zoneView(PROPS, facts({ installs: [installOf('com.acme.other', 'Workspace')] }), 'tab')).toEqual({ kind: 'install', name: 'Kanban', elsewhere: false });
  });
});
