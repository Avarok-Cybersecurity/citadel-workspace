//! The storage backends' limits and namespaces, without the kernel.

use super::storage::*;

fn root(app: &str, scope: &str) -> StorageRoot {
    StorageRoot {
        app_id: app.to_string(),
        scope_key: scope.to_string(),
    }
}

#[test]
fn namespaces_are_distinct_per_app_scope_member_and_node() {
    let a = root("com.acme.kanban", "workspace");
    let ids = [
        a.namespace_id(&Namespace::User("alice".into())),
        a.namespace_id(&Namespace::User("bob".into())),
        a.namespace_id(&Namespace::Scope),
        a.namespace_id(&Namespace::Node("room".into())),
        root("com.acme.other", "workspace").namespace_id(&Namespace::Scope),
        root("com.acme.kanban", "node:room").namespace_id(&Namespace::Scope),
    ];
    for (i, x) in ids.iter().enumerate() {
        assert_eq!(x.len(), 64);
        assert!(ids[i + 1..].iter().all(|y| y != x), "{x} repeats");
    }
}

#[test]
fn a_key_never_reaches_the_backend_key_as_written() {
    let id = key_id("../../citadel_workspace.users");
    assert_eq!(id.len(), 64);
    assert!(id.bytes().all(|b| b.is_ascii_hexdigit()));
}

#[test]
fn keys_must_be_short_printable_text() {
    assert!(check_key("widths/col-1").is_ok());
    assert_eq!(check_key(""), Err(StorageRefusal::Policy("bad_key")));
    assert_eq!(check_key("a\nb"), Err(StorageRefusal::Policy("bad_key")));
    let long = "k".repeat(KV_MAX_KEY_BYTES + 1);
    assert_eq!(check_key(&long), Err(StorageRefusal::Limit("key_bytes")));
    assert!(check_key(&long[1..]).is_ok());
}

#[test]
fn a_write_past_the_quota_changes_nothing() {
    let index = KvIndex::default()
        .apply(&[("a", Some(1000))], 2000)
        .expect("fits");
    assert_eq!(index.usage(), 1001);
    let over = index.apply(&[("b", Some(500)), ("c", Some(500))], 2000);
    assert_eq!(over, Err(StorageRefusal::Limit("quota")));
    // Replacing a value counts the new length, not both.
    let replaced = index.apply(&[("a", Some(1998))], 2000).expect("fits");
    assert_eq!(replaced.usage(), 1999);
    assert_eq!(
        index.apply(&[("a", None)], 2000).expect("delete").usage(),
        0
    );
}

#[test]
fn values_and_key_counts_are_bounded() {
    let big = KvIndex::default().apply(&[("a", Some(KV_MAX_VALUE_BYTES + 1))], u64::MAX);
    assert_eq!(big, Err(StorageRefusal::Limit("value_bytes")));
    let names: Vec<String> = (0..=KV_MAX_KEYS).map(|i| format!("k{i}")).collect();
    let writes: Vec<(&str, Option<usize>)> = names.iter().map(|k| (k.as_str(), Some(1))).collect();
    assert_eq!(
        KvIndex::default().apply(&writes, u64::MAX),
        Err(StorageRefusal::Limit("keys"))
    );
    assert!(KvIndex::default()
        .apply(&writes[..KV_MAX_KEYS], u64::MAX)
        .is_ok());
}

#[test]
fn a_set_many_is_all_or_nothing() {
    let index = KvIndex::default();
    let refused = index.apply(&[("ok", Some(1)), ("", Some(1))], u64::MAX);
    assert_eq!(refused, Err(StorageRefusal::Policy("bad_key")));
    assert!(index.keys.is_empty());
}

#[test]
fn listing_pages_by_prefix_and_cursor() {
    let names: Vec<String> = (0..250).map(|i| format!("p/{i:03}")).collect();
    let mut writes: Vec<(&str, Option<usize>)> =
        names.iter().map(|k| (k.as_str(), Some(1))).collect();
    writes.push(("q/other", Some(1)));
    let index = KvIndex::default().apply(&writes, u64::MAX).expect("fits");
    let (first, next) = index.page("p/", None);
    assert_eq!(first.len(), KV_LIST_PAGE);
    assert_eq!(next.as_deref(), Some("p/099"));
    let (second, next) = index.page("p/", next.as_deref());
    assert_eq!(second.first().map(String::as_str), Some("p/100"));
    let (third, next) = index.page("p/", next.as_deref());
    assert_eq!(third.len(), 50);
    assert_eq!(next, None);
    assert!(third.iter().all(|k| k.starts_with("p/")));
}

#[test]
fn blobs_are_bounded_each_and_together() {
    let mut ledger = StorageLedger::default();
    assert_eq!(
        ledger.admits_blob("a", BLOB_MAX_BYTES + 1),
        Err(StorageRefusal::Limit("blob_bytes"))
    );
    for i in 0..(BLOB_QUOTA / BLOB_MAX_BYTES) {
        ledger
            .admits_blob(&format!("{i}"), BLOB_MAX_BYTES)
            .expect("fits");
        ledger.blobs.insert(format!("{i}"), BLOB_MAX_BYTES);
    }
    assert_eq!(
        ledger.admits_blob("one-more", 1),
        Err(StorageRefusal::Limit("quota"))
    );
    // A blob already held is not counted twice.
    assert!(ledger.admits_blob("0", BLOB_MAX_BYTES).is_ok());
    ledger.record_namespace("ns".into(), 10);
    assert_eq!(ledger.total_bytes(), BLOB_QUOTA + 10);
    ledger.record_namespace("ns".into(), 0);
    assert!(!ledger.namespaces.contains_key("ns"));
}
