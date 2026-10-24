//! The page's time-zone database as an `OffsetSource`: one JavaScript function,
//! `(zone, utcMs) => seconds | null`, `null` for a zone the database does not know. An answer that
//! is neither is the function's fault, not the zone's, and a throw is the function's too: either
//! is kept and rethrown by the export that asked, never swallowed and never read as a zone.

use calendar_core::tz::{TzError, Zone};
use calendar_core::tz_offsets::OffsetSource;
use core::cell::RefCell;
use wasm_bindgen::JsValue;

/// No zone has ever been a day or more from UTC.
const MAX_OFFSET_S: f64 = 86_400.0;
/// The largest instant a JavaScript number holds exactly.
const MAX_SAFE_MS: u64 = (1 << 53) - 1;

pub struct JsOffsets {
    offset_at: js_sys::Function,
    fault: RefCell<Option<JsValue>>,
}

impl JsOffsets {
    pub fn new(offset_at: js_sys::Function) -> Self {
        JsOffsets {
            offset_at,
            fault: RefCell::new(None),
        }
    }

    /// The function's first fault since the last call, if it had one.
    pub fn take_fault(&self) -> Result<(), JsValue> {
        self.fault.borrow_mut().take().map_or(Ok(()), Err)
    }

    fn faulted(&self, fault: JsValue) -> TzError {
        self.fault.borrow_mut().get_or_insert(fault);
        TzError::OutOfRange
    }
}

impl OffsetSource for JsOffsets {
    fn offset_at(&self, zone: &Zone, utc_ms: i64) -> Result<i32, TzError> {
        if utc_ms.unsigned_abs() > MAX_SAFE_MS {
            return Err(TzError::OutOfRange);
        }
        let name = JsValue::from_str(zone.name());
        let at = JsValue::from_f64(utc_ms as f64);
        let answer = match self.offset_at.call2(&JsValue::NULL, &name, &at) {
            Ok(answer) => answer,
            Err(thrown) => return Err(self.faulted(thrown)),
        };
        if answer.is_null() {
            return Err(TzError::UnknownZone(zone.name().into()));
        }
        match answer.as_f64() {
            Some(s) if s.fract() == 0.0 && s.abs() < MAX_OFFSET_S => Ok(s as i32),
            _ => Err(self.faulted(
                js_sys::Error::new("offsetAt answered neither whole seconds nor null").into(),
            )),
        }
    }
}
