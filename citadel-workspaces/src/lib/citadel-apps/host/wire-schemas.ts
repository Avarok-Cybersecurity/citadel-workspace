/**
 * Schemas for the generated wire types that op arguments are made of (shared by op-args.ts and
 * the ihttp codec). Each is typed against its generated type: drift fails the type check.
 */
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { DrawCommand } from '../sdk/generated/DrawCommand';
import type { FrameKind } from '../sdk/generated/FrameKind';
import type { HttpMethod } from '../sdk/generated/HttpMethod';
import type { HttpRequest } from '../sdk/generated/HttpRequest';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { KvBackend } from '../sdk/generated/KvBackend';
import type { RegionRole } from '../sdk/generated/RegionRole';
import type { RequestHead } from '../sdk/generated/RequestHead';
import type { ResponseHead } from '../sdk/generated/ResponseHead';
import type { Route } from '../sdk/generated/Route';
import { array, bool, bytes, float, literal, nullable, pair, str, struct, tagged, u16, u32, u64, u8, type Parsed, type Schema } from './schema';

export const httpMethod: Schema<HttpMethod> = literal('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD');
export const headers: Schema<[string, string][]> = array(pair);

export const caller: Schema<Caller> = struct<Caller>({
  username: str, cid: u64, app_id: str, install_id: str, via: literal('p2p', 'relay'),
});

export const address: Schema<Address> = tagged<Address>([], {
  user: struct<{ app_id: string; username: string }>({ app_id: str, username: str }),
  scope: struct<{ app_id: string; scope_key: string }>({ app_id: str, scope_key: str }),
});

export const requestHead: Schema<RequestHead> = struct<RequestHead>({
  method: httpMethod, path: str, query: str, headers, body_len: nullable(u64), app_id: str, scope_key: str,
});

export const responseHead: Schema<ResponseHead> = struct<ResponseHead>({ status: u16, headers, body_len: nullable(u64) });

export const frameKind: Schema<FrameKind> = tagged<FrameKind>(['End'], {
  RequestHead: requestHead,
  ResponseHead: responseHead,
  Body: struct<{ bytes: Uint8Array }>({ bytes }),
  Cancel: struct<{ reason: string }>({ reason: str }),
  Credit: struct<{ n: number }>({ n: u32 }),
});

export const ihttpFrame: Schema<IhttpFrame> = struct<IhttpFrame>({ v: u8, stream: u64, kind: frameKind });

export const route: Schema<Route> = struct<Route>({ method: httpMethod, path: str });

export const kvBackend: Schema<KvBackend> = tagged<KvBackend>(['user', 'scope', 'local'], {
  node: struct<{ node_id: string }>({ node_id: str }),
  node_authored: struct<{ node_id: string; author: string | null }>({ node_id: str, author: nullable(str) }),
});

export const httpRequest: Schema<HttpRequest> = struct<HttpRequest>({ method: httpMethod, url: str, headers, body: bytes });

const rect = { x: float, y: float, w: float, h: float } as const;

/** The CW-5 commands (canvas-ext-abi.md §1), each typed against its generated variant. */
type Variant<K extends string> = Extract<DrawCommand, Record<K, unknown>>[K];
const twoOf = <A, B>(a: Schema<A>, b: Schema<B>): Schema<[A, B]> => (v) => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x: Parsed<A> = a(v[0]);
  const y: Parsed<B> = b(v[1]);
  return x === null || y === null ? null : { v: [x.v, y.v] };
};
/** The centre and radius every circular command shares, as the generated fill_circle names them. */
const circle: { readonly [K in keyof Pick<Variant<'fill_circle'>, 'cx' | 'cy' | 'r'>]: Schema<number> } = { cx: float, cy: float, r: float };
export const regionRole: Schema<RegionRole> = literal('button', 'link', 'img', 'group');
export const region: Schema<Variant<'region'>> = struct<Variant<'region'>>({ id: str, ...rect, label: str, role: regionRole });
const canvasExtension: Readonly<Record<string, Schema<unknown>>> = {
  fill_circle: struct<Variant<'fill_circle'>>({ ...circle, color: u32 }),
  stroke_circle: struct<Variant<'stroke_circle'>>({ ...circle, line_width: float, color: u32 }),
  path: struct<Variant<'path'>>({ points: array(twoOf(float, float)), closed: bool, fill: nullable(u32), stroke: nullable(twoOf(float, u32)) }),
  arc: struct<Variant<'arc'>>({ ...circle, start: float, end: float, line_width: float, color: u32 }),
  region,
};
export const drawCommand: Schema<DrawCommand> = tagged<DrawCommand>([], {
  clear: struct<{ color: number }>({ color: u32 }),
  fill_rect: struct<{ x: number; y: number; w: number; h: number; color: number }>({ ...rect, color: u32 }),
  stroke_rect: struct<{ x: number; y: number; w: number; h: number; line_width: number; color: number }>({ ...rect, line_width: float, color: u32 }),
  line: struct<{ x1: number; y1: number; x2: number; y2: number; line_width: number; color: number }>({
    x1: float, y1: float, x2: float, y2: float, line_width: float, color: u32,
  }),
  fill_text: struct<{ x: number; y: number; text: string; px: number; color: number }>({ x: float, y: float, text: str, px: float, color: u32 }),
  ...canvasExtension,
});
