/**
 * The tenant object's side of payment required and of the purge (control/dunning.mjs, purge.mjs).
 *
 * Suspension: the object's entitlements say "suspended", so `provisioning.ready()` is false and
 * no socket is accepted; the sockets already open are closed with PAYMENT_REQUIRED, which the
 * client reads as "pay to continue" rather than as a network failure to retry.
 *
 * The purge: the object's storage (the node's SQL tables, the provisioning, every key) and its
 * alarm are deleted, and the instance is then reset, so nothing it holds in memory -- the node,
 * its sessions, the sign-in seed -- outlives its storage: the next request constructs the object
 * afresh from nothing, as for a slug never used.
 */

/** RFC 6455 leaves 4000-4999 to applications. */
export const PAYMENT_REQUIRED = Object.freeze({ code: 4002, reason: "payment-required" });

/** The object's open sockets, so a suspension can close them. */
export class OpenSockets {
  constructor() {
    this.open = new Set();
  }

  add(socket) {
    this.open.add(socket);
    const drop = () => this.open.delete(socket);
    socket.addEventListener("close", drop);
    socket.addEventListener("error", drop);
  }

  /** Closes every open socket with `{code, reason}`; the count closed. */
  closeAll({ code, reason }) {
    const sockets = [...this.open];
    this.open.clear();
    for (const socket of sockets) socket.close(code, reason);
    if (sockets.length) console.log(`[tenant] closed ${sockets.length} socket(s): ${reason}`);
    return sockets.length;
  }
}

/**
 * Erases the object `ctx` belongs to, for `tenantId`: refused when it was provisioned for another
 * tenant. Erasing an object already erased (a resumed purge) erases nothing more and succeeds.
 */
export async function eraseObject(ctx, provisioning, sockets, tenantId) {
  const held = provisioning.tenantId();
  if (held !== null && held !== tenantId) throw new Error(`this object serves tenant ${held}, not ${tenantId}: not purged`);
  sockets.closeAll(PAYMENT_REQUIRED);
  await ctx.storage.deleteAlarm();
  await ctx.storage.deleteAll();
  // Until the reset below, this instance answers as unprovisioned (its record is gone too).
  await provisioning.load();
  // After the RPC has answered: abort() fails whatever call is in flight on the object.
  setTimeout(() => ctx.abort("purged"), 0);
  console.log(`[tenant] purged ${tenantId}`);
}
