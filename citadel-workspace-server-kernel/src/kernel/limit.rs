//! A usage limit as the host states it (entitlements v2, design revision 2 R1): a number, or an
//! explicit `null` meaning "no limit" for an unlimited tenant.
//!
//! "No limit" is only ever what the host said. A limit the host left out, or wrote as anything
//! but a count or `null`, is refused rather than read as either answer: whoever cannot read a
//! limit grants nothing. A host that predates v2 sends counts only, which read exactly as before.

use citadel_sdk::prelude::StorageQuota;
use serde::de::{self, Deserializer, Visitor};
use serde::{Deserialize, Serialize, Serializer};
use std::fmt;

/// One usage limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limit {
    /// At most this many.
    At(u32),
    /// The host said there is none.
    Unlimited,
}

impl Limit {
    /// The limit as the wire carries it: `None` is "no limit".
    pub fn ceiling(self) -> Option<u32> {
        match self {
            Self::At(max) => Some(max),
            Self::Unlimited => None,
        }
    }
}

impl Serialize for Limit {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::At(max) => serializer.serialize_u32(*max),
            Self::Unlimited => serializer.serialize_none(),
        }
    }
}

struct LimitVisitor;

impl Visitor<'_> for LimitVisitor {
    type Value = Limit;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a count from 0 to 4294967295, or null for no limit")
    }

    fn visit_u64<E: de::Error>(self, n: u64) -> Result<Limit, E> {
        u32::try_from(n)
            .map(Limit::At)
            .map_err(|_| E::invalid_value(de::Unexpected::Unsigned(n), &self))
    }

    fn visit_i64<E: de::Error>(self, n: i64) -> Result<Limit, E> {
        u64::try_from(n)
            .map_err(|_| E::invalid_value(de::Unexpected::Signed(n), &self))
            .and_then(|n| self.visit_u64(n))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Limit, E> {
        Ok(Limit::Unlimited)
    }
}

/// `deserialize_any`, never `deserialize_option`: serde reads a missing field through
/// `deserialize_option` as `None`, which would turn an omitted limit into no limit at all.
impl<'de> Deserialize<'de> for Limit {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(LimitVisitor)
    }
}

/// The host's storage entitlement as it answered: `null`, nothing, an exact integer, or something
/// it should not have said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageAnswer {
    Null,
    Missing,
    Integer(i64),
    Unreadable(String),
}

/// The RE-VFS storage quota the host's answer grants: a byte count, or no limit when it said
/// `null` (an unlimited tenant). Anything else, no answer included, is refused.
pub fn storage_quota(answer: StorageAnswer) -> Result<StorageQuota, String> {
    match answer {
        StorageAnswer::Null => Ok(StorageQuota::Unlimited),
        StorageAnswer::Integer(n) if n >= 0 => Ok(StorageQuota::Bytes(n as u64)),
        StorageAnswer::Integer(n) => Err(format!("storage entitlement {n} is negative")),
        StorageAnswer::Missing => Err("the host gave no storage entitlement".to_string()),
        StorageAnswer::Unreadable(what) => {
            Err(format!("storage entitlement {what} is not a byte count"))
        }
    }
}

#[cfg(test)]
mod tests;
