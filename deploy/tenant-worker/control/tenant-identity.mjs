/**
 * The tenant's server identity, as its object holds it: the 32-byte seed of its ML-DSA-65 server
 * key (stored-seed.mjs; made at provisioning and only there), and the `ServerIdentityHost`
 * server-wasm builds from it and the kernel.toml's `[identity]` (server-wasm identity.rs, the
 * kernel's `hosted_identity`). The node is started with that host and `/.well-known/citadel` is
 * that host's document, so what the node proves in a challenge and what the document publishes are
 * one identity.
 *
 * A seed is never made when one is read: a new key makes every client that pinned the old one
 * refuse the server. An object with none (provisioned before server identities) cannot start and
 * publishes no document.
 */
import { storedSeed } from "./stored-seed.mjs";

export const SERVER_KEY_SEED_KEY = "control:server-key-seed";
const SERVER_KEY_SEED = storedSeed(SERVER_KEY_SEED_KEY, "server key seed");

export class TenantIdentity {
  /**
   * `random` is the CSPRNG (`crypto`); `kernelConfig()` the node's kernel.toml (Provisioning);
   * `wasm()` the object's own wasm instance.
   */
  constructor(storage, { random, kernelConfig, wasm }) {
    this.storage = storage;
    this.random = random;
    this.kernelConfig = kernelConfig;
    this.wasm = wasm;
    this.seed = null;
    // `{host, document}` for this instance: built on first use, the document issued once.
    this.built = null;
  }

  async load() {
    this.seed = await SERVER_KEY_SEED.read(this.storage);
  }

  /**
   * At provisioning: the object's seed, made now if it has none. A new tenant in a never-started
   * object (Provisioning.provision refuses one that has started) gets a key of its own.
   */
  async provisioned(newTenant) {
    const kept = newTenant ? null : await SERVER_KEY_SEED.read(this.storage);
    this.seed = kept ?? (await SERVER_KEY_SEED.generate(this.storage, this.random));
    this.built = null;
  }

  /** The identity the node is started with. Throws when the object has no key. */
  host() {
    if (this.seed === null) {
      throw new Error("this workspace has no server key: it was provisioned before server identities, and is provisioned again to get one");
    }
    this.built ??= { host: new (this.wasm().ServerIdentityHost)(this.kernelConfig(), this.seed), document: null };
    return this.built.host;
  }

  /**
   * The `/.well-known/citadel` JSON bytes, issued at `issuedAtS` the first time this instance is
   * asked and the same bytes after; null, with a log line, when the object has no key.
   */
  document(issuedAtS) {
    if (this.seed === null) {
      console.error("[tenant] /.well-known/citadel: this workspace has no server key; answering 404");
      return null;
    }
    const host = this.host();
    this.built.document ??= host.well_known(BigInt(issuedAtS));
    return this.built.document;
  }

  /**
   * The domains changed (tenant-domains.mjs). A running node keeps the identity it started with
   * until its next start, and so does the document, so the two never disagree; a stopped one
   * takes the new domains now.
   */
  domainsChanged(running) {
    if (!running) this.built = null;
  }
}
