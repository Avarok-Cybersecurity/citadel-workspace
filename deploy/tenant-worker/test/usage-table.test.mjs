/**
 * The object's usage table (control/usage-table.mjs) in real Durable Object SQLite: an object made
 * before the traffic split gains its columns with what was counted then (nothing), and the split
 * persists with the rest of a period's totals.
 */
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { freeTenant } from "./helpers.mjs";
import { UsageTable } from "../control/usage-table.mjs";

const LEGACY =
  "CREATE TABLE quota_usage (period_start INTEGER PRIMARY KEY, period_end INTEGER NOT NULL, " +
  "bytes_in INTEGER NOT NULL, bytes_out INTEGER NOT NULL, frames_in INTEGER NOT NULL, " +
  "active_seconds INTEGER NOT NULL, peak_connections INTEGER NOT NULL, updated_at INTEGER NOT NULL)";

describe("usage table", () => {
  it("adds the traffic split to a table made before it, keeping the rows", async () => {
    const { object } = await freeTenant("usage-split");
    const row = await runInDurableObject(object, (_i, state) => {
      const sql = state.storage.sql;
      sql.exec("DROP TABLE IF EXISTS quota_usage");
      sql.exec(LEGACY);
      sql.exec("INSERT INTO quota_usage VALUES (100, 200, 5, 6, 1, 2, 1, 0)");
      const table = new UsageTable(sql);
      new UsageTable(sql); // a second construction finds the columns and adds nothing
      table.save({ period_start: 300, period_end: 400, bytes_in: 9, bytes_out: 9, frames_in: 1, active_seconds: 1, peak_connections: 1, relayed_p2p_bytes: 7, group_fanout_bytes: 3, turn_bytes: 11 }, 1000);
      return { old: table.load(100), next: table.load(300) };
    });
    expect(row.old).toMatchObject({ bytes_in: 5, relayed_p2p_bytes: 0, group_fanout_bytes: 0, turn_bytes: 0 });
    expect(row.next).toMatchObject({ bytes_in: 9, relayed_p2p_bytes: 7, group_fanout_bytes: 3, turn_bytes: 11 });
  });
});
