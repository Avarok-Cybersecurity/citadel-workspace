//! A tenant's accounts as the 0.10.0 server (Citadel-Protocol 58fd47a7) stored them must load
//! under this tree's SDK.
//!
//! `fixtures/do-0.10.0.sqlite` holds the SDK's `citadel_*` tables copied out of a real Durable
//! Object: the server-wasm built by build.sh at 58fd47a7, run under `wrangler dev --persist-to`,
//! a tenant created through the control plane, account `fixture010` registered and its profile
//! name set to "written by 0.10.0" by the 0.10.0 proof client, then
//! `sqlite3 <object>.sqlite ".dump citadel_%" | sqlite3 do-0.10.0.sqlite`.
//! A login after the upgrade, over the wire, is upgrade.mjs's to prove; this pins the stored
//! format itself so a later SDK bump that cannot read it fails here, before a deploy.
#![cfg(not(target_family = "wasm"))]

use citadel_sdk::prelude::{AccountManager, BackendType, StackedRatchet};
use std::path::PathBuf;
use tenant_storage_compat::SqliteFileHost;

const USERNAME: &str = "fixture010";
const CID: u64 = 3105419764207108793;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/do-0.10.0.sqlite")
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    citadel_io::tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a current-thread runtime")
        .block_on(future)
}

async fn manager(edit: &str) -> AccountManager<StackedRatchet, StackedRatchet> {
    let handle = SqliteFileHost::handle_edited(&fixture(), edit).expect("fixture copy");
    AccountManager::new(BackendType::HostSql(handle), None, None, None)
        .await
        .expect("the backend starts over the 0.10.0 tables")
}

#[test]
fn the_account_loads_by_username_and_by_cid() {
    block_on(async {
        let accounts = manager("").await;
        let by_name = accounts
            .get_client_by_username(USERNAME)
            .await
            .expect("the stored account deserializes")
            .expect("the stored account is found by username");
        assert_eq!(by_name.get_cid(), CID);
        assert!(!by_name.is_personal());
        let by_cid = accounts
            .get_client_by_cid(CID)
            .await
            .expect("the stored account deserializes")
            .expect("the stored account is found by cid");
        assert_eq!(by_cid.get_username(), USERNAME);
        let registered = accounts
            .get_registered_impersonal_cids(None)
            .await
            .expect("the account list reads")
            .unwrap_or_default();
        assert_eq!(registered, vec![CID]);
    });
}

#[test]
fn the_kernels_record_of_the_account_is_still_there() {
    block_on(async {
        let accounts = manager("").await;
        let record = accounts
            .get_persistence_handler()
            .get_byte_map_value(
                0,
                0,
                "_INTERNAL_DATA_MAP",
                "citadel_workspace.user.fixture010",
            )
            .await
            .expect("the byte map reads");
        assert!(record.is_some_and(|bytes| !bytes.is_empty()));
    });
}

/// The loader is not vacuous: the same row with its serialized account cut short is refused.
#[test]
fn a_truncated_account_is_refused() {
    block_on(async {
        let accounts =
            manager("UPDATE citadel_cnacs SET bin = substr(bin, 1, length(bin) / 2);").await;
        assert!(accounts.get_client_by_username(USERNAME).await.is_err());
    });
}
