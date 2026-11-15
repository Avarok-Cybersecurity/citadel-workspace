//! `stored!`: a typed encode/decode pair over the core's versioned codec for each named value, as
//! the page's `encodeX`/`decodeX`. Declared before the modules that use it.

macro_rules! stored {
    ($($t:ty: $encode:ident = $js_encode:literal, $decode:ident = $js_decode:literal;)*) => {$(
        #[wasm_bindgen(js_name = $js_encode)]
        pub fn $encode(value: wasm_bindgen::JsValue) -> Result<Vec<u8>, wasm_bindgen::JsValue> {
            Ok(calendar_core::codec::to_bytes(&$crate::values::from_js::<$t>(value)?))
        }

        #[wasm_bindgen(js_name = $js_decode)]
        pub fn $decode(bytes: &[u8]) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
            $crate::values::to_js(&calendar_core::codec::from_bytes::<$t>(bytes).map_err($crate::values::refused)?)
        }
    )*};
}
