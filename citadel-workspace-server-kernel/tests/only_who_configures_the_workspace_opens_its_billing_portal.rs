//! "Plan & billing" over a member's session: the kernel admits whoever holds EditWorkspaceConfig
//! at the workspace root -- the session's own account, never anything the request carries -- and
//! only then asks the host to open the portal. A member without it is refused before the host is
//! asked anything, and a kernel built without a host says it has none.
//!
//! Real: the kernel, its command processor, the role table and the in-memory backend. The host is
//! the boundary (a tenant's Durable Object, which opens a Stripe session for its own tenant); here
//! it is a recorder that counts how often it was asked, which is the property under test: a
//! refused caller must not reach it at all.
use citadel_workspace_server_kernel::kernel::billing::{
    BillingPortalHost, BillingPortalUnavailable, NOT_SUPPORTED,
};
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::billing::BillingPortalAnswer;
use citadel_workspace_types::structs::Permission;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{
    insert_user_with_role, join_root, member_holding, seed_role, GateKernel as Kernel,
};
use common::roles_fixture::{MEMBER_ROLE_ID, OWNER_ROLE_ID};
use common::workspace_test_utils::{create_configured_test_kernel, create_test_kernel};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const PORTAL: &str = "https://billing.stripe.com/p/session/test_fixture";

/// The host: how often it was asked, and whether it fails as an unreachable Stripe would.
struct Recorder {
    asked: AtomicUsize,
    fail: bool,
}

#[async_trait::async_trait]
impl BillingPortalHost for Recorder {
    async fn open(&self) -> Result<BillingPortalAnswer, BillingPortalUnavailable> {
        self.asked.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(BillingPortalUnavailable(
                "billing could not be reached".into(),
            ));
        }
        Ok(BillingPortalAnswer::Opened {
            portal_url: PORTAL.into(),
        })
    }
}

/// "configures" holds EditWorkspaceConfig (and nothing else); "member" is a plain Member.
async fn hosted(fail: bool) -> (Arc<Kernel>, Arc<Recorder>) {
    let recorder = Arc::new(Recorder {
        asked: AtomicUsize::new(0),
        fail,
    });
    let host: Arc<dyn BillingPortalHost> = recorder.clone();
    let kernel = create_configured_test_kernel(|k| k.set_billing_portal(Some(host))).await;
    seed_role(
        &kernel,
        "role-config",
        250,
        &[Permission::EditWorkspaceConfig],
    )
    .await;
    member_holding(&kernel, "configures", "role-config").await;
    insert_user_with_role(&kernel, "member", MEMBER_ROLE_ID).await;
    join_root(&kernel, "member").await;
    (kernel, recorder)
}

async fn open(kernel: &Kernel, actor: &str) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &WorkspaceProtocolRequest::OpenBillingPortal, actor)
        .await
        .expect("dispatch")
}

fn refusal(answer: WorkspaceProtocolResponse) -> String {
    match answer {
        WorkspaceProtocolResponse::Error(message) => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn answer(response: WorkspaceProtocolResponse) -> BillingPortalAnswer {
    match response {
        WorkspaceProtocolResponse::BillingPortal(answer) => answer,
        other => panic!("expected the portal answer, got {other:?}"),
    }
}

#[tokio::test]
async fn whoever_configures_the_workspace_gets_the_portal_and_the_host_is_asked_once() {
    let (kernel, recorder) = hosted(false).await;
    assert_eq!(
        answer(open(&kernel, "configures").await),
        BillingPortalAnswer::Opened {
            portal_url: PORTAL.into()
        }
    );
    assert_eq!(recorder.asked.load(Ordering::SeqCst), 1);
}

/// Asked as the permission, not the role: the Owner holds it too.
#[tokio::test]
async fn the_owner_gets_the_portal() {
    let (kernel, recorder) = hosted(false).await;
    insert_user_with_role(&kernel, "olga", OWNER_ROLE_ID).await;
    join_root(&kernel, "olga").await;
    assert!(matches!(
        answer(open(&kernel, "olga").await),
        BillingPortalAnswer::Opened { .. }
    ));
    assert_eq!(recorder.asked.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_member_without_the_permission_is_refused_and_the_host_is_never_asked() {
    let (kernel, recorder) = hosted(false).await;
    let message = refusal(open(&kernel, "member").await);
    assert!(message.contains("Permission denied"), "{message}");
    assert!(message.contains("EditWorkspaceConfig"), "{message}");
    assert_eq!(
        recorder.asked.load(Ordering::SeqCst),
        0,
        "a refused caller reached the billing host"
    );
}

#[tokio::test]
async fn a_server_without_a_billing_host_says_so() {
    let kernel = create_test_kernel().await;
    seed_role(
        &kernel,
        "role-config",
        250,
        &[Permission::EditWorkspaceConfig],
    )
    .await;
    member_holding(&kernel, "configures", "role-config").await;
    assert_eq!(refusal(open(&kernel, "configures").await), NOT_SUPPORTED);
}

/// A host that fails is an answer the page can show and retry, not a refusal it would read as
/// "you may not" and fall back to the claim code for.
#[tokio::test]
async fn a_failing_host_is_unavailable_not_refused() {
    let (kernel, recorder) = hosted(true).await;
    assert_eq!(
        answer(open(&kernel, "configures").await),
        BillingPortalAnswer::Unavailable {
            reason: "billing could not be reached".into()
        }
    );
    assert_eq!(recorder.asked.load(Ordering::SeqCst), 1);
}
