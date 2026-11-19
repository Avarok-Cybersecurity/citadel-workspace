/**
 * workspace-protocol.ts
 *
 * Views derived from the generated citadel-workspace-types bindings. Nothing here restates a
 * Rust type: every shape is read off `WorkspaceProtocolRequest`, so a change to the enum is a
 * compile error at each sender rather than a request the server cannot parse.
 */
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import type { VariantName } from './variant-name';

type RequestVariant = Exclude<WorkspaceProtocolRequest, string>;

/** Every variant name of the generated request enum, unit variants included. */
export type RequestKey = VariantName<WorkspaceProtocolRequest>;

/** A request variant's body, read from the generated binding rather than restated. */
export type RequestBody<K extends RequestKey> = K extends Extract<WorkspaceProtocolRequest, string> ? null : Extract<RequestVariant, Record<K, unknown>>[K];

/**
 * A sent request as a test or a recorder reads it: each variant's body under its own optional
 * key. Every generated request is assignable to it, so a recorder typed with it holds exactly
 * what was sent, and reading `.CreateNode` is typed by the Rust enum.
 */
export type WorkspaceRequestView = { [K in Exclude<RequestKey, Extract<WorkspaceProtocolRequest, string>>]?: RequestBody<K> };
