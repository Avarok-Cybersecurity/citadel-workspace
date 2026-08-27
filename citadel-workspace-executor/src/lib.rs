//! Where code runs, as a decision the type system makes you take.
//!
//! The motivating case is a workspace document. Documents are MDX: members
//! author them, and rendering one means *executing* it. That was being done
//! with `new Function` in the viewer's own page — member-authored code with the
//! viewer's session, keys and socket in reach — and the only thing standing in
//! front of it was a Content-Security-Policy that happened to forbid `eval` in
//! production and allow it in development. So the feature was simultaneously a
//! standing account-takeover in every environment where it worked, and silently
//! broken in the one where it shipped. Nobody chose either outcome; nothing ever
//! asked.
//!
//! This crate makes the question explicit and unavoidable:
//!
//! - [`ExecutableEntryPoint`] is work that carries its own code. It declares
//!   [`Trust`] — who wrote it — as an associated constant, so the answer travels
//!   with the work rather than with whoever is calling it today.
//! - [`SecureCodeExecutor`] is a place that will run such work, and reports the
//!   [`Isolation`] it actually provides.
//! - [`execute_with`] is the only sanctioned way to combine them, and refuses
//!   when the isolation is weaker than the trust demands. It is a free function
//!   precisely so that no executor can override it.
//!
//! Adding a destination — a sandboxed worker, the workspace server, a machine
//! over SSH, an ephemeral container — is an [`ExecutionTransport`] and nothing
//! else. No caller changes, and no caller can accidentally opt out of the
//! policy while doing it.
//!
//! What this crate deliberately does NOT do: decide what any particular piece
//! of work means. Compiling MDX, running a plugin, evaluating a formula — those
//! belong to their own [`ExecutableEntryPoint`] implementations. This is the
//! part that is the same for all of them.

mod client_side;
mod entry_point;
mod error;
mod executor;
mod remote;
pub mod transports;

pub use client_side::{ClientSideExecutor, SandboxHost, SandboxedLocalExecutor};
pub use entry_point::{ExecutableEntryPoint, Trust};
pub use error::{ExecutionError, Result};
pub use executor::{execute_with, Isolation, SecureCodeExecutor};
pub use remote::{ExecutionTransport, RemoteExecutor, WireRequest, WireResponse};

#[cfg(test)]
mod policy_tests {
    use super::*;
    use crate::transports::{FlyIoTransport, SshRemoteTransport};

    #[derive(serde::Serialize)]
    struct Untrusted;
    impl ExecutableEntryPoint for Untrusted {
        type Output = ();
        const NAME: &'static str = "untrusted-work";
        const TRUST: Trust = Trust::Anonymous;
        fn execute(self) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn an_unimplemented_transport_refuses_instead_of_falling_back() {
        // The failure mode a stub invites: the caller asked for another machine
        // because THIS machine will not do, and a helpful fallback would give
        // it the exact opposite, silently.
        for name in ["SSH", "fly.io"] {
            let error = match name {
                "SSH" => {
                    let mut executor =
                        RemoteExecutor::new(SshRemoteTransport::new("build-01".into()));
                    execute_with(&mut executor, Untrusted).await.unwrap_err()
                }
                _ => {
                    let mut executor = RemoteExecutor::new(FlyIoTransport::new("renderer".into()));
                    execute_with(&mut executor, Untrusted).await.unwrap_err()
                }
            };

            let message = error.to_string();
            assert!(message.contains("not implemented"), "{message}");
            assert!(message.contains("untrusted-work"), "{message}");
        }
    }

    #[test]
    fn trust_maps_to_the_isolation_it_requires() {
        // Stated as a test because these three lines are the entire policy, and
        // a change to any of them changes what the product is willing to run.
        assert_eq!(Trust::FirstParty.minimum_isolation(), Isolation::None);
        assert_eq!(Trust::Member.minimum_isolation(), Isolation::Process);
        assert_eq!(Trust::Anonymous.minimum_isolation(), Isolation::Machine);
    }
}
