/**
 * Everything an app can reach, as interfaces the page injects (SBIO): the dispatcher is pure over
 * these, tests pass fakes, and the real transports (agent KV and AppFetch, kernel
 * AppsRequest::Call, the P2P ihttp envelope) are later streams. A port that is not injected
 * answers `{refused: {unavailable: <port>}}`; nothing here has a default implementation.
 *
 * Each port method is named by its generated op and typed by the generated `OpArgs` / `OpReplies`;
 * the dispatcher has already decoded and checked the arguments. Identity, scope and storage
 * namespace are NEVER read from the arguments: the port binds them from the install record.
 */
import type { OpArgs, OpReplies } from '../sdk/generated/AbiConstants';
import type { Caller } from '../sdk/generated/Caller';
import type { HostReply } from '../sdk/generated/HostReply';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { Refused } from '../sdk/generated/Refused';
import type { TopicEvent } from '../sdk/generated/TopicEvent';
import type { OpName } from './op-args';

export type { Refused, HostReply };

export type PortAnswer<T = unknown> = HostReply<T>;

/** A port may answer at once (the canvas) or later (anything crossing a thread or a socket). */
export type PortReply<T = unknown> = PortAnswer<T> | Promise<PortAnswer<T>>;

export type OpHandler<N extends OpName> = (args: OpArgs[N]) => PortReply<OpReplies[N]>;

type Port<N extends OpName> = { readonly [K in N]: OpHandler<K> };

export type CanvasPort = Port<'CanvasMeasure' | 'CanvasDraw' | 'MeasureText'>;
export type UiPort = Port<'SetToolbar' | 'OpenMenu' | 'ShowDialog' | 'ShowToast' | 'RequestHeight'>;
export type EventsPort = Port<'Subscribe' | 'RequestFrames'>;
export type NodesPort = Port<'NodeGet' | 'NodeChildren' | 'NodeReadMdx' | 'NodeCreate' | 'NodeRename' | 'NodeMove'>;
export type MdPort = Port<'MdReadZone' | 'MdReplaceZone' | 'MdAppend'>;
export type FilesPort = Port<'FilesList' | 'FilesRead' | 'FilesWrite' | 'FilesDelete'>;
export type ChatPort = Port<'ChatRecent' | 'ChatSend'>;
export type MembersPort = Port<'MembersList'>;
/** storage.user / scope / node / node.authored / local KV; `args.backend` names which. `KvListAuthored` lists every author's keys on a node. */
export type StoragePort = Port<'KvGet' | 'KvSet' | 'KvSetMany' | 'KvDelete' | 'KvList' | 'KvListAuthored'>;
export type BlobPort = Port<'BlobPut' | 'BlobGet' | 'BlobDelete'>;
/** storage.files: the server file store under /apps/<app>/<scope>/. */
export type StoreFilesPort = Port<'StoreFileWrite' | 'StoreFileRead' | 'StoreFileList'>;
/** Egress from the member's own machine via the local agent's AppFetch; absent without an agent. */
export type HostNetPort = Port<'HostFetch' | 'HostFetchOpen' | 'NetStreamRead' | 'NetStreamClose'>;
/** Egress from the workspace server (kernel EgressFetcher), metered as bytes_in. */
export type ServerNetPort = Port<'ServerFetch'>;
/** Host-mediated; the port requires a live user gesture and refuses `{policy: "no_gesture"}`. */
export type ClipboardPort = Port<'ClipboardReadText' | 'ClipboardWriteText'>;
export type NotifyPort = Port<'Notify'>;
/** The CRDT relay; first-party key only (the install grant decides, not this port). */
export type DocumentsPort = Port<'DocOpen' | 'DocApply' | 'DocPull'>;
export type LogPort = Port<'LogWrite'>;
/** App topics over the install's own Citadel group, never a chat group (runtime/topic-port.ts). */
export type TopicPort = Port<'TopicOpen' | 'TopicPublish' | 'TopicClose'> & {
  /** Events on the topics this instance opened; returns the unsubscribe. */
  readonly onEvent: (listener: (event: TopicArrival) => void) => () => void;
};

/** One topic event for the app (AppEvent `{topic: {name, event}}`). */
export interface TopicArrival {
  readonly name: string;
  readonly event: TopicEvent;
}

/** Internal links only: the dispatcher classifies the href first and hands over a router path. */
export interface NavigatePort {
  readonly currentUrl: () => string;
  readonly open: (routerPath: string) => PortReply<null>;
}

/** One inbound internal-HTTP frame, with the caller the session (never the app) vouches for. */
export interface InboundIhttpFrame {
  readonly from: Caller;
  readonly frame: IhttpFrame;
}

export interface IhttpPort {
  /** AppsRequest::AdvertiseService (and the ILM IHTTP flag) for these routes. */
  readonly IhttpServe: OpHandler<'IhttpServe'>;
  /** A client frame to an InternalHttpServer; the session/kernel re-checks `to`. */
  readonly IhttpCall: OpHandler<'IhttpCall'>;
  /** A frame back to a peer on a stream the router admitted (responses, credit, cancels). */
  readonly respond: (peer: Caller, frame: IhttpFrame) => PortReply<null>;
  /** Inbound frames for this instance's install; returns the unsubscribe. */
  readonly onFrame: (listener: (inbound: InboundIhttpFrame) => void) => () => void;
}

export interface HostPorts {
  readonly canvas?: CanvasPort;
  readonly ui?: UiPort;
  readonly events?: EventsPort;
  readonly navigate?: NavigatePort;
  readonly nodes?: NodesPort;
  readonly md?: MdPort;
  readonly files?: FilesPort;
  readonly chat?: ChatPort;
  readonly members?: MembersPort;
  readonly storage?: StoragePort;
  readonly blob?: BlobPort;
  readonly storeFiles?: StoreFilesPort;
  readonly hostNet?: HostNetPort;
  readonly serverNet?: ServerNetPort;
  readonly ihttp?: IhttpPort;
  readonly clipboard?: ClipboardPort;
  readonly notify?: NotifyPort;
  readonly documents?: DocumentsPort;
  readonly topic?: TopicPort;
  readonly log?: LogPort;
}

export type PortKey = keyof HostPorts;
