/**
 * A body of the agent's generated `InternalServiceRequest`, read off the binding rather than
 * restated: `AgentRequestBody<'Connect'>` is exactly what the agent deserializes for a Connect.
 */
import type { InternalServiceRequest, RequestType } from 'citadel-workspace-client-ts';

export type AgentRequestBody<K extends RequestType> = Extract<InternalServiceRequest, Record<K, unknown>>[K];
