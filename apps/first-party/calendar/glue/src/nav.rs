//! The core's grid navigation for the page (`calendar_core::nav`), so the views' days come from
//! the same civil arithmetic as recurrence and slots, not a second one in TypeScript.

use crate::values::{from_js, refuse, to_js};
use calendar_core::civil::CivilDate;
use calendar_core::nav;
use calendar_core::refusal::{Refusal, RefusalCode};
use wasm_bindgen::prelude::*;

fn within<T: serde::Serialize>(answer: Option<T>) -> Result<JsValue, JsValue> {
    let answer = answer.ok_or_else(|| refuse(Refusal::new(RefusalCode::OutOfRange, None)))?;
    to_js(&answer)
}

#[wasm_bindgen(js_name = addDays)]
pub fn add_days(date: JsValue, days: i32) -> Result<JsValue, JsValue> {
    within(from_js::<CivilDate>(date)?.add_days(i64::from(days)))
}

#[wasm_bindgen(js_name = addMonths)]
pub fn add_months(date: JsValue, months: i32) -> Result<JsValue, JsValue> {
    within(nav::add_months(from_js(date)?, i64::from(months)))
}

#[wasm_bindgen(js_name = weekOf)]
pub fn week_of(date: JsValue) -> Result<JsValue, JsValue> {
    within(nav::week_of(from_js(date)?))
}

#[wasm_bindgen(js_name = monthGrid)]
pub fn month_grid(year: i32, month: u8) -> Result<JsValue, JsValue> {
    within(nav::month_grid(year, month))
}

#[wasm_bindgen(js_name = weekdayOf)]
pub fn weekday_of(date: JsValue) -> Result<JsValue, JsValue> {
    to_js(&from_js::<CivilDate>(date)?.weekday())
}
