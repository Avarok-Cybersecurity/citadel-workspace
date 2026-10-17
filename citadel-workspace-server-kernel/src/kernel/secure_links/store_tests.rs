//! What the secure-link store writes: a digest and never a token, and a purge that takes each
//! expired link with its index entries, a bounded number at a time. Read back from the backend's
//! own bytes, which only a test inside the crate can see.

use super::quota::{FixedLinkQuota, LinkQuota};
use super::records::{index_key, record_key, LinkRecord, EXPIRY_KEY};
use super::token::digest_of;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::command_processor::async_process_command::process_command_with_user;
use crate::kernel::transaction::secure_links_store::LINKS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_types::secure_links::{
    LinkGrant, LinkLifetime, SecureLinksRequest, SecureLinksResponse,
};
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::sync::Arc;

type Kernel = AsyncWorkspaceServerKernel<MonoRatchet>;

async fn kernel_with_member(id: &str) -> Kernel {
    let mut kernel = Kernel::new(None);
    kernel.set_link_quota_source(Some(Arc::new(FixedLinkQuota(LinkQuota {
        per_member: 50,
        pool: 0,
    }))));
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend.init().await.expect("init");
    kernel
        .inject_admin_user("a-master-password")
        .await
        .expect("workspace");
    let user = User::new(id.to_string(), id.to_string(), UserRole::Member);
    backend
        .insert_user(id.to_string(), user)
        .await
        .expect("user");
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read")
        .expect("root");
    workspace.members.push(id.to_string());
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace)
        .await
        .expect("save");
    kernel
}

#[tokio::test]
async fn the_store_holds_the_tokens_digest_and_never_the_token() {
    let kernel = kernel_with_member("alice").await;
    let request = WorkspaceProtocolRequest::SecureLinks(SecureLinksRequest::Create {
        target: "/messages".to_string(),
        label: "standup".to_string(),
        grants: vec![LinkGrant::Workspace],
        lifetime: LinkLifetime::Expires { ttl_ms: 60_000 },
    });
    let token = match process_command_with_user(&kernel, &request, "alice").await {
        Ok(WorkspaceProtocolResponse::SecureLinks(SecureLinksResponse::Created {
            token, ..
        })) => token,
        other => panic!("{other:?}"),
    };
    assert_eq!(token.len(), 43, "32 bytes, base64url without padding");

    let entries = kernel.domain_operations.backend_tx_manager.stored_entries();
    let digest = digest_of(&token);
    for (key, value) in &entries {
        assert!(!key.contains(&token), "a key holds the token: {key}");
        assert!(
            !String::from_utf8_lossy(value).contains(&token),
            "{key} holds the token"
        );
    }
    let (_, stored) = entries
        .iter()
        .find(|(key, _)| *key == record_key(&digest))
        .expect("the record is stored under the token's digest");
    let record: LinkRecord = serde_json::from_slice(stored).expect("a link record");
    assert_eq!(record.digest, digest);
}

fn record(owner: &str, n: u64, expires_ms: u64) -> LinkRecord {
    LinkRecord {
        digest: digest_of(&format!("{owner}-{n}")),
        id: format!("{owner}-{n}"),
        owner: owner.to_string(),
        target: "/messages".to_string(),
        label: String::new(),
        grants: vec![LinkGrant::Workspace],
        one_time: false,
        created_ms: 0,
        expires_ms,
        uses: 0,
        last_used_ms: None,
    }
}

#[tokio::test]
async fn a_purge_takes_expired_links_and_their_index_entries_a_batch_at_a_time() {
    let kernel = kernel_with_member("alice").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let expired: Vec<LinkRecord> = std::iter::once(record("bob", 0, 50))
        .chain((0..5).map(|n| record("alice", n, 100 + n)))
        .collect();
    let live = record("alice", 9, 10_000);
    {
        let _guard = LINKS_LOCK.lock().await;
        for link in expired.iter().chain([&live]) {
            backend.insert_link(link).await.expect("insert");
        }
    }
    let keys = || -> Vec<String> {
        backend
            .stored_entries()
            .into_iter()
            .map(|(k, _)| k)
            .collect()
    };
    let expiry_len = || async { backend.link_expiry().await.expect("expiry").len() };

    assert_eq!(
        kernel.purge_expired_links(1_000, 3).await.unwrap(),
        3,
        "three left"
    );
    for gone in &expired[..3] {
        assert!(
            !keys().contains(&record_key(&gone.digest)),
            "{} purged",
            gone.id
        );
    }
    for kept in expired[3..].iter().chain([&live]) {
        assert!(
            keys().contains(&record_key(&kept.digest)),
            "{} not yet",
            kept.id
        );
    }
    assert!(
        !keys().contains(&index_key("bob")),
        "bob's only link went, and his index with it"
    );
    let alice = backend.link_digests_of("alice").await.unwrap();
    assert!(expired[1..3]
        .iter()
        .all(|gone| !alice.contains(&gone.digest)));
    assert_eq!(alice.len(), 4);
    assert_eq!(expiry_len().await, 4);

    assert_eq!(kernel.purge_expired_links(1_000, 200).await.unwrap(), 0);
    assert_eq!(
        backend.link_digests_of("alice").await.unwrap(),
        vec![live.digest.clone()]
    );
    assert_eq!(expiry_len().await, 1);
    assert!(keys().contains(&EXPIRY_KEY.to_string()));
    assert!(
        keys().contains(&record_key(&live.digest)),
        "a live link is never purged"
    );
}
