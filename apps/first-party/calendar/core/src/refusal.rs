//! Every way the core refuses, as one value with a stable code: what the glue throws to the page,
//! and what the page's copy is keyed by. A code is never reused for a different refusal.

use crate::codec::CodecError;
use crate::ics_import::ImportError;
use crate::propagation::PropagationError;
use crate::rrule::ExpandError;
use crate::slots::SlotError;
use crate::topic::TopicError;
use crate::tz::TzError;
use alloc::format;
use alloc::string::{String, ToString};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    /// A value that is not the type asked for (the glue's decoding of a page value).
    BadValue,
    UnknownZone,
    OutOfRange,
    BadRule,
    TooFar,
    BadRules,
    BadRange,
    TooLarge,
    NotACalendar,
    TooManyEvents,
    PrivateCannotPropagate,
    TooManyNodes,
    Malformed,
    UnknownVersion,
    Refused,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Refusal {
    pub code: RefusalCode,
    pub detail: Option<String>,
}

impl Refusal {
    pub fn new(code: RefusalCode, detail: Option<String>) -> Self {
        Refusal { code, detail }
    }
    fn bare(code: RefusalCode) -> Self {
        Refusal { code, detail: None }
    }
}

impl From<TzError> for Refusal {
    fn from(e: TzError) -> Self {
        match e {
            TzError::UnknownZone(zone) => Refusal::new(RefusalCode::UnknownZone, Some(zone)),
            TzError::OutOfRange => Refusal::bare(RefusalCode::OutOfRange),
        }
    }
}

impl From<ExpandError> for Refusal {
    fn from(e: ExpandError) -> Self {
        match e {
            ExpandError::BadRule => Refusal::bare(RefusalCode::BadRule),
            ExpandError::TooFar => Refusal::bare(RefusalCode::TooFar),
            ExpandError::Tz(e) => e.into(),
        }
    }
}

impl From<SlotError> for Refusal {
    fn from(e: SlotError) -> Self {
        match e {
            SlotError::BadRules => Refusal::bare(RefusalCode::BadRules),
            SlotError::BadRange => Refusal::bare(RefusalCode::BadRange),
            SlotError::Tz(e) => e.into(),
        }
    }
}

impl From<ImportError> for Refusal {
    fn from(e: ImportError) -> Self {
        Refusal::bare(match e {
            ImportError::TooLarge => RefusalCode::TooLarge,
            ImportError::NotACalendar => RefusalCode::NotACalendar,
            ImportError::TooManyEvents => RefusalCode::TooManyEvents,
        })
    }
}

impl From<PropagationError> for Refusal {
    fn from(e: PropagationError) -> Self {
        match e {
            PropagationError::PrivateCannotPropagate => {
                Refusal::bare(RefusalCode::PrivateCannotPropagate)
            }
            PropagationError::TooManyNodes { count } => {
                Refusal::new(RefusalCode::TooManyNodes, Some(count.to_string()))
            }
        }
    }
}

impl From<CodecError> for Refusal {
    fn from(e: CodecError) -> Self {
        match e {
            CodecError::Malformed(why) => Refusal::new(RefusalCode::Malformed, Some(why)),
            CodecError::UnknownVersion(v) => {
                Refusal::new(RefusalCode::UnknownVersion, Some(v.to_string()))
            }
            CodecError::TooLarge { bytes, max } => Refusal::new(
                RefusalCode::TooLarge,
                Some(format!("{bytes} of {max} bytes")),
            ),
        }
    }
}

impl From<TopicError> for Refusal {
    fn from(e: TopicError) -> Self {
        Refusal::bare(match e {
            TopicError::TooLarge => RefusalCode::TooLarge,
            TopicError::Refused => RefusalCode::Refused,
        })
    }
}
