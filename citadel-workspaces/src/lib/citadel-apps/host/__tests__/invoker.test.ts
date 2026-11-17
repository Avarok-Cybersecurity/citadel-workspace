/**
 * The main thread's re-check of calls arriving from a worker: the worker is not trusted to have
 * gated them, so an ungranted op never reaches its port even when the port is injected.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { regrantedCall } from '../invoker';
import type { HostPorts } from '../ports';
import { fakeNodes, type Recorder } from './fakes';

describe('regrantedCall', () => {
  it('refuses an op the grant does not cover without touching the port (control: granted reaches it)', async () => {
    const rec: Recorder = { calls: [] };
    const ports: HostPorts = { nodes: fakeNodes(rec) };
    expect(regrantedCall(ports, new Set<Capability>(['nodes.read']), 'nodes', 4, { parent_id: 'n1', name: 'x' })).toEqual({ refused: 'ungranted' });
    expect(rec.calls).toEqual([]);
    expect(await regrantedCall(ports, new Set<Capability>(['nodes.read']), 'nodes', 1, { node_id: 'n1' })).toMatchObject({ ok: { node_id: 'n1', name: 'Board' } });
    expect(rec.calls.map((c) => c.method)).toEqual(['NodeGet']);
  });

  it('refuses unknown ops and arguments that do not name a capability; a missing port is unavailable', () => {
    expect(regrantedCall({}, new Set<Capability>(), 'nodes', 42, {})).toEqual({ refused: { policy: 'unknown_op' } });
    expect(regrantedCall({}, new Set<Capability>(['storage.user']), 'storage', 1, { backend: 'nope' })).toEqual({ refused: { policy: 'bad_arguments' } });
    expect(regrantedCall({}, new Set<Capability>(['storage.user']), 'storage', 1, { backend: 'user', key: 'k' })).toEqual({ refused: { unavailable: 'storage' } });
  });
});
