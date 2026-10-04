/** Row counts and the largest stored value per `citadel_*` table, for the proofs and the limits report. */
export function storedRows(sql) {
  const tables = [...sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'citadel_%'")].map((r) => r.name);
  return Object.fromEntries(
    tables.map((t) => {
      const hasBin = [...sql.exec(`SELECT name FROM pragma_table_info('${t}') WHERE name = 'bin'`)].length > 0;
      const size = hasBin ? "COALESCE(MAX(LENGTH(bin)), 0)" : "0";
      return [t, sql.exec(`SELECT COUNT(*) AS rows, ${size} AS max_bin_bytes FROM ${t}`).one()];
    }),
  );
}
