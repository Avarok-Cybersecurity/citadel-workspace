/**
 * What a tenant's Durable Object holds from the control plane: its master password (the claim
 * code the creator was shown once), its entitlements, the name it was created with and the
 * domains its server identity names (tenant-domains.mjs). Kept in
 * the object's own storage under one key, apart from the workspace's data.
 */

import { displayNameOf } from "./display-name.mjs";
import { sha256Hex } from "./secrets.mjs";
import { checkedIdentity } from "./tenant-domains.mjs";

const KEY = "control:provisioning";
const HEX64 = /^[0-9a-f]{64}$/;

/** `[identity] registration_names`, the kernel's two values (server_identity/config.rs). */
const REGISTRATION_NAMES = new Set(["require_canonical", "allow_legacy"]);

export class Provisioning {
  /** `registrationNames()` is wrangler.toml's REGISTRATION_NAMES, required and never defaulted. */
  constructor(storage, { registrationNames }) {
    this.storage = storage;
    this.registrationNames = registrationNames;
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

  /** The tenant this object was last provisioned for, or null. */
  tenantId() {
    return this.record?.tenant_id ?? null;
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
  async provision({ tenant_id, master_password, entitlements, display_name, identity }, running) {
    if (typeof tenant_id !== "string" || !HEX64.test(master_password ?? "") || typeof entitlements !== "object") {
      throw new Error("provisioning needs a tenant id, a 32-byte hex master password and entitlements");
    }
    const name = displayNameOf(display_name);
    if (name === null) throw new Error("provisioning needs a display_name the workspace can be shown by");
    const domains = checkedIdentity(identity);
    const current = this.record;
    if (current && current.tenant_id !== tenant_id && (current.started || running)) {
      throw new Error("this object already serves another tenant");
    }
    this.record = {
      tenant_id,
      master_password,
      entitlements,
      display_name: name,
      identity: domains,
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
  #registrationNames() {
    const names = this.registrationNames();
    if (!REGISTRATION_NAMES.has(names)) throw new Error(`REGISTRATION_NAMES ${JSON.stringify(names)} is not one of ${[...REGISTRATION_NAMES].join(", ")}`);
    return names;
  }

  kernelConfig() {
    const lines = [
      `bind_addr = "127.0.0.1:0"`,
      `workspace_master_password = ${JSON.stringify(this.masterPassword())}`,
      // An Avarok-hosted tenant: its creator and members were shown the platform terms.
      "require_platform_terms = true",
      // The largest file a node's chat keeps on the server (25 MiB), as a native server's
      // kernel.toml sets it. Required; the kernel refuses to start without it.
      "chat_attachment_max_bytes = 26214400",
      // How many files one node's chat keeps, as a native server's kernel.toml sets it: its index
      // is one storage value, at most 2 MB. Required too.
      "chat_attachment_max_files_per_node = 2048",
    ];
    const name = this.displayName();
    if (name !== null) lines.push(`workspace_name = ${JSON.stringify(name)}`);
    // Required: the kernel refuses to start without [identity]. An object an earlier release
    // provisioned without one is refused, never given a default name.
    const identity = this.record.identity;
    if (!identity) throw new Error("this workspace was provisioned by an earlier release, without a server identity; it does not start");
    lines.push(
      "[identity]",
      `canonical_domain = ${JSON.stringify(identity.canonical_domain)}`,
      `former_domains = ${JSON.stringify(identity.former_domains)}`,
      `discovery = "well_known"`,
      `citadel_wss = ${JSON.stringify(`wss://${identity.canonical_domain}/citadel`)}`,
      `registration_names = ${JSON.stringify(this.#registrationNames())}`,
    );
    // Last: a table takes every key after it. Required; the kernel refuses to start without it.
    lines.push(
      "[documents]",
      "max_updates_per_pull = 64",
      "snapshot_min_updates = 256",
      "max_update_bytes = 65536",
      "max_snapshot_bytes = 4194304",
      "max_awareness_bytes = 4096",
      "awareness_per_second = 10",
      "appends_per_second = 50",
      "pulls_per_second = 10",
      "compact_at_pending_bytes = 8388608",
      "max_pending_log_bytes = 33554432",
      "retain_covered_updates_seqs = 256",
      "max_clients_per_document = 4096",
      "max_request_frame_bytes = 17825792",
    );
    return lines.join("\n");
  }

  /**
   * Records the name for an object provisioned before names were passed on, from the D1 row that
   * has held it all along. Never overwrites a name the object holds; returns whether it recorded
   * one. The kernel renames a root still under the default name on its next start.
   */
  async adoptDisplayName(display_name) {
    if (this.record === null || this.record.display_name) return false;
    const name = displayNameOf(display_name);
    if (name === null) return false;
    this.record = { ...this.record, display_name: name };
    await this.storage.put(KEY, this.record);
    return true;
  }

  async setEntitlements(entitlements) {
    if (this.record === null) throw new Error("entitlements for a tenant that has not been provisioned");
    this.record = { ...this.record, entitlements };
    await this.storage.put(KEY, this.record);
  }

  /** The domains changed (a custom domain was attached): the node takes them at its next start. */
  async setIdentity(identity) {
    if (this.record === null) throw new Error("domains for a tenant that has not been provisioned");
    this.record = { ...this.record, identity: checkedIdentity(identity) };
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
