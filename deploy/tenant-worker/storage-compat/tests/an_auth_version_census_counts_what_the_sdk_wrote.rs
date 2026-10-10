//! The auth-record census (auth-versions) over records the SDK itself wrote: the real 0.10.0
//! legacy account out of the Durable Object fixture, and a transient and a post-quantum account
//! built and serialized by the SDK's own types. A layout drift in the SDK's account record, or
//! a version renumbered, fails here, before a deploy reads the wrong number off a live tenant.
#![cfg(not(target_family = "wasm"))]

use citadel_sdk::prelude::StackedRatchet;
use citadel_user::auth::{DeclaredAuthenticationMode, PqAuthSide};
use citadel_user::prelude::{ClientNetworkAccount, ConnectionInfo};
use std::path::PathBuf;
use tenant_auth_versions::{count, AuthVersions};

type Account = ClientNetworkAccount<StackedRatchet, StackedRatchet>;

/// Every `bin` in the fixture: the legacy account and the server's own transient row (cid 0),
/// as a real object holds them (see a_0_10_durable_object_account_loads.rs).
fn fixture_records() -> Vec<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/do-0.10.0.sqlite");
    let db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("fixture opens");
    let mut stmt = db
        .prepare("SELECT bin FROM citadel_cnacs")
        .expect("prepares");
    let rows = stmt.query_map([], |row| row.get(0)).expect("queries");
    rows.collect::<Result<_, _>>().expect("reads")
}

/// The fixture's one legacy account: its record is the larger.
fn legacy_record() -> Vec<u8> {
    fixture_records()
        .into_iter()
        .max_by_key(Vec::len)
        .expect("the fixture has accounts")
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    citadel_io::tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a current-thread runtime")
        .block_on(future)
}

fn sdk_record(auth: DeclaredAuthenticationMode) -> Vec<u8> {
    block_on(async {
        let info = ConnectionInfo::new("127.0.0.1:1").expect("an address");
        let account: Account = ClientNetworkAccount::new(42, false, info, auth, None)
            .await
            .expect("an account");
        account.generate_proper_bytes().expect("serializes")
    })
}

fn transient_record() -> Vec<u8> {
    sdk_record(DeclaredAuthenticationMode::Transient {
        username: "t".into(),
        full_name: "t".into(),
    })
}

fn post_quantum_record() -> Vec<u8> {
    sdk_record(DeclaredAuthenticationMode::PostQuantum {
        username: "p".into(),
        full_name: "p".into(),
        side: PqAuthSide::Client,
    })
}

fn counts(blobs: &[&[u8]]) -> AuthVersions {
    count(blobs.iter().copied())
}

#[test]
fn each_version_lands_in_its_own_count() {
    let (legacy, transient, pq) = (legacy_record(), transient_record(), post_quantum_record());
    assert_eq!(
        counts(&[&legacy]),
        AuthVersions {
            legacy_argon: 1,
            ..Default::default()
        }
    );
    assert_eq!(
        counts(&[&transient]),
        AuthVersions {
            transient: 1,
            ..Default::default()
        }
    );
    assert_eq!(
        counts(&[&pq]),
        AuthVersions {
            post_quantum: 1,
            ..Default::default()
        }
    );
}

#[test]
fn records_are_tallied_not_deduplicated() {
    let (legacy, pq) = (legacy_record(), post_quantum_record());
    let all = counts(&[&legacy, &pq, &pq, &legacy, &pq]);
    assert_eq!(
        all,
        AuthVersions {
            legacy_argon: 2,
            post_quantum: 3,
            ..Default::default()
        }
    );
}

#[test]
fn a_real_objects_rows_are_counted_whole() {
    let rows = fixture_records();
    assert_eq!(
        count(rows.iter().map(Vec::as_slice)),
        AuthVersions {
            legacy_argon: 1,
            transient: 1,
            ..Default::default()
        }
    );
}

#[test]
fn a_blob_that_is_not_a_record_is_undecodable_and_never_counted_as_a_version() {
    let pq = post_quantum_record();
    // Cut inside the record's leading fields, so the auth_store is never reached.
    let truncated = &pq[..10];
    // A whole record whose version tag is one this build does not know: the tag is the 2 that
    // precedes the one-character username "p" (u64 length 1).
    let mut unknown_version = pq.clone();
    let marker = [2u8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, b'p'];
    let at = pq
        .windows(marker.len())
        .position(|w| w == marker)
        .expect("the tag is in the record");
    unknown_version[at..at + 4].copy_from_slice(&99u32.to_le_bytes());
    let garbage: &[u8] = &[0xff; 64];
    let empty: &[u8] = &[];
    assert_eq!(
        counts(&[garbage, empty, truncated, &unknown_version]),
        AuthVersions {
            undecodable: 4,
            ..Default::default()
        }
    );
}
