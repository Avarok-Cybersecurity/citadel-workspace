//! The kernel's named storage backends for apps (R4.5), pure: where a call's data lives, what
//! one may hold, and what a write would leave behind.
//!
//! Every namespace is derived from the install record (its app id and scope key) and the
//! session (the acting member), never from the call: an app names a backend and a key, and
//! nothing else about where it is stored.
//!
//! - `storage.user`: one KV per member per app and scope, at most `USER_KV_QUOTA`.
//! - `storage.scope`: one KV per app and scope, shared, at most `SCOPE_KV_QUOTA`.
//! - `storage.node`: one KV per app and scope per node, at most `NODE_KV_QUOTA` each.
//! - `storage.blob`: content-addressed blobs per app and scope, each at most `BLOB_MAX_BYTES`,
//!   together at most `BLOB_QUOTA`.
//!
//! A KV's usage is the sum of its keys' and values' lengths. Keys are at most
//! `KV_MAX_KEY_BYTES` of printable text, values at most `KV_MAX_VALUE_BYTES`; a namespace holds
//! at most `KV_MAX_KEYS` keys, so its index stays one record a Durable Object's value admits.

use citadel_app_signature::sha256;
use std::collections::BTreeMap;

pub const KV_MAX_KEY_BYTES: usize = 256;
pub const KV_MAX_VALUE_BYTES: usize = 256 * 1024;
pub const KV_MAX_KEYS: usize = 2048;
pub const USER_KV_QUOTA: u64 = 1024 * 1024;
pub const SCOPE_KV_QUOTA: u64 = 8 * 1024 * 1024;
pub const NODE_KV_QUOTA: u64 = 1024 * 1024;
pub const BLOB_MAX_BYTES: u64 = 8 * 1024 * 1024;
pub const BLOB_QUOTA: u64 = 64 * 1024 * 1024;
/// Keys one `KvList` page answers.
pub const KV_LIST_PAGE: usize = 100;
/// Entries one `KvSetMany` may write.
pub const KV_MAX_SET_MANY: usize = 64;

/// Which KV a call addresses, resolved from the install and the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Namespace {
    User(String),
    Scope,
    Node(String),
}

/// The storage one install's app has at its scope: `(app id, scope key)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageRoot {
    pub app_id: String,
    pub scope_key: String,
}

fn digest(text: &str) -> String {
    hex::encode(sha256(text.as_bytes()))
}

impl StorageRoot {
    /// The digest every key of this root is filed under. App ids and scope keys hold no
    /// newline, so the pair is unambiguous.
    pub fn id(&self) -> String {
        digest(&format!("{}\n{}", self.app_id, self.scope_key))
    }

    /// The digest of one namespace inside this root.
    pub fn namespace_id(&self, namespace: &Namespace) -> String {
        let local = match namespace {
            Namespace::User(user) => format!("u\n{user}"),
            Namespace::Scope => "s".to_string(),
            Namespace::Node(node) => format!("n\n{node}"),
        };
        digest(&format!("{}\n{local}", self.id()))
    }
}

/// The digest a key is stored under: an app's key never becomes part of a backend key.
pub fn key_id(key: &str) -> String {
    digest(key)
}

pub fn quota_of(namespace: &Namespace) -> u64 {
    match namespace {
        Namespace::User(_) => USER_KV_QUOTA,
        Namespace::Scope => SCOPE_KV_QUOTA,
        Namespace::Node(_) => NODE_KV_QUOTA,
    }
}

/// Why a storage call was not performed: the SDK's `Limit` or `Policy` reason, by name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageRefusal {
    Limit(&'static str),
    Policy(&'static str),
}

/// A key an app may use: non-empty, at most `KV_MAX_KEY_BYTES`, no control characters.
pub fn check_key(key: &str) -> Result<(), StorageRefusal> {
    if key.is_empty() || key.chars().any(char::is_control) {
        return Err(StorageRefusal::Policy("bad_key"));
    }
    if key.len() > KV_MAX_KEY_BYTES {
        return Err(StorageRefusal::Limit("key_bytes"));
    }
    Ok(())
}

/// A namespace's keys and each value's length, read and written whole.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct KvIndex {
    pub keys: BTreeMap<String, u32>,
}

impl KvIndex {
    pub fn usage(&self) -> u64 {
        self.keys
            .iter()
            .map(|(key, len)| key.len() as u64 + u64::from(*len))
            .sum()
    }

    /// The index after writing `writes` (`Some(len)` a value of that length, `None` a delete),
    /// all or nothing, within `quota`.
    pub fn apply(
        &self,
        writes: &[(&str, Option<usize>)],
        quota: u64,
    ) -> Result<KvIndex, StorageRefusal> {
        let mut next = self.clone();
        for (key, write) in writes {
            check_key(key)?;
            match write {
                Some(len) if *len > KV_MAX_VALUE_BYTES => {
                    return Err(StorageRefusal::Limit("value_bytes"))
                }
                Some(len) => {
                    let len =
                        u32::try_from(*len).map_err(|_| StorageRefusal::Limit("value_bytes"))?;
                    next.keys.insert(key.to_string(), len);
                }
                None => {
                    next.keys.remove(*key);
                }
            }
        }
        if next.keys.len() > KV_MAX_KEYS {
            return Err(StorageRefusal::Limit("keys"));
        }
        if next.usage() > quota {
            return Err(StorageRefusal::Limit("quota"));
        }
        Ok(next)
    }

    /// One page of keys starting with `prefix`, after `cursor` if given, and the cursor of the
    /// next page if there is one.
    pub fn page(&self, prefix: &str, cursor: Option<&str>) -> (Vec<String>, Option<String>) {
        let after = |key: &&String| cursor.is_none_or(|c| key.as_str() > c);
        let mut matching = self
            .keys
            .keys()
            .filter(|key| key.starts_with(prefix))
            .filter(after);
        let keys: Vec<String> = matching.by_ref().take(KV_LIST_PAGE).cloned().collect();
        let next = match matching.next() {
            Some(_) => keys.last().cloned(),
            None => None,
        };
        (keys, next)
    }
}

/// What an app holds at one root: its namespaces' usage and its blobs' sizes, so the whole of
/// it can be counted and purged without a key scan.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StorageLedger {
    /// Namespace digest to its usage.
    pub namespaces: BTreeMap<String, u64>,
    /// Blob sha256 to its length.
    pub blobs: BTreeMap<String, u64>,
}

impl StorageLedger {
    pub fn is_empty(&self) -> bool {
        self.namespaces.is_empty() && self.blobs.is_empty()
    }

    /// Everything stored at this root, keys and values and blobs.
    pub fn total_bytes(&self) -> u64 {
        self.namespaces.values().sum::<u64>() + self.blobs.values().sum::<u64>()
    }

    pub fn blob_bytes(&self) -> u64 {
        self.blobs.values().sum()
    }

    /// Whether a blob of `len` bytes not yet held fits.
    pub fn admits_blob(&self, sha256: &str, len: u64) -> Result<(), StorageRefusal> {
        if len > BLOB_MAX_BYTES {
            return Err(StorageRefusal::Limit("blob_bytes"));
        }
        if self.blobs.contains_key(sha256) {
            return Ok(());
        }
        if self.blob_bytes() + len > BLOB_QUOTA {
            return Err(StorageRefusal::Limit("quota"));
        }
        Ok(())
    }

    pub fn record_namespace(&mut self, namespace_id: String, usage: u64) {
        if usage == 0 {
            self.namespaces.remove(&namespace_id);
        } else {
            self.namespaces.insert(namespace_id, usage);
        }
    }
}
