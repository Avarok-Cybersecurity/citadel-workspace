/**
 * A node keeps time in its own zone, else its nearest ancestor's, else the workspace's, else none,
 * never a guess; the member's display zone is the one they chose; settings round-trip and anything
 * that is not version-1 settings reads as "not chosen", so the Calendar asks rather than guesses.
 */
import { describe, expect, it } from 'vitest';
import { encodeCbor } from '@/lib/citadel-apps/host/cbor';
import { decodeSettings, displayZoneOf, encodeSettings, nodeZone, type ZonedNode } from '../zones';

const meta = (doc: Record<string, unknown> | null): number[] => (doc === null ? [] : [...new TextEncoder().encode(JSON.stringify(doc))]);

const TREE: Record<string, ZonedNode> = {
  root: { parent_id: null, metadata: meta({ app_tabs: [] }) },
  eng: { parent_id: 'root', metadata: meta({ time_zone: 'America/New_York' }) },
  platform: { parent_id: 'eng', metadata: meta(null) },
  sales: { parent_id: 'root', metadata: meta(null) },
};

describe("a node's zone", () => {
  it('is its own, else the nearest ancestor that names one', () => {
    expect(nodeZone(TREE, 'eng', meta({ time_zone: 'Europe/Paris' }))).toBe('America/New_York');
    expect(nodeZone(TREE, 'platform', meta({ time_zone: 'Europe/Paris' }))).toBe('America/New_York');
  });

  it("is the workspace's when no node on the way up names one, and none when the workspace does not either", () => {
    expect(nodeZone(TREE, 'sales', meta({ time_zone: 'Europe/Paris' }))).toBe('Europe/Paris');
    expect(nodeZone(TREE, 'sales', meta({}))).toBeNull();
    expect(nodeZone(TREE, 'sales', null)).toBeNull();
  });

  it('stops on a cycle rather than walking forever', () => {
    const loop: Record<string, ZonedNode> = { a: { parent_id: 'b', metadata: meta(null) }, b: { parent_id: 'a', metadata: meta(null) } };
    expect(nodeZone(loop, 'a', null)).toBeNull();
  });
});

describe("the member's display zone", () => {
  it('follows the device only when they said so', () => {
    expect(displayZoneOf({ kind: 'device' }, 'America/Chicago')).toBe('America/Chicago');
    expect(displayZoneOf({ kind: 'fixed', zone: 'Asia/Tokyo' }, 'America/Chicago')).toBe('Asia/Tokyo');
  });

  it('round-trips, and reads anything else as not chosen', () => {
    expect(decodeSettings(encodeSettings({ displayZone: { kind: 'fixed', zone: 'Asia/Tokyo' } }))).toEqual({ displayZone: { kind: 'fixed', zone: 'Asia/Tokyo' } });
    expect(decodeSettings(encodeSettings({ displayZone: { kind: 'device' } }))).toEqual({ displayZone: { kind: 'device' } });
    expect(decodeSettings(encodeCbor({ v: 2, display_zone: { kind: 'device' } }))).toBeNull();
    expect(decodeSettings(encodeCbor({ v: 1, display_zone: { kind: 'fixed', zone: '' } }))).toBeNull();
    expect(decodeSettings(new Uint8Array([0xff]))).toBeNull();
  });
});
