/**
 * The op table: the generated `OPS` (group, op number, name, granted_by) joined with how this host
 * carries each op: which port, whether it reaches the server (and so spends the server bucket too),
 * and which clock bounds it. The one place the dispatcher, the worker's remote invoker and the main
 * thread's re-check all read. The binding is keyed by op name and typed exhaustively, so an op the
 * SDK adds fails the type check here until it is bound.
 */
import type { AbiGroup } from './abi';
import type { CborMap } from './cbor';
import type { Capability } from './capabilities';
import { KV_BACKEND_CAPABILITY, OPS } from '../sdk/generated/AbiConstants';
import type { KvBackend } from '../sdk/generated/KvBackend';
import type { ServeOn } from '../sdk/generated/ServeOn';
import type { Transport } from '../sdk/generated/Transport';
import { callPlan, servePlan } from './ihttp-planes';
import type { OpName } from './op-args';
import type { HostPorts, PortKey, PortReply } from './ports';
import { classifyDocumentLink, type DocumentLinkTarget } from '@/lib/document-links';

export type OpClock = 'port' | 'host_net' | 'server_net';

/** `host`: carried by the host itself (navigation's classification, the ihttp router). */
type Carrier = PortKey | 'host';

interface Binding {
  readonly port: Carrier;
  /** true, false, or decided by the KV backend (`local` stays on the machine). */
  readonly server: boolean | 'kv';
  readonly clock: OpClock;
}

const local = (port: PortKey): Binding => ({ port, server: false, clock: 'port' });
const server = (port: PortKey): Binding => ({ port, server: true, clock: 'port' });
const kv: Binding = { port: 'storage', server: 'kv', clock: 'port' };

const BINDINGS: { readonly [N in OpName]: Binding } = {
  CanvasMeasure: local('canvas'), CanvasDraw: local('canvas'), MeasureText: local('canvas'),
  SetToolbar: local('ui'), OpenMenu: local('ui'), ShowDialog: local('ui'), ShowToast: local('ui'), RequestHeight: local('ui'),
  Subscribe: local('events'), RequestFrames: local('events'),
  NavigateOpen: local('navigate'),
  NodeGet: server('nodes'), NodeChildren: server('nodes'), NodeReadMdx: server('nodes'),
  NodeCreate: server('nodes'), NodeRename: server('nodes'), NodeMove: server('nodes'),
  MdReadZone: server('md'), MdReplaceZone: server('md'), MdAppend: server('md'),
  FilesList: server('files'), FilesRead: server('files'), FilesWrite: server('files'), FilesDelete: server('files'),
  ChatRecent: server('chat'), ChatSend: server('chat'),
  MembersList: server('members'),
  KvGet: kv, KvSet: kv, KvSetMany: kv, KvDelete: kv, KvList: kv, KvListAuthored: server('storage'),
  BlobPut: server('blob'), BlobGet: server('blob'), BlobDelete: server('blob'),
  StoreFileWrite: server('storeFiles'), StoreFileRead: server('storeFiles'), StoreFileList: server('storeFiles'),
  HostFetch: { port: 'hostNet', server: false, clock: 'host_net' },
  HostFetchOpen: { port: 'hostNet', server: false, clock: 'host_net' },
  NetStreamRead: { port: 'hostNet', server: false, clock: 'host_net' },
  NetStreamClose: local('hostNet'),
  ServerFetch: { port: 'serverNet', server: true, clock: 'server_net' },
  IhttpServe: server('ihttp'), IhttpCall: server('ihttp'), IhttpRespond: local('ihttp'),
  IhttpConsumed: { port: 'host', server: false, clock: 'port' },
  ClipboardReadText: local('clipboard'), ClipboardWriteText: local('clipboard'),
  Notify: local('notify'),
  DocOpen: server('documents'), DocApply: server('documents'), DocPull: server('documents'),
  TopicOpen: server('topic'), TopicPublish: server('topic'), TopicClose: server('topic'),
  LogWrite: local('log'),
};

export interface OpEntry {
  readonly group: AbiGroup;
  readonly op: number;
  readonly name: OpName;
  readonly port: Carrier;
  readonly clock: OpClock;
  /** Whether `held` admits the call: any one of the op's `granted_by` (Kv* ops: their backend's). Args are already schema-checked. */
  readonly admits: (args: CborMap, held: ReadonlySet<Capability>) => boolean;
  readonly server: (args: CborMap) => boolean;
}

/**
 * Beyond `granted_by`: the plane an ihttp call or advertisement names needs its own capability
 * (ihttp-planes.ts). Every other op is decided by `granted_by` alone.
 */
function planeAdmits(name: OpName, args: CborMap, held: ReadonlySet<Capability>): boolean {
  if (name === 'IhttpCall') return callPlan(args.transport as Transport, held) !== null;
  if (name === 'IhttpServe') return servePlan(args.on as ServeOn, held).kind !== 'ungranted';
  return true;
}

/** The capability a Kv* op's backend names, from KV_BACKEND_CAPABILITY, by the backend's tag. */
export function kvCapability(backend: KvBackend): Capability {
  if (typeof backend === 'string') return KV_BACKEND_CAPABILITY[backend];
  return 'node' in backend ? KV_BACKEND_CAPABILITY.node : KV_BACKEND_CAPABILITY.node_authored;
}

const entries: OpEntry[] = OPS.map((o): OpEntry => {
  const b: Binding = BINDINGS[o.name];
  const grantedBy: readonly Capability[] | null = o.granted_by;
  return {
    group: o.group, op: o.op, name: o.name, port: b.port, clock: b.clock,
    admits: (args: CborMap, held: ReadonlySet<Capability>): boolean =>
      (grantedBy ?? [kvCapability(args.backend as KvBackend)]).some((c: Capability) => held.has(c)) && planeAdmits(o.name, args, held),
    server: (args: CborMap): boolean => (b.server === 'kv' ? args.backend !== 'local' : b.server),
  };
});

const BY_KEY: ReadonlyMap<string, OpEntry> = new Map(entries.map((e: OpEntry) => [`${e.group}/${e.op}`, e]));
const BY_NAME: ReadonlyMap<OpName, OpEntry> = new Map(entries.map((e: OpEntry) => [e.name, e]));

export function findOp(group: AbiGroup, op: number): OpEntry | undefined {
  return BY_KEY.get(`${group}/${op}`);
}

/** The entry of a generated op name; every generated name has one (op-table.test.ts). */
export function findOpByName(name: OpName): OpEntry {
  const entry: OpEntry | undefined = BY_NAME.get(name);
  if (entry === undefined) throw new Error(`${name} is not an op of this ABI`);
  return entry;
}

/** Internal links only: anything classifyDocumentLink does not call internal is refused. */
export function navigateTarget(href: string, currentUrl: string): string | null {
  const target: DocumentLinkTarget = classifyDocumentLink(href, currentUrl);
  return target.kind === 'internal' ? target.to : null;
}

type AnyHandler = (args: CborMap) => PortReply;

/** Carries an op to its injected port; undefined when that port is not injected. */
export function invokePort(ports: HostPorts, entry: OpEntry, args: CborMap): PortReply | undefined {
  if (entry.port === 'host') return { ok: null };
  if (entry.name === 'NavigateOpen') {
    const nav: HostPorts['navigate'] = ports.navigate;
    if (nav === undefined) return undefined;
    const to: string | null = navigateTarget(args.href as string, nav.currentUrl());
    return to === null ? { refused: { policy: 'not_an_internal_link' } } : nav.open(to);
  }
  if (entry.name === 'IhttpRespond') {
    const ihttp: HostPorts['ihttp'] = ports.ihttp;
    return ihttp === undefined ? undefined : ihttp.respond(args.peer as never, args.frame as never);
  }
  const port: Readonly<Record<string, AnyHandler>> | undefined = ports[entry.port] as unknown as Readonly<Record<string, AnyHandler>> | undefined;
  return port?.[entry.name]?.(args);
}
