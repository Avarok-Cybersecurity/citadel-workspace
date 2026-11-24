/**
 * Everything a tenant's object holds for sign-in, in one place: the OPRF seed post-quantum
 * sign-in is started with (oprf-seed.mjs), the workspace's sign-in settings (admission.mjs), the
 * tenant's slug and the client address each of the node's connections came from, and the host
 * object the node calls.
 *
 * The node calls the host object (server-wasm sign_in.rs):
 *   loadSettings()      -> Promise<string>   the settings as JSON, `{"require_turnstile_sign_in":b}`
 *   storeSettings(json) -> Promise<void>     replace them (the kernel has checked the caller is an admin)
 *   admit(json)         -> Promise<null | {refuse, reason?}>
 *       the SDK's AdmissionContext for a FRESH sign-in, registration or recovery (a recovery-phrase
 *       sign-in is asked as "Recover"; a resume-token reconnect is never asked),
 *       `{"username","kind":"SignIn"|"Register"|"Recover","token":string|null,"remote_addr":"100.64.x.y"|null}`.
 *       null admits; `{refuse:"admission_required",challenge?}` / `{refuse:"admission_failed",reason}`,
 *       `challenge` being `{provider:"turnstile",site_key,identity}` (public; admission.mjs `needsToken`).
 * tenant-node.mjs adds one method to that object before the node gets it:
 *   openBillingPortal() -> Promise<{portal_url} | {refused}>   this tenant's billing portal (the
 *       kernel has checked the caller holds EditWorkspaceConfig; control/billing-portal.mjs)
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

/**
 * The WebAuthn relying party the node's security keys are scoped to. Required, with no default:
 * a key enrolled under one ID can never sign in under another. The node checks its shape.
 */
export function securityKeyRpId(env) {
  return required(env, "PQ_SECURITY_KEY_RP_ID");
}

/**
 * The longest, in seconds, a resume credential may live on every tenant's node: what lets a
 * dropped connection come back without the account's factors. Required, with no default; 0 is
 * the explicit "none are issued".
 */
export function resumeMaxLifetimeSecs(env) {
  const n = Number(required(env, "PQ_RESUME_MAX_LIFETIME_SECS"));
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error("PQ_RESUME_MAX_LIFETIME_SECS is a whole number of seconds, 0 for none");
  }
  return n;
}

export class TenantSignIn {
  /**
   * `random` is the CSPRNG (`crypto`); `turnstile()` the configured check and `siteKey()` the
   * widget's public site key (http.mjs config).
   */
  constructor(storage, { random, turnstile, siteKey, io }) {
    if (typeof siteKey !== "function") throw new Error("TenantSignIn needs siteKey(): the widget's public site key");
    this.storage = storage;
    this.random = random;
    this.turnstile = turnstile;
    this.siteKey = siteKey;
    this.io = io;
    this.settings = new SignInSettings(storage);
    this.seed = null;
    this.tenant = null;
    this.peers = new Map();
  }

  /**
   * The slug this object serves, from the host or path of each request it is handed (dispatch.mjs
   * `tenantFor`): what a token must have been rendered for. One object is one slug, for good.
   */
  serving(slug) {
    if (typeof slug !== "string") throw new Error("a tenant object was reached without its slug");
    if (this.tenant !== null && this.tenant !== slug) throw new Error(`this object serves ${this.tenant}, not ${slug}`);
    this.tenant = slug;
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

  /** The client address a connection came from (CF-Connecting-IP), by the node's IP for it. */
  connected(peerIp, ip) {
    if (ip) this.peers.set(peerIp, ip);
  }

  released(peerIp) {
    this.peers.delete(peerIp);
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
      siteKey: this.siteKey(),
      tenant: this.tenant,
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
