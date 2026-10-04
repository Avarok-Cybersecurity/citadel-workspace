//! Sign-in: what the host gives the node for post-quantum sign-in, and the workspace's sign-in
//! settings (`GetSignInSettings`, `UpdateSignInSettings`).
//!
//! The settings are the host's, not the workspace record's. A hosted server's admission check
//! reads them at every sign-in and registration, before any session or kernel request exists,
//! and the host's public discovery endpoint reads them for a sign-in form that has no session at
//! all. So the host keeps the one copy (a Durable Object, in its key-value storage) and the kernel
//! reaches it through [`SignInSettingsStore`]. A kernel built without one answers
//! [`NOT_SUPPORTED`]: there is no default value and no second copy to drift.

use citadel_workspace_types::sign_in::SignInSettings;
use citadel_workspace_types::WorkspaceProtocolResponse;
use std::sync::Arc;

pub use citadel_user::auth::pq::admission::{
    AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal, AdmissionToken,
};
pub use citadel_user::auth::pq::oprf::OprfSeed;
pub use citadel_user::auth::pq::record::KsfParams;
pub use citadel_user::auth::pq::server::PqAuthServerSettings;

/// The host could not read or write the settings, and why. Never turned into a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInSettingsUnavailable(pub String);

/// The host capability that holds the workspace's sign-in settings.
#[async_trait::async_trait]
pub trait SignInSettingsStore: Send + Sync {
    async fn load(&self) -> Result<SignInSettings, SignInSettingsUnavailable>;
    async fn store(&self, settings: SignInSettings) -> Result<(), SignInSettingsUnavailable>;
}

/// The capability as the kernel holds it: absent unless the host passed one.
pub type SignInSettingsHandle = Option<Arc<dyn SignInSettingsStore>>;

/// What a hosted node is started with for sign-in: the post-quantum settings (the tenant's OPRF
/// seed and the Argon2id parameters clients stretch with), the admission check every fresh
/// sign-in and registration passes (the SDK asks it), and the host's settings store, which that
/// check reads. All are named by the host; `None` is a decision it makes, not a default.
pub struct HostedSignIn {
    pub pq_sign_in: Option<PqAuthServerSettings>,
    pub admission: Option<Arc<dyn AdmissionPolicy>>,
    pub settings: SignInSettingsHandle,
}

pub const NOT_SUPPORTED: &str = "this workspace server has no sign-in settings";
pub(crate) const ADMIN_ONLY: &str =
    "Permission denied: only an admin can change how people sign in to this workspace";

fn unavailable(
    SignInSettingsUnavailable(reason): SignInSettingsUnavailable,
) -> WorkspaceProtocolResponse {
    WorkspaceProtocolResponse::Error(format!("the sign-in settings are unavailable: {reason}"))
}

/// `GetSignInSettings`.
pub async fn read(store: &SignInSettingsHandle) -> WorkspaceProtocolResponse {
    let Some(store) = store else {
        return WorkspaceProtocolResponse::Error(NOT_SUPPORTED.to_string());
    };
    match store.load().await {
        Ok(settings) => WorkspaceProtocolResponse::SignInSettings(settings),
        Err(e) => unavailable(e),
    }
}

/// `UpdateSignInSettings`, once the caller's role is known. The answer is what the host holds
/// after the write, read back, so an admin is never shown a value nobody stored.
pub async fn update(
    store: &SignInSettingsHandle,
    is_admin: bool,
    settings: SignInSettings,
) -> WorkspaceProtocolResponse {
    let Some(store) = store else {
        return WorkspaceProtocolResponse::Error(NOT_SUPPORTED.to_string());
    };
    if !is_admin {
        return WorkspaceProtocolResponse::Error(ADMIN_ONLY.to_string());
    }
    if let Err(e) = store.store(settings).await {
        return unavailable(e);
    }
    read(&Some(store.clone())).await
}
