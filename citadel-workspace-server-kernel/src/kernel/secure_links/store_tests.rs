//! What the secure-link store writes: a digest and never a token. Read back from the backend's
//! own bytes, which only a test inside the crate can see.

use super::records::{record_key, LinkRecord};
use super::test_support::kernel_with_member;
use super::token::digest_of;
use crate::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::secure_links::{
    LinkGrant, LinkLifetime, SecureLinksRequest, SecureLinksResponse,
};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

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
