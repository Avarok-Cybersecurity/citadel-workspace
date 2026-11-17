/**
 * The version of the server-identity upgrade (control/identity-upgrade.mjs) and which registry
 * rows it has yet to reach. Read by the registry's queries (store.mjs) and by deploy.sh, which
 * waits for none to remain, so both name the same rows.
 *
 * 1: the object's provisioning record names its domains (`[identity]`) and it holds a server key
 * seed (batch 1116 lane I4). An object provisioned before then has neither and cannot start.
 */
export const IDENTITY_VERSION = 1;

/**
 * A row whose object may predate the current version. A pending row is not one: its object is
 * visited once it is active (a Checkout completed), and an expired reservation never is.
 */
export const IDENTITY_PENDING = `status != 'pending' AND identity_version < ${IDENTITY_VERSION}`;
