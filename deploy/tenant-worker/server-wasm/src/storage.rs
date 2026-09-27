//! The Durable Object's SQLite storage as the node's backend.
//!
//! The shell passes an object whose `run(statements)` executes `[[sql, params], ...]` inside
//! `ctx.storage.transactionSync` and returns each statement's rows as `cursor.raw()` arrays.
//! Everything above that — schema, statements, semantics — is the SDK's `host_sql` backend,
//! the one its backend suite runs natively against SQLite.

use citadel_sdk::prelude::{
    async_trait, HostSqlHandle, SqlHost, SqlRow, SqlStatement, SqlValue, StorageQuota,
};
use js_sys::{Array, ArrayBuffer, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen]
extern "C" {
    /// The object the Durable Object hands in; see the module docs.
    pub type TenantStorage;

    #[wasm_bindgen(method, catch)]
    fn run(this: &TenantStorage, statements: Array) -> Result<Array, JsValue>;

    /// The tenant's storage entitlement in bytes, as its plan grants it now.
    #[wasm_bindgen(method, catch, js_name = quotaBytes)]
    fn quota_bytes(this: &TenantStorage) -> Result<JsValue, JsValue>;
}

/// Largest integer a JS number carries exactly.
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

struct DurableObjectSql(TenantStorage);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectSql {}
unsafe impl Sync for DurableObjectSql {}

/// The backend handle over `storage`.
pub fn backend_handle(storage: TenantStorage) -> HostSqlHandle {
    HostSqlHandle::new(DurableObjectSql(storage))
}

fn to_js(value: &SqlValue) -> Result<JsValue, String> {
    Ok(match value {
        SqlValue::Null => JsValue::NULL,
        SqlValue::Integer(n) if n.unsigned_abs() <= MAX_SAFE_INTEGER as u64 => {
            JsValue::from_f64(*n as f64)
        }
        SqlValue::Integer(n) => return Err(format!("integer {n} does not fit a JS number")),
        SqlValue::Text(text) => JsValue::from_str(text),
        SqlValue::Blob(bytes) => Uint8Array::from(bytes.as_slice()).into(),
    })
}

fn from_js(value: JsValue) -> Result<SqlValue, String> {
    if value.is_null() || value.is_undefined() {
        return Ok(SqlValue::Null);
    }
    if let Some(text) = value.as_string() {
        return Ok(SqlValue::Text(text));
    }
    if let Some(n) = value.as_f64() {
        if n.fract() != 0.0 || n.abs() > MAX_SAFE_INTEGER as f64 {
            return Err(format!("column value {n} is not an exact integer"));
        }
        return Ok(SqlValue::Integer(n as i64));
    }
    if let Some(buffer) = value.dyn_ref::<ArrayBuffer>() {
        return Ok(SqlValue::Blob(Uint8Array::new(buffer).to_vec()));
    }
    if let Some(bytes) = value.dyn_ref::<Uint8Array>() {
        return Ok(SqlValue::Blob(bytes.to_vec()));
    }
    Err(format!("unsupported column value {value:?}"))
}

fn encode(statements: &[SqlStatement]) -> Result<Array, String> {
    statements
        .iter()
        .map(|statement| {
            let params = statement
                .params
                .iter()
                .map(to_js)
                .collect::<Result<Array, String>>()?;
            Ok::<JsValue, String>(Array::of2(&JsValue::from_str(statement.sql), &params).into())
        })
        .collect()
}

fn decode(results: Array) -> Result<Vec<Vec<SqlRow>>, String> {
    results
        .iter()
        .map(|rows| {
            Array::from(&rows)
                .iter()
                .map(|row| Array::from(&row).iter().map(from_js).collect())
                .collect()
        })
        .collect()
}

#[async_trait]
impl SqlHost for DurableObjectSql {
    async fn execute(&self, statements: Vec<SqlStatement>) -> Result<Vec<Vec<SqlRow>>, String> {
        let results = self
            .0
            .run(encode(&statements)?)
            .map_err(|e| format!("durable object storage: {e:?}"))?;
        decode(results)
    }

    /// A tenant always has a plan, and every plan names its storage: there is no unlimited case.
    fn storage_quota(&self) -> Result<StorageQuota, String> {
        let bytes = self
            .0
            .quota_bytes()
            .map_err(|e| format!("durable object entitlements: {e:?}"))?;
        match from_js(bytes)? {
            SqlValue::Integer(n) if n >= 0 => Ok(StorageQuota::Bytes(n as u64)),
            other => Err(format!("storage entitlement {other:?} is not a byte count")),
        }
    }
}
