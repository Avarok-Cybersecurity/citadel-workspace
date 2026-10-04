/**
 * Admission to a tenant's sign-in and registration: the workspace's `require_turnstile_sign_in`
 * setting, the check the node's admission hook runs, and what the public discovery route says.
 *
 * The setting is kept here, in the object's key-value storage, and nowhere else. Three readers
 * share this one entry: the kernel (GetSignInSettings / UpdateSignInSettings, through the host
 * object server-wasm calls), the admission check (every sign-in and registration, before any
 * session exists) and discovery (a sign-in form, before any session exists either).
 *
 * The check fails CLOSED: with the setting on, no token, a token siteverify refuses, a siteverify
 * that cannot be reached, a Turnstile secret that is not configured and a kind it does not know
 * are all refusals. With the setting off it admits and asks no one.
 */
import { boundVerdict, siteverify } from "./turnstile.mjs";

export const SIGN_IN_SETTINGS_KEY = "control:sign-in-settings";

/**
 * The refusal codes the client reads as `reason_code` (UI lib/admission/refusal.ts), which the
 * node maps to the SDK's PqSignInAdmissionRequired (350) / PqSignInAdmissionFailed (351).
 */
export const REFUSAL = Object.freeze({ required: "admission_required", failed: "admission_failed" });
const NEEDS_TOKEN = Object.freeze({ refuse: REFUSAL.required });
const failed = (reason) => ({ refuse: REFUSAL.failed, reason });
/** Said when the check itself could not be done; the detail goes to the log only. */
export const CHECK_UNAVAILABLE = "the check could not be completed";

/** The widget's `data-action` for each kind of admission (UI lib/admission/copy.ts ADMISSION_ACTION). */
export const ACTION = Object.freeze({ SignIn: "sign-in", Register: "register" });

/** Turnstile tokens are at most 2048 characters (as control/tenants.mjs bounds them). */
const MAX_TOKEN_CHARS = 2048;

/** The setting is off until an admin turns it on: the one default, and the spec's. */
const OFF = Object.freeze({ require_turnstile_sign_in: false });

/** The settings as the kernel's `SignInSettings` has them, or a throw for anything else. */
export function signInSettingsOf(value) {
  if (!value || typeof value !== "object" || typeof value.require_turnstile_sign_in !== "boolean") {
    throw new Error("sign-in settings are { require_turnstile_sign_in: boolean }");
  }
  return { require_turnstile_sign_in: value.require_turnstile_sign_in };
}

export class SignInSettings {
  constructor(storage) {
    this.storage = storage;
    this.current = null;
  }

  async load() {
    const stored = await this.storage.get(SIGN_IN_SETTINGS_KEY);
    this.current = stored === undefined ? OFF : signInSettingsOf(stored);
  }

  /** What is stored now. Loaded before the object answers anything (worker.mjs). */
  get() {
    if (this.current === null) throw new Error("the sign-in settings were read before they were loaded");
    return this.current;
  }

  async set(value) {
    const next = signInSettingsOf(value);
    await this.storage.put(SIGN_IN_SETTINGS_KEY, next);
    this.current = next;
    return next;
  }
}

/**
 * The verdict for one admission: null to admit, else `{ refuse, reason? }` with a REFUSAL code
 * and, when failed, a reason fit to show. `required` is the setting, `turnstile` the configured
 * secret and hostnames (http.mjs `config().turnstile`, null when no secret is set), `tenant` the
 * slug the token must have been rendered for, `io.fetch` the way out, `log` where a failure's
 * detail goes (never the token).
 */
export async function admit({ required, turnstile, tenant, io, log }, { kind, token, ip }) {
  if (!required) return null;
  if (typeof token !== "string" || token.length === 0) return NEEDS_TOKEN;
  const action = Object.hasOwn(ACTION, kind) ? ACTION[kind] : null;
  if (action === null) {
    log(`admission of an unknown kind ${JSON.stringify(kind)} refused`);
    return failed(CHECK_UNAVAILABLE);
  }
  if (token.length > MAX_TOKEN_CHARS) return failed("the check's token is malformed");
  if (turnstile === null || typeof tenant !== "string") {
    log(`a sign-in check is required but ${turnstile === null ? "TURNSTILE_SECRET is not set" : "the tenant is unknown"}: refusing`);
    return failed(CHECK_UNAVAILABLE);
  }
  try {
    const detail = boundVerdict(await siteverify(io, turnstile.secret, token, ip), turnstile.hostnames, action, tenant);
    return detail === null ? null : failed(detail);
  } catch (e) {
    log(`siteverify could not be reached: ${e?.message ?? e}`);
    return failed(CHECK_UNAVAILABLE);
  }
}

/** The public discovery answer: whether a check is required here, and the widget's site key. */
export const discovery = (required, siteKey) => ({ turnstile: { required, siteKey } });
