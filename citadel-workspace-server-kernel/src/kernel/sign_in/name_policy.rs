//! The admission check every registration passes on every server (identity doc §6 rev b):
//! `kernel::server_identity::registration`'s name rules, then the server's own check (Turnstile)
//! if it has one. The SDK asks it at every fresh registration and sign-in, on the post-quantum
//! and the legacy paths, before any OPRF or Argon2 work. Sign-ins pass straight to the inner
//! check: legacy accounts keep signing in unchanged.
//!
//! Whether a reserving name is taken is the [`AccountDirectory`] port's to answer; a directory
//! that cannot answer is a refusal, never an admission.

use super::admission::CHECK_UNAVAILABLE;
use super::{AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal};
use crate::kernel::server_identity::config::IdentityPlan;
use crate::kernel::server_identity::registration::{registration_candidate, reserved_refusal};
use std::sync::Arc;
use std::time::Duration;

/// Whether an account by a name exists on this server.
#[async_trait::async_trait]
pub trait AccountDirectory: Send + Sync {
    async fn exists(&self, username: &str) -> Result<bool, String>;
}

pub struct NamePolicy {
    plan: IdentityPlan,
    directory: Arc<dyn AccountDirectory>,
    inner: Option<Arc<dyn AdmissionPolicy>>,
}

impl NamePolicy {
    pub fn new(
        plan: IdentityPlan,
        directory: Arc<dyn AccountDirectory>,
        inner: Option<Arc<dyn AdmissionPolicy>>,
    ) -> Self {
        Self {
            plan,
            directory,
            inner,
        }
    }

    async fn admit_name(&self, username: &str) -> Result<(), AdmissionRefusal> {
        let candidate =
            registration_candidate(username, &self.plan).map_err(AdmissionRefusal::Failed)?;
        for name in &candidate.reserving_names {
            match self.directory.exists(name).await {
                Ok(false) => {}
                Ok(true) => {
                    return Err(AdmissionRefusal::Failed(reserved_refusal(
                        &candidate.handle,
                    )))
                }
                Err(detail) => {
                    log::error!(target: "citadel", "admission: cannot tell whether {name} exists: {detail}");
                    return Err(AdmissionRefusal::Failed(CHECK_UNAVAILABLE.to_string()));
                }
            }
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl AdmissionPolicy for NamePolicy {
    async fn admit(&self, ctx: AdmissionContext) -> Result<(), AdmissionRefusal> {
        if ctx.kind == AdmissionKind::Register {
            self.admit_name(&ctx.username).await?;
        }
        match &self.inner {
            Some(inner) => inner.admit(ctx).await,
            None => Ok(()),
        }
    }

    /// The inner check's: the name rules ask nothing of a sign-in, so only it has a grace.
    fn resume_grace(&self) -> Duration {
        match &self.inner {
            Some(inner) => inner.resume_grace(),
            None => Duration::ZERO,
        }
    }
}
