/**
 * The Calendar's ports over a real glue instance (its real Dispatcher and gate) and fake host
 * ports, the only stand-ins: each adapter reaches the op it names with the store it names, reads
 * every page, and turns a refusal into `PortRefused`; and a call the grant does not cover is
 * refused in the page without reaching a port.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import type { HostPorts, NotifyPort, PortAnswer, StoragePort, TopicPort } from '@/lib/citadel-apps/host/ports';
import { fakeStorage, ManualClock, recordingCall, type Recorder } from '@/lib/citadel-apps/host/__tests__/fakes';
import { rosterMembersPort } from '@/lib/citadel-apps/runtime/first-party-ports';
import { treeNodesPort } from '@/lib/citadel-apps/runtime/nodes-port';
import { backendOf, calendarPorts, PortRefused, type CalendarPorts } from '../ports';

const ALL: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read', 'members.list', 'notifications', 'group.topic.subscribe', 'group.topic.publish'];

function rig(ports: HostPorts, held: Capability[] = ALL): CalendarPorts {
  return calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports, held: new Set<Capability>(held), policy: STANDARD_HOST_POLICY,
    limits: { topics: { max_msg_bytes: 1024, max_msgs_per_s: 2 }, p2p: null }, clock: new ManualClock(), pageUrl: 'https://w.example/n1',
    storageChanges: () => () => {},
  }));
}

function notifyRecorder(rec: Recorder): NotifyPort {
  return { Notify: recordingCall(rec, 'Notify', (): PortAnswer<null> => ({ ok: null })) };
}

describe("the Calendar's ports", () => {
  it('addresses each store by its backend, never by an argument the app chose for identity', () => {
    expect(backendOf({ kind: 'user' })).toBe('user');
    expect(backendOf({ kind: 'node', node: 'n1' })).toEqual({ node: { node_id: 'n1' } });
    expect(backendOf({ kind: 'authored', node: 'n1', author: null })).toEqual({ node_authored: { node_id: 'n1', author: null } });
  });

  it('reads every page of keys, then stops', async () => {
    const rec: Recorder = { calls: [] };
    const pages: Record<string, { keys: string[]; next: string | null }> = { first: { keys: ['cal/event/a'], next: 'p2' }, p2: { keys: ['cal/event/b'], next: null } };
    let at: string = 'first';
    const storage: StoragePort = { ...fakeStorage(rec), KvList: (args) => {
      rec.calls.push({ method: 'KvList', args });
      const page: { keys: string[]; next: string | null; } = pages[at] as { keys: string[]; next: string | null };
      at = page.next ?? 'done';
      return { ok: page };
    } };
    expect(await rig({ storage }).storage.keys({ kind: 'node', node: 'n1' }, 'cal/event/')).toEqual(['cal/event/a', 'cal/event/b']);
    expect(rec.calls.map((c) => (c.args as { cursor: string | null }).cursor)).toEqual([null, 'p2']);
  });

  it('refuses a page cursor that repeats instead of reading forever', async () => {
    const storage: StoragePort = { ...fakeStorage({ calls: [] }), KvListAuthored: () => ({ ok: { entries: [{ author: 'bob', key: 'cal/event/x' }], next: 'same' } }) };
    await expect(rig({ storage }).storage.authoredKeys('n1', 'cal/event/')).rejects.toMatchObject({ op: 'KvListAuthored', refused: { policy: 'cursor_repeated' } });
  });

  it('hands back the value, the members and the nodes the ports answer', async () => {
    const storage: StoragePort = { ...fakeStorage({ calls: [] }), KvGet: () => ({ ok: { value: new Uint8Array([1, 2]) } }) };
    const ports: CalendarPorts = rig({
      storage,
      members: rosterMembersPort(() => [{ username: 'amy', displayName: 'Amy', isOnline: true }]),
      nodes: treeNodesPort('Workspace', () => ({ n1: { id: 'n1', name: 'Platform', parent_id: null, children: [] } })),
    });
    expect(await ports.storage.get({ kind: 'user' }, 'cal/settings')).toEqual(new Uint8Array([1, 2]));
    expect(await ports.members()).toEqual([{ username: 'amy', display_name: 'Amy', online: true }]);
    expect(await ports.node('n1')).toEqual({ node_id: 'n1', name: 'Platform', parent_id: null, has_children: false });
    expect(await ports.children('n1')).toEqual([]);
  });

  it('throws a port refusal as PortRefused, naming the op', async () => {
    const storage: StoragePort = { ...fakeStorage({ calls: [] }), KvSet: () => ({ refused: { limit: 'quota' } }) };
    const failed: unknown = await rig({ storage }).storage.set({ kind: 'authored', node: 'n1', author: null }, 'cal/event/x', new Uint8Array([1])).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(PortRefused);
    expect(failed).toMatchObject({ op: 'KvSet', refused: { limit: 'quota' } });
  });

  it('opens, publishes on and closes a topic through the topic port', async () => {
    const rec: Recorder = { calls: [] };
    const topic: TopicPort = {
      TopicOpen: recordingCall(rec, 'TopicOpen', () => ({ ok: { name: 'cal', members: ['amy', 'bob'] } })),
      TopicPublish: recordingCall(rec, 'TopicPublish', () => ({ ok: null })),
      TopicClose: recordingCall(rec, 'TopicClose', () => ({ ok: null })),
      onEvent: () => () => {},
    };
    const ports: CalendarPorts = rig({ topic });
    expect(await ports.topics.open('cal')).toEqual(['amy', 'bob']);
    await ports.topics.publish('cal', new Uint8Array([7]));
    await ports.topics.close('cal');
    expect(rec.calls.map((c) => c.method)).toEqual(['TopicOpen', 'TopicPublish', 'TopicClose']);
  });

  it('refuses a notification the grant does not cover in the page; the port is never reached (control: granted, it is)', async () => {
    const rec: Recorder = { calls: [] };
    const without: CalendarPorts = rig({ notify: notifyRecorder(rec) }, ALL.filter((c) => c !== 'notifications'));
    await expect(without.notify('reminders', 'Standup', 'in 10 minutes')).rejects.toMatchObject({ op: 'Notify', refused: 'ungranted' });
    expect(rec.calls).toEqual([]);
    await rig({ notify: notifyRecorder(rec) }).notify('reminders', 'Standup', 'in 10 minutes');
    expect(rec.calls).toEqual([{ method: 'Notify', args: { title: 'Standup', body: 'in 10 minutes' } }]);
  });

  it('refuses the authored store to an install without storage.node.authored, though storage.node is granted', async () => {
    const rec: Recorder = { calls: [] };
    const ports: CalendarPorts = rig({ storage: fakeStorage(rec) }, ['storage.user', 'storage.node']);
    await expect(ports.storage.authoredKeys('n1', 'cal/event/')).rejects.toMatchObject({ refused: 'ungranted' });
    await expect(ports.storage.get({ kind: 'authored', node: 'n1', author: 'bob' }, 'cal/event/x')).rejects.toMatchObject({ refused: 'ungranted' });
    expect(rec.calls).toEqual([]);
  });
});
