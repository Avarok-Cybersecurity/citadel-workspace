//! A tenant Durable Object's stored accounts, read natively by this tree's SDK.
//!
//! The object keeps the SDK's `host_sql` tables in its own SQLite storage (server-wasm's
//! `storage.rs` is only the transport to `ctx.storage.sql`). Those rows outlive every deploy, so
//! an SDK bump must still read what the previous build wrote. [`SqliteFileHost`] serves a copy of
//! such a database to the backend through the same `SqlHost` interface the object implements,
//! on the same engine.
#![cfg(not(target_family = "wasm"))]

use citadel_sdk::prelude::{
    async_trait, HostSqlHandle, SqlHost, SqlRow, SqlStatement, SqlValue, StorageQuota,
};
use rusqlite::types::{Value, ValueRef};
use std::path::Path;
use std::sync::Mutex;

/// An in-memory SQLite database loaded from a file; the file itself is never written.
pub struct SqliteFileHost {
    conn: Mutex<rusqlite::Connection>,
}

impl SqliteFileHost {
    /// The backend handle over a copy of the database at `path`.
    pub fn handle(path: &Path) -> Result<HostSqlHandle, String> {
        Self::handle_edited(path, "")
    }

    /// As [`Self::handle`], with the SQL batch `edit` applied to the copy first.
    pub fn handle_edited(path: &Path, edit: &str) -> Result<HostSqlHandle, String> {
        let source =
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("open {}: {e}", path.display()))?;
        let mut conn = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
        rusqlite::backup::Backup::new(&source, &mut conn)
            .and_then(|backup| backup.run_to_completion(64, std::time::Duration::ZERO, None))
            .map_err(|e| format!("copy {}: {e}", path.display()))?;
        conn.execute_batch(edit).map_err(|e| format!("edit: {e}"))?;
        Ok(HostSqlHandle::new(Self {
            conn: Mutex::new(conn),
        }))
    }
}

fn bind(value: &SqlValue) -> Value {
    match value {
        SqlValue::Null => Value::Null,
        SqlValue::Integer(n) => Value::Integer(*n),
        SqlValue::Text(s) => Value::Text(s.clone()),
        SqlValue::Blob(b) => Value::Blob(b.clone()),
    }
}

fn read(value: ValueRef<'_>) -> Result<SqlValue, String> {
    Ok(match value {
        ValueRef::Null => SqlValue::Null,
        ValueRef::Integer(n) => SqlValue::Integer(n),
        ValueRef::Text(t) => {
            SqlValue::Text(String::from_utf8(t.to_vec()).map_err(|e| e.to_string())?)
        }
        ValueRef::Blob(b) => SqlValue::Blob(b.to_vec()),
        ValueRef::Real(r) => return Err(format!("unexpected REAL {r}")),
    })
}

fn run_one(
    tx: &rusqlite::Transaction<'_>,
    statement: &SqlStatement,
) -> Result<Vec<SqlRow>, String> {
    let mut stmt = tx.prepare(statement.sql).map_err(|e| e.to_string())?;
    let columns = stmt.column_count();
    let mut rows = stmt
        .query(rusqlite::params_from_iter(
            statement.params.iter().map(bind),
        ))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(
            (0..columns)
                .map(|i| read(row.get_ref(i).map_err(|e| e.to_string())?))
                .collect::<Result<SqlRow, String>>()?,
        );
    }
    Ok(out)
}

#[async_trait]
impl SqlHost for SqliteFileHost {
    /// One transaction per call, as `ctx.storage.transactionSync` gives the object.
    async fn execute(&self, statements: Vec<SqlStatement>) -> Result<Vec<Vec<SqlRow>>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let results = statements
            .iter()
            .map(|statement| run_one(&tx, statement))
            .collect::<Result<Vec<_>, String>>()?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(results)
    }

    fn storage_quota(&self) -> Result<StorageQuota, String> {
        Ok(StorageQuota::Unlimited)
    }
}
