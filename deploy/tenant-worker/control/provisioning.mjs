/**
 * What a tenant's Durable Object holds from the control plane: its master password (the claim
 * code the creator was shown once), its entitlements and the name it was created with. Kept in
 * the object's own storage under one key, apart from the workspace's data.
 */

import { displayNameOf } from "./display-name.mjs";
import { sha256Hex } from "./secrets.mjs";

const KEY = "control:provisioning";
const HEX64 = /^[0-9a-f]{64}$/;

export class Provisioning {
  constructor(storage) {
    this.storage = storage;
    this.record = null;
    this.fingerprint = null;
  }

  async load() {
    this.record = (await this.storage.get(KEY)) ?? null;
    await this.#fingerprint();
  }

  ready() {
    return this.record !== null && this.record.entitlements?.status === "active";
  }

  masterPassword() {
    if (this.record === null) throw new Error("this tenant has not been provisioned");
    return this.record.master_password;
  }

  /**
   * The name the workspace was created with, or null for an object provisioned before the name
   * was passed on -- its kernel keeps the default name, as it always has.
   */
  displayName() {
    return this.record?.display_name ?? null;
  }

  /**
   * Sets the tenant's master password and name. A slug freed by an expired, never-used
   * reservation is provisioned again for its new tenant; an object whose node has ever started
   * belongs to its tenant for good and refuses another's password.
   */
  async provision({ tenant_id, master_password, entitlements, display_name }, running) {
    if (typeof tenant_id !== "string" || !HEX64.test(master_password ?? "") || typeof entitlements !== "object") {
      throw new Error("provisioning needs a tenant id, a 32-byte hex master password and entitlements");
    }
    const name = displayNameOf(display_name);
    if (name === null) throw new Error("provisioning needs a display_name the workspace can be shown by");
    const current = this.record;
    if (current && current.tenant_id !== tenant_id && (current.started || running)) {
      throw new Error("this object already serves another tenant");
    }
    this.record = {
      tenant_id,
      master_password,
      entitlements,
      display_name: name,
      started: current?.tenant_id === tenant_id && Boolean(current.started),
    };
    await this.storage.put(KEY, this.record);
    await this.#fingerprint();
  }

  /**
   * The node's kernel.toml. `bind_addr` is recorded as its address and never bound: the object
   * owns no socket. Strings are JSON-quoted, which is a TOML basic string for any name
   * `displayNameOf` admits (no control characters, no lone surrogates).
   */
  kernelConfig() {
    const lines = [`bind_addr = "127.0.0.1:0"`, `workspace_master_password = ${JSON.stringify(this.masterPassword())}`];
    const name = this.displayName();
    if (name !== null) lines.push(`workspace_name = ${JSON.stringify(name)}`);
    return lines.join("\n");
  }

  async setEntitlements(entitlements) {
    if (this.record === null) throw new Error("entitlements for a tenant that has not been provisioned");
    this.record = { ...this.record, entitlements };
    await this.storage.put(KEY, this.record);
  }

  async markStarted() {
    if (this.record.started) return;
    this.record = { ...this.record, started: true };
    await this.storage.put(KEY, this.record);
  }

  /**
   * For the object's stats: whether it is provisioned, its entitlements, and the first 8 hex of
   * SHA-256(master password) -- enough for a proof to match it against the claim code it was
   * shown, nowhere near enough to learn anything of a 256-bit secret.
   */
  summary() {
    return {
      provisioned: this.record !== null,
      entitlements: this.record?.entitlements ?? null,
      display_name: this.displayName(),
      master_password_sha256_prefix: this.fingerprint,
    };
  }

  async #fingerprint() {
    if (this.record === null) {
      this.fingerprint = null;
      return;
    }
    this.fingerprint = (await sha256Hex(this.record.master_password)).slice(0, 8);
  }
}
