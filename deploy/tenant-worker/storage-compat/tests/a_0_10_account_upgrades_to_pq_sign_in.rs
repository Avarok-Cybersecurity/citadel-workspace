//! The 0.10.0 tenant's legacy (Argon2) account under this tree's server, which runs
//! post-quantum sign-in: it is still the legacy account it was, so it signs in as before, and
//! the upgrade a login carries replaces its record in place, keeping its identity and the
//! kernel's record of it. The login itself, over the wire, is upgrade.mjs's to prove; this pins
//! what the upgrade does to the stored row a real Durable Object wrote.
#![cfg(not(target_family = "wasm"))]

use citadel_sdk::prelude::{AccountManager, BackendType, ServerMiscSettings, StackedRatchet};
use citadel_sdk::prelude::{HostSqlHandle, SecBuffer};
use citadel_user::auth::pq::client::ClientRegistration;
use citadel_user::auth::pq::oprf::OprfSeed;
use citadel_user::auth::pq::record::{KsfParams, PqAuthRecord};
use citadel_user::auth::pq::server::{registration_reply, PqAuthServerSettings};
use std::path::PathBuf;
use tenant_storage_compat::SqliteFileHost;

const USERNAME: &str = "fixture010";
const CID: u64 = 3105419764207108793;

type Manager = AccountManager<StackedRatchet, StackedRatchet>;

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

/// The tenant's settings as the Durable Object starts the node with them (worker.mjs, the KSF
/// vars in wrangler.toml).
fn pq_settings() -> PqAuthServerSettings {
    let ksf = KsfParams {
        mem_kib: 19456,
        iterations: 2,
        lanes: 1,
    };
    PqAuthServerSettings::new(OprfSeed::from_bytes([7u8; 32]), ksf).expect("at the floor")
}

/// A manager over `host`, as this tree's server runs one: post-quantum sign-in on.
async fn manager(host: &HostSqlHandle) -> Manager {
    let misc = ServerMiscSettings {
        allow_transient_connections: false,
        pq_sign_in: Some(pq_settings()),
        ..Default::default()
    };
    AccountManager::new(BackendType::HostSql(host.clone()), None, None, Some(misc))
        .await
        .expect("the backend starts over the 0.10.0 tables")
}

/// The record the client's upgrade carries: its password factor, enrolled with this server.
async fn upgrade_record() -> PqAuthRecord {
    let password = SecBuffer::from(b"the fixture's password".to_vec());
    let (start, client) = ClientRegistration::start(USERNAME, &password).expect("start");
    let (reply, pending) = registration_reply(&pq_settings(), &start).expect("reply");
    let (finish, _) = client.finish(&reply, true).await.expect("finish");
    pending.finish(finish, 1).expect("record")
}

#[test]
fn the_stored_account_is_still_legacy_under_pq_sign_in() {
    block_on(async {
        let host = SqliteFileHost::handle(&fixture()).expect("fixture copy");
        let accounts = manager(&host).await;
        let account = accounts
            .get_client_by_cid(CID)
            .await
            .expect("the stored account deserializes")
            .expect("the stored account is found");
        let auth = account.auth_store();
        assert!(
            auth.argon_container().is_some(),
            "the legacy record was lost"
        );
        assert!(auth.pq_record().is_none());
    });
}

#[test]
fn the_upgrade_replaces_the_stored_row_and_keeps_the_account() {
    block_on(async {
        let host = SqliteFileHost::handle(&fixture()).expect("fixture copy");
        let record = upgrade_record().await;
        manager(&host)
            .await
            .upgrade_to_pq(CID, record.clone())
            .await
            .expect("a legacy account upgrades");

        // A second manager over the same database: nothing it reads comes from the first's memory.
        let reloaded = manager(&host).await;
        let account = reloaded
            .get_client_by_username(USERNAME)
            .await
            .expect("the upgraded account deserializes")
            .expect("the upgraded account is found by username");
        assert_eq!(account.get_cid(), CID);
        {
            let auth = account.auth_store();
            assert_eq!(auth.pq_record(), Some(&record));
            assert!(
                auth.argon_container().is_none(),
                "the legacy path is still open"
            );
        }
        let kernel_record = reloaded
            .get_persistence_handler()
            .get_byte_map_value(
                0,
                0,
                "_INTERNAL_DATA_MAP",
                "citadel_workspace.user.fixture010",
            )
            .await
            .expect("the byte map reads");
        assert!(kernel_record.is_some_and(|bytes| !bytes.is_empty()));
        assert!(
            reloaded.upgrade_to_pq(CID, record).await.is_err(),
            "an upgraded account was upgraded again"
        );
    });
}
