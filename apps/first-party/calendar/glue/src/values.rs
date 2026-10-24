//! Values across the boundary, in the shapes of calendar-core's TypeScript bindings: every 64-bit
//! integer a BigInt (ts-rs writes `bigint`), every `None` a `null` (ts-rs writes `T | null`; the
//! serializer's default would be `undefined`), every map a plain object. A refusal is thrown as
//! the core's `Refusal`, `{ code, detail }`.

use calendar_core::refusal::{Refusal, RefusalCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::JsValue;

pub fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_large_number_types_as_bigints(true)
        .serialize_missing_as_null(true)
        .serialize_maps_as_objects(true);
    value.serialize(&serializer).map_err(JsValue::from)
}

/// A page value as `T`, or the `bad_value` refusal naming what did not fit.
pub fn from_js<T: DeserializeOwned>(value: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|e| refuse(Refusal::new(RefusalCode::BadValue, Some(e.to_string()))))
}

/// The thrown form of a refusal.
pub fn refuse(refusal: Refusal) -> JsValue {
    to_js(&refusal).unwrap_or_else(|e| e)
}

/// Refuses with whatever the core refused with.
pub fn refused<E: Into<Refusal>>(e: E) -> JsValue {
    refuse(e.into())
}
