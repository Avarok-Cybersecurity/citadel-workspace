//! What this agent demands of a workspace server's certificate: one value per build.
//!
//! The agent shipped with Citadel Workspaces verifies the certificate against the machine's
//! roots (owner, 2026-11-19), whatever the server says about it. The local development stack's
//! servers are self-signed, so only its image is built with `self-signed-servers`; no release
//! build enables that feature (scripts/check-shipped-agent-verifies-server-certificates.mjs).

use citadel_sdk::prelude::CertVerification;

#[cfg(not(feature = "self-signed-servers"))]
pub(crate) const SERVER_CERTIFICATE: CertVerification = CertVerification::Required;
#[cfg(feature = "self-signed-servers")]
pub(crate) const SERVER_CERTIFICATE: CertVerification = CertVerification::SelfSignedAccepted;

/// `--dangerous` makes the node take any certificate unverified. A build that verifies them
/// would then refuse every connect (`CertVerificationUnavailable`), so it is refused here,
/// before anything binds, instead.
pub(crate) fn skips_verification(
    dangerous: bool,
    certificate: CertVerification,
) -> Result<bool, String> {
    match (dangerous, certificate.is_required()) {
        (true, true) => Err(
            "--dangerous cannot be used: this agent verifies every workspace \
                             server's certificate"
                .to_string(),
        ),
        (dangerous, _) => Ok(dangerous),
    }
}

#[cfg(test)]
#[path = "server_certificate_tests.rs"]
mod tests;
