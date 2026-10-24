//! How an app storage write may grow storage and in what order it lands, without the kernel.

use super::storage::{KvIndex, StorageRefusal};
use super::storage_write::*;
use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;

fn index(keys: &[(&str, u32)]) -> KvIndex {
    KvIndex {
        keys: keys.iter().map(|(k, l)| (k.to_string(), *l)).collect(),
    }
}

#[test]
fn growth_past_the_entitlement_is_refused_and_shrinking_never_is() {
    let at = StorageQuota::Bytes(100);
    assert_eq!(within_entitlement(40, 10, 60, at), Ok(()));
    let past = Err(StorageRefusal::Limit(OVER_ENTITLEMENT));
    assert_eq!(within_entitlement(41, 10, 60, at), past);
    assert_eq!(within_entitlement(500, 90, 80, at), Ok(()), "shrinking");
    assert_eq!(within_entitlement(500, 90, 90, at), Ok(()), "unchanged");
    let unlimited = StorageQuota::Unlimited;
    assert_eq!(within_entitlement(u64::MAX, 0, 1, unlimited), Ok(()));
}

#[test]
fn the_staged_index_names_every_key_before_and_after_at_its_larger_length() {
    let old = index(&[("a", 5), ("b", 9)]);
    let next = index(&[("b", 3), ("c", 7)]);
    assert_eq!(staged(&old, &next), index(&[("a", 5), ("b", 9), ("c", 7)]));
    assert_eq!(staged(&old, &old), old, "nothing new to stage");
}

#[test]
fn the_host_s_keys_are_never_listed_to_an_app() {
    let held = index(&[("notes", 1), ("sys/topic/pool", 1), ("system", 1)]);
    assert!(!app_visible("sys/topic/pool") && app_visible("system"));
    assert_eq!(held.page("", None).0, ["notes", "system"]);
    assert!(held.page("sys/", None).0.is_empty());
}

#[test]
fn a_blob_s_chunks_follow_from_its_length() {
    let chunk = u64::from(ARTIFACT_CHUNK_BYTES);
    assert_eq!(chunk_count(0), 0);
    assert_eq!(chunk_count(1), 1);
    assert_eq!(chunk_count(chunk), 1);
    assert_eq!(chunk_count(chunk + 1), 2);
}
