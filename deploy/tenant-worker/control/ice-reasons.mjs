/**
 * Why no relay credentials were minted (control/ice.mjs), as the member is told. A module of its
 * own so the Node proofs (relay.mjs) can read them without the Worker's JSON imports.
 */
export const UNAVAILABLE = {
  notConfigured: "relay servers are not configured for this workspace",
  relayUsed: "this workspace's plan has used its included relay",
  rateLimited: "relay servers were requested too often; try again later",
  failed: "the relay service did not answer",
};
