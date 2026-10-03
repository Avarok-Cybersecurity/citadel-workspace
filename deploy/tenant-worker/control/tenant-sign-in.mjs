/**
 * Everything a tenant's object holds for sign-in, in one place: the OPRF seed post-quantum
 * sign-in is started with (oprf-seed.mjs), the workspace's sign-in settings (admission.mjs), the
 * client address each of the node's connections came from, and the host object the node calls.
 *
 * The node calls the host object (server-wasm sign_in.rs):
 *   loadSettings()      -> Promise<string>   the settings as JSON, `{"require_turnstile_sign_in":b}`
 *   storeSettings(json) -> Promise<void>     replace them (the kernel has checked the caller is an admin)
 *   admit(json)         -> Promise<string|null>
 *       `{"username","kind":"SignIn"|"Register","token":string|null,"remote_addr":"a.b.c.d:p"}`;
 *       null admits, else "admission_required" / "admission_failed". This is the SDK admission
 *       hook's body: server-wasm forwards `AdmissionContext` here once the SDK exposes the hook.
 */
import { admit, SignInSettings } from "./admission.mjs";
import { required } from "./http.mjs";
import { ensureOprfSeed, replaceOprfSeed } from "./oprf-seed.mjs";

function positiveInteger(env, name) {
  const n = Number(required(env, name));
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} is a positive integer`);
  return n;
}

/**
 * The Argon2id cost clients stretch a password factor with: the vars name it, and the node
 * refuses anything below the SDK's floor (KsfParams::FLOOR, OWASP's minimum) rather than start.
 */
export function ksfParams(env) {
  return {
    memKib: positiveInteger(env, "PQ_KSF_MEM_KIB"),
    iterations: positiveInteger(env, "PQ_KSF_ITERATIONS"),
    lanes: positiveInteger(env, "PQ_KSF_LANES"),
  };
}

export class TenantSignIn {
  /** `random` is the CSPRNG (`crypto`); `turnstile()` the configured check (http.mjs config). */
  constructor(storage, { random, turnstile, io }) {
    this.storage = storage;
    this.random = random;
    this.turnstile = turnstile;
    this.io = io;
    this.settings = new SignInSettings(storage);
    this.seed = null;
    this.peers = new Map();
  }

  /** Before the object answers anything: the settings, and the seed (generated if this object has none). */
  async load() {
    await this.settings.load();
    this.seed = await ensureOprfSeed(this.storage, this.random);
  }

  /** After provisioning: a new tenant in a never-started object gets a seed of its own. */
  async provisioned(newTenant) {
    this.seed = newTenant ? await replaceOprfSeed(this.storage, this.random) : await ensureOprfSeed(this.storage, this.random);
  }

  /** The seed, for the node's start only; the object keeps no copy once the node holds it. */
  takeSeed() {
    if (this.seed === null) throw new Error("the OPRF seed was taken twice or never loaded");
    const seed = this.seed;
    this.seed = null;
    return seed;
  }

  /** The client address a connection came from (CF-Connecting-IP), by the node's address for it. */
  connected(peerAddr, ip) {
    if (ip) this.peers.set(peerAddr, ip);
  }

  released(peerAddr) {
    this.peers.delete(peerAddr);
  }

  /** Whether a check is required here now: what discovery reports (dispatch.mjs). */
  required() {
    return this.settings.get().require_turnstile_sign_in;
  }

  async admit(request) {
    const { kind, token, remote_addr } = JSON.parse(request);
    const ctx = {
      required: this.required(),
      turnstile: this.turnstile(),
      io: this.io,
      log: (detail) => console.error(`[tenant] admission: ${detail}`),
    };
    return admit(ctx, { kind, token: token ?? null, ip: this.peers.get(remote_addr) ?? null });
  }

  /** The object server-wasm's `SignInHost` binds to. */
  host() {
    return {
      loadSettings: async () => JSON.stringify(this.settings.get()),
      storeSettings: async (json) => {
        await this.settings.set(JSON.parse(json));
      },
      admit: (json) => this.admit(json),
    };
  }
}
