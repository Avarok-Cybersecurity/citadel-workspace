/**
 * The auth-record census: the tenant object's `authVersions()` RPC over rows in its own SQLite
 * (the real wasm counts them), and the monitor keeping the latest counts in D1 and warning while
 * a legacy Argon2 account remains. The records are a real stored one (the server's own row out of
 * storage-compat's 0.10.0 Durable Object fixture) with its version tag set to each version: the
 * counter reads the tag alone, and decoding the SDK's own records of each version is
 * storage-compat's test. No mock but the one at the fetch boundary (helpers.mjs `outbound`).
 */
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freeTenant, monitorOf, outbound, tenantObject, tenantRow } from "./helpers.mjs";

const TRANSIENT_RECORD =
  "000000000000000001011D00000000000000323032362D31302D30335431333A32313A35392E3638342B30303A3030000000007F00000139300001000000000000000000000000000000000000000000000000000000000000000000000000";
/** Bytes from the record's start to its auth version tag: cid, two flags, the date, the address, the empty crypto state. */
const TAG_AT = 8 + 1 + 1 + 8 + 29 + 10 + 1;
const LEGACY = 0;
const TRANSIENT = 1;
const POST_QUANTUM = 2;
const SECRET_NAME = "never-logged-user";

function record(version) {
  const bytes = Uint8Array.from(TRANSIENT_RECORD.match(/../g), (h) => parseInt(h, 16));
  new DataView(bytes.buffer).setUint32(TAG_AT, version, true);
  return bytes.buffer;
}

/** The object's account table as the SDK's backend creates it (host_sql/schema.rs), holding `blobs`. */
const seed = (slug, blobs) =>
  runInDurableObject(tenantObject(slug), (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS citadel_cnacs (cid TEXT NOT NULL PRIMARY KEY, is_personal INTEGER NOT NULL, username TEXT NOT NULL, full_name TEXT NOT NULL, creation_date TEXT NOT NULL, bin BLOB NOT NULL)");
    sql.exec("DELETE FROM citadel_cnacs");
    blobs.forEach((bin, i) => sql.exec("INSERT INTO citadel_cnacs VALUES (?, 0, ?, ?, ?, ?)", String(1000 + i), SECRET_NAME, SECRET_NAME, "2026-10-04", bin));
  });
const sampled = (tenantId) => env.CONTROL_DB.prepare("SELECT * FROM tenant_auth_versions WHERE tenant_id = ?").bind(tenantId).first();

afterEach(() => vi.restoreAllMocks());

describe("the object's census", () => {
  it("counts each stored version in its own bucket, and a row that is not a record as undecodable", async () => {
    const { slug } = await freeTenant("auth");
    await seed(slug, [record(LEGACY), record(LEGACY), record(TRANSIENT), record(POST_QUANTUM), new Uint8Array(40).fill(255).buffer]);
    expect(await tenantObject(slug).authVersions()).toEqual({ legacy_argon: 2, transient: 1, post_quantum: 1, undecodable: 1 });
  });

  it("reads zero from an object whose node never started, which has no account table", async () => {
    const { slug } = await freeTenant("authnone");
    expect(await tenantObject(slug).authVersions()).toEqual({ legacy_argon: 0, transient: 0, post_quantum: 0, undecodable: 0 });
  });

  it("changes nothing it reads", async () => {
    const { slug } = await freeTenant("authro");
    await seed(slug, [record(LEGACY)]);
    await tenantObject(slug).authVersions();
    const rows = await runInDurableObject(tenantObject(slug), (_i, state) => [...state.storage.sql.exec("SELECT COUNT(*) AS n FROM citadel_cnacs")][0].n);
    expect(rows).toBe(1);
  });
});

describe("the monitor's census", () => {
  it("keeps the latest counts per tenant in D1 and warns while a legacy account remains, naming no one", async () => {
    const { slug } = await freeTenant("authmon");
    const { tenant_id } = await tenantRow(slug);
    await seed(slug, [record(LEGACY), record(POST_QUANTUM), record(POST_QUANTUM)]);
    const warn = vi.spyOn(console, "warn");
    const log = vi.spyOn(console, "log");
    outbound();
    await monitorOf(slug)();
    expect(await sampled(tenant_id)).toMatchObject({ legacy_argon: 1, transient: 0, post_quantum: 2, undecodable: 0 });
    expect(warn.mock.calls.flat().join("\n")).toContain(`${slug}: 1 legacy Argon2 account(s) remain`);
    const said = [...warn.mock.calls, ...log.mock.calls].flat().join("\n");
    expect(said).toContain("legacy_argon=1 transient=0 post_quantum=2 undecodable=0");
    expect(said).not.toContain(SECRET_NAME);
    expect(said).not.toContain("1000");
  });

  it("overwrites the sample on the next run and stops warning once the legacy accounts are gone", async () => {
    const { slug } = await freeTenant("authgone");
    const { tenant_id } = await tenantRow(slug);
    await seed(slug, [record(LEGACY), record(POST_QUANTUM)]);
    outbound();
    const run = monitorOf(slug);
    await run();
    await seed(slug, [record(POST_QUANTUM), record(POST_QUANTUM)]);
    const warn = vi.spyOn(console, "warn");
    await run();
    expect(await sampled(tenant_id)).toMatchObject({ legacy_argon: 0, post_quantum: 2 });
    expect(warn.mock.calls.flat().join("\n")).not.toContain("legacy Argon2");
    expect((await env.CONTROL_DB.prepare("SELECT COUNT(*) AS n FROM tenant_auth_versions WHERE tenant_id = ?").bind(tenant_id).first()).n).toBe(1);
  });
});
