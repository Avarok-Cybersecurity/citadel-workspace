/**
 * The argument schema of every op, keyed by the generated op name and typed against the generated
 * `OpArgs`: a call whose arguments do not decode as the Rust type does is `bad_arguments`, here as
 * in the reference host. Exhaustive by type: a new op in the SDK fails the type check until it has
 * a schema.
 */
import type { OpArgs } from '../sdk/generated/AbiConstants';
import type { DialogAction } from '../sdk/generated/DialogAction';
import type { KvEntry } from '../sdk/generated/KvEntry';
import type { MenuItem } from '../sdk/generated/MenuItem';
import type { ServeOn } from '../sdk/generated/ServeOn';
import type { ToolbarItem } from '../sdk/generated/ToolbarItem';
import type { CborMap } from './cbor';
import { array, bool, bytes, empty, float, literal, nullable, str, struct, u32, u64, type Parsed, type Schema } from './schema';
import { address, caller, drawCommand, httpRequest, ihttpFrame, kvBackend, route } from './wire-schemas';

export type OpName = keyof OpArgs;

const s: typeof struct = struct;
const toolbarItem: Schema<ToolbarItem> = s<ToolbarItem>({ id: str, label: str, icon_name: nullable(str) });
const menuItem: Schema<MenuItem> = s<MenuItem>({ id: str, label: str });
const dialogAction: Schema<DialogAction> = s<DialogAction>({ id: str, label: str });
const kvEntry: Schema<KvEntry> = s<KvEntry>({ key: str, value: bytes });
const serveOn: Schema<ServeOn> = s<ServeOn>({ relay: bool, p2p: bool });
const transport: Schema<OpArgs['IhttpCall']['transport']> = literal('p2p', 'relay', 'prefer_p2p_then_relay');
const node = { node_id: str } as const;
const path = { path: str } as const;

export const OP_ARGS: { readonly [N in OpName]: Schema<OpArgs[N]> } = {
  CanvasMeasure: empty,
  CanvasDraw: s<OpArgs['CanvasDraw']>({ commands: array(drawCommand) }),
  MeasureText: s<OpArgs['MeasureText']>({ text: str, px: float }),
  SetToolbar: s<OpArgs['SetToolbar']>({ items: array(toolbarItem) }),
  OpenMenu: s<OpArgs['OpenMenu']>({ x: float, y: float, items: array(menuItem) }),
  ShowDialog: s<OpArgs['ShowDialog']>({ title: str, body_text: str, actions: array(dialogAction) }),
  ShowToast: s<OpArgs['ShowToast']>({ text: str }),
  RequestHeight: s<OpArgs['RequestHeight']>({ px: u32 }),
  Subscribe: s<OpArgs['Subscribe']>({ kinds: array(literal('pointer', 'key', 'wheel', 'focus', 'visibility')) }),
  RequestFrames: s<OpArgs['RequestFrames']>({ on: bool }),
  NavigateOpen: s<OpArgs['NavigateOpen']>({ href: str }),
  NodeGet: s<OpArgs['NodeGet']>(node),
  NodeChildren: s<OpArgs['NodeChildren']>(node),
  NodeReadMdx: s<OpArgs['NodeReadMdx']>(node),
  NodeCreate: s<OpArgs['NodeCreate']>({ parent_id: str, name: str }),
  NodeRename: s<OpArgs['NodeRename']>({ node_id: str, name: str }),
  NodeMove: s<OpArgs['NodeMove']>({ node_id: str, new_parent_id: str }),
  MdReadZone: empty,
  MdReplaceZone: s<OpArgs['MdReplaceZone']>({ text: str }),
  MdAppend: s<OpArgs['MdAppend']>({ text: str }),
  FilesList: s<OpArgs['FilesList']>(path),
  FilesRead: s<OpArgs['FilesRead']>({ path: str, offset: u64, len: u32 }),
  FilesWrite: s<OpArgs['FilesWrite']>({ path: str, bytes }),
  FilesDelete: s<OpArgs['FilesDelete']>(path),
  ChatRecent: s<OpArgs['ChatRecent']>({ limit: u32 }),
  ChatSend: s<OpArgs['ChatSend']>({ text: str }),
  MembersList: empty,
  KvGet: s<OpArgs['KvGet']>({ backend: kvBackend, key: str }),
  KvSet: s<OpArgs['KvSet']>({ backend: kvBackend, key: str, value: bytes }),
  KvSetMany: s<OpArgs['KvSetMany']>({ backend: kvBackend, entries: array(kvEntry) }),
  KvDelete: s<OpArgs['KvDelete']>({ backend: kvBackend, key: str }),
  KvList: s<OpArgs['KvList']>({ backend: kvBackend, prefix: str, cursor: nullable(str) }),
  KvListAuthored: s<OpArgs['KvListAuthored']>({ node_id: str, prefix: str, cursor: nullable(str) }),
  BlobPut: s<OpArgs['BlobPut']>({ bytes }),
  BlobGet: s<OpArgs['BlobGet']>({ sha256: str }),
  BlobDelete: s<OpArgs['BlobDelete']>({ sha256: str }),
  StoreFileWrite: s<OpArgs['StoreFileWrite']>({ path: str, bytes }),
  StoreFileRead: s<OpArgs['StoreFileRead']>(path),
  StoreFileList: s<OpArgs['StoreFileList']>({ prefix: str }),
  HostFetch: s<OpArgs['HostFetch']>({ request: httpRequest }),
  ServerFetch: s<OpArgs['ServerFetch']>({ request: httpRequest }),
  HostFetchOpen: s<OpArgs['HostFetchOpen']>({ request: httpRequest }),
  NetStreamRead: s<OpArgs['NetStreamRead']>({ stream: u32, max: u32 }),
  NetStreamClose: s<OpArgs['NetStreamClose']>({ stream: u32 }),
  IhttpServe: s<OpArgs['IhttpServe']>({ routes: array(route), on: serveOn }),
  IhttpRespond: s<OpArgs['IhttpRespond']>({ peer: caller, frame: ihttpFrame }),
  IhttpCall: s<OpArgs['IhttpCall']>({ to: address, frame: ihttpFrame, transport }),
  IhttpConsumed: s<OpArgs['IhttpConsumed']>({ peer: caller, stream: u64 }),
  ClipboardReadText: empty,
  ClipboardWriteText: s<OpArgs['ClipboardWriteText']>({ text: str }),
  Notify: s<OpArgs['Notify']>({ title: str, body: str }),
  DocOpen: s<OpArgs['DocOpen']>(node),
  DocApply: s<OpArgs['DocApply']>({ node_id: str, update: bytes }),
  DocPull: s<OpArgs['DocPull']>({ node_id: str, since: bytes }),
  TopicOpen: s<OpArgs['TopicOpen']>({ name: str }),
  TopicPublish: s<OpArgs['TopicPublish']>({ name: str, body: bytes }),
  TopicClose: s<OpArgs['TopicClose']>({ name: str }),
  LogWrite: s<OpArgs['LogWrite']>({ level: literal('debug', 'info', 'warn', 'error'), message: str }),
};

/** Schema-checks a call's decoded arguments; null is `bad_arguments`. */
export function parseArgs(name: OpName, value: unknown): CborMap | null {
  const parsed: Parsed<OpArgs[OpName]> = (OP_ARGS[name] as Schema<OpArgs[OpName]>)(value);
  return parsed === null ? null : (parsed.v as unknown as CborMap);
}
