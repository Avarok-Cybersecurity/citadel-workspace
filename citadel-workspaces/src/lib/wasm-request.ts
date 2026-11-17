/**
 * The blessed cast across the WASM boundary.
 *
 * `InternalServiceRequest` is a nominal type from the generated bindings, and
 * the objects the app builds are structurally identical but not nominally so.
 * This cast is where that crossing happens — and it existed twice, with the
 * same body and the same doc comment, in two unrelated modules.
 *
 * One place, so a grep for it finds every crossing point. That is the whole
 * argument for the function: it is not saving code, it is keeping a list.
 */

import type { InternalServiceRequest } from 'citadel-workspace-client-ts';

export function toInternalServiceRequest(
  request: Record<string, unknown>,
): InternalServiceRequest {
  return request as unknown as InternalServiceRequest;
}
