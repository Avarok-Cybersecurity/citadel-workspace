//! An admin can make the workspace require a human check (Turnstile) to sign in.
//!
//! The setting lives with the host, not in the workspace record: the host's admission check reads
//! it at every sign-in, before any session exists. The kernel reads and writes it through the
//! host's `SignInSettingsStore`, gated on the Admin role, and a kernel built without one says the
//! server has no such setting rather than inventing a value.
//!
//! Real: the kernel, its command processor and the in-memory backend. The store is the host
//! boundary (a Durable Object's key-value storage in production); here it is a cell, which is
//! the whole of what the kernel may assume about it.
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::sign_in::{
    SignInSettingsStore, SignInSettingsUnavailable, NOT_SUPPORTED,
};
use citadel_workspace_types::sign_in::SignInSettings;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{
    create_configured_test_kernel, create_test_kernel, TEST_ADMIN_USER_ID,
};
use std::sync::{Arc, Mutex};

/// What the host holds. `fail` makes every read and write fail, as an unreachable store would.
struct HostCell {
    stored: Mutex<SignInSettings>,
    fail: bool,
}

#[async_trait::async_trait]
impl SignInSettingsStore for HostCell {
    async fn load(&self) -> Result<SignInSettings, SignInSettingsUnavailable> {
        if self.fail {
            return Err(SignInSettingsUnavailable(
                "the host's storage is down".into(),
            ));
        }
        Ok(*self.stored.lock().unwrap())
    }

    async fn store(&self, settings: SignInSettings) -> Result<(), SignInSettingsUnavailable> {
        if self.fail {
            return Err(SignInSettingsUnavailable(
                "the host's storage is down".into(),
            ));
        }
        *self.stored.lock().unwrap() = settings;
        Ok(())
    }
}

const OFF: SignInSettings = SignInSettings {
    require_turnstile_sign_in: false,
};
const ON: SignInSettings = SignInSettings {
    require_turnstile_sign_in: true,
};

async fn hosted(fail: bool) -> (Arc<Kernel>, Arc<HostCell>) {
    let cell = Arc::new(HostCell {
        stored: Mutex::new(OFF),
        fail,
    });
    let store: Arc<dyn SignInSettingsStore> = cell.clone();
    let kernel = create_configured_test_kernel(|k| k.set_sign_in_settings(Some(store))).await;
    insert_user_with_role(&kernel, "member", UserRole::Member).await;
    join_root(&kernel, "member").await;
    (kernel, cell)
}

async fn send(
    kernel: &Kernel,
    actor: &str,
    request: WorkspaceProtocolRequest,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, actor)
        .await
        .expect("dispatch")
}

/// The settings an answer carries; anything else fails the test.
fn settings(answer: WorkspaceProtocolResponse) -> SignInSettings {
    match answer {
        WorkspaceProtocolResponse::SignInSettings(s) => s,
        other => panic!("expected the settings, got {other:?}"),
    }
}

fn refusal(answer: WorkspaceProtocolResponse) -> String {
    match answer {
        WorkspaceProtocolResponse::Error(message) => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn update(settings: SignInSettings) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateSignInSettings { settings }
}

#[tokio::test]
async fn a_member_reads_the_setting_and_it_starts_off() {
    let (kernel, _) = hosted(false).await;
    let read = send(
        &kernel,
        "member",
        WorkspaceProtocolRequest::GetSignInSettings,
    )
    .await;
    assert_eq!(settings(read), OFF);
}

#[tokio::test]
async fn an_admin_turns_it_on_and_the_host_holds_it() {
    let (kernel, cell) = hosted(false).await;
    let answer = send(&kernel, TEST_ADMIN_USER_ID, update(ON)).await;
    assert_eq!(settings(answer), ON);
    assert_eq!(*cell.stored.lock().unwrap(), ON, "the host was not told");
    let read = send(
        &kernel,
        "member",
        WorkspaceProtocolRequest::GetSignInSettings,
    )
    .await;
    assert_eq!(settings(read), ON);

    let answer = send(&kernel, TEST_ADMIN_USER_ID, update(OFF)).await;
    assert_eq!(settings(answer), OFF);
    assert_eq!(*cell.stored.lock().unwrap(), OFF);
}

#[tokio::test]
async fn a_member_cannot_change_it() {
    let (kernel, cell) = hosted(false).await;
    let answer = send(&kernel, "member", update(ON)).await;
    let message = refusal(answer);
    assert!(message.contains("only an admin"), "{message}");
    assert_eq!(
        *cell.stored.lock().unwrap(),
        OFF,
        "a member's change was stored"
    );
}

#[tokio::test]
async fn a_server_without_the_setting_says_so() {
    let kernel = create_test_kernel().await;
    for request in [WorkspaceProtocolRequest::GetSignInSettings, update(ON)] {
        let answer = send(&kernel, TEST_ADMIN_USER_ID, request).await;
        assert_eq!(refusal(answer), NOT_SUPPORTED);
    }
}

/// A store that cannot be read is an error, never "off": "off" would tell an admin that sign-in
/// is unprotected when nobody knows.
#[tokio::test]
async fn an_unreachable_store_is_an_error_not_a_value() {
    let (kernel, _) = hosted(true).await;
    let read = send(
        &kernel,
        "member",
        WorkspaceProtocolRequest::GetSignInSettings,
    )
    .await;
    assert!(refusal(read).contains("storage is down"));
    let write = send(&kernel, TEST_ADMIN_USER_ID, update(ON)).await;
    assert!(refusal(write).contains("storage is down"));
}
