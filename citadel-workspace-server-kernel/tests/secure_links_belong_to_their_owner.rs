//! Only a link's owner may list, delete or regenerate it, and regenerating kills the token it
//! had. Anyone else asking is told the link is unavailable, as for one that does not exist.

use citadel_workspace_types::secure_links::{SecureLinksRequest, SecureLinksResponse};
use citadel_workspace_types::structs::UserRole;
use common::secure_links_test_utils::{
    create, enrol, expires, links, links_kernel, members, opened, resolve, HOUR_MS,
};

const TARGET: &str = "/messages";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn regenerating_kills_the_old_token_and_only_the_owner_may() {
    let kernel = links_kernel(5, 0).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    let (info, old) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    let regenerate = |user: &'static str| {
        links(
            &kernel,
            user,
            SecureLinksRequest::Regenerate {
                id: info.id.clone(),
            },
        )
    };
    assert_eq!(
        regenerate("bob").await,
        Ok(SecureLinksResponse::LinkUnavailable)
    );
    assert!(
        opened(&resolve(&kernel, "bob", &old).await, TARGET),
        "bob's refused attempt changed nothing"
    );

    let new = match regenerate("alice").await {
        Ok(SecureLinksResponse::Regenerated {
            info: renewed,
            token,
        }) => {
            assert_eq!(
                (renewed.id, renewed.target),
                (info.id.clone(), info.target.clone())
            );
            token
        }
        other => panic!("{other:?}"),
    };
    assert_ne!(new, old);
    assert_eq!(
        resolve(&kernel, "bob", &old).await,
        SecureLinksResponse::LinkUnavailable
    );
    assert!(opened(&resolve(&kernel, "bob", &new).await, TARGET));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_the_owner_lists_or_deletes_a_link() {
    let kernel = links_kernel(5, 0).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    let (info, token) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    match links(&kernel, "bob", SecureLinksRequest::List).await {
        Ok(SecureLinksResponse::Links { links, live, .. }) => {
            assert_eq!((links.len(), live), (0, 0))
        }
        other => panic!("{other:?}"),
    }
    let delete = |user: &'static str| {
        links(
            &kernel,
            user,
            SecureLinksRequest::Delete {
                id: info.id.clone(),
            },
        )
    };
    assert_eq!(
        delete("bob").await,
        Ok(SecureLinksResponse::LinkUnavailable)
    );
    assert!(opened(&resolve(&kernel, "bob", &token).await, TARGET));
    assert_eq!(
        delete("alice").await,
        Ok(SecureLinksResponse::Deleted {
            id: info.id.clone()
        })
    );
    assert_eq!(
        resolve(&kernel, "bob", &token).await,
        SecureLinksResponse::LinkUnavailable
    );
}
