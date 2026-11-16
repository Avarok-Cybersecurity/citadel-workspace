//! Why the Calendar did not do what an app asked through the SDK (Calendar design §3.8): the
//! error answer's body, and the HTTP status each refusal is answered with.

use alloc::string::String;
use serde::{Deserialize, Serialize};

/// Why the Calendar did not do what an app asked, as an error answer's body.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum SdkCode {
    /// The calling app runs in another member's session (the confused-deputy guard).
    CrossUser,
    /// The member refused this app, or has not been asked and could not be.
    NotConsented,
    /// The event was added by another app, or by the member.
    NotYours,
    Stale,
    NotFound,
    Invalid,
    Limit,
    /// A body or query that is not the route's.
    BadRequest,
}

impl SdkCode {
    pub fn status(self) -> u16 {
        match self {
            SdkCode::CrossUser | SdkCode::NotConsented | SdkCode::NotYours => 403,
            SdkCode::Stale => 409,
            SdkCode::NotFound => 404,
            SdkCode::Invalid => 422,
            SdkCode::Limit => 429,
            SdkCode::BadRequest => 400,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct SdkRefusal {
    pub code: SdkCode,
    /// `Stale`: the revision the event is at now.
    pub current_rev: Option<u32>,
    pub detail: Option<String>,
}

impl SdkRefusal {
    pub fn new(code: SdkCode, detail: &str) -> SdkRefusal {
        SdkRefusal {
            code,
            current_rev: None,
            detail: Some(detail.into()),
        }
    }

    pub fn stale(current_rev: u32) -> SdkRefusal {
        SdkRefusal {
            code: SdkCode::Stale,
            current_rev: Some(current_rev),
            detail: None,
        }
    }
}
