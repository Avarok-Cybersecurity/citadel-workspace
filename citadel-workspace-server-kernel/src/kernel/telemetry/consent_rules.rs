//! The Telemetry Service's consent decisions, with no I/O: whether a user's accepted terms are
//! current, what they are shown of their own consent, and whether an upload would be stored.

use super::records::ConsentRecord;
use citadel_workspace_types::telemetry::TelemetryUploadRefusal;
use citadel_workspace_types::telemetry_metric::TELEMETRY_METRIC_FORMAT_VERSION;
use citadel_workspace_types::terms::{CurrentTerms, MyConsent};

/// Whether a user who accepted these versions has accepted what this server requires: the
/// platform terms only where `require_platform` says its users were shown them.
pub(crate) fn terms_accepted(
    terms: &CurrentTerms,
    require_platform: bool,
    platform: Option<u32>,
    workspace: Option<u32>,
) -> bool {
    let platform = if require_platform {
        platform
    } else {
        Some(terms.platform.version)
    };
    terms.accepted_by(platform, workspace)
}

pub(crate) fn consent_view(
    record: &ConsentRecord,
    terms: &CurrentTerms,
    require_platform: bool,
    meters_turn: bool,
) -> MyConsent {
    let terms_current = terms_accepted(
        terms,
        require_platform,
        record.accepted_platform_version,
        record.accepted_workspace_version,
    );
    MyConsent {
        accepted_platform_version: record.accepted_platform_version,
        accepted_workspace_version: record.accepted_workspace_version,
        required_platform_version: terms.platform.version,
        required_workspace_version: terms.workspace.as_ref().map(|t| t.version),
        terms_current,
        telemetry_enabled: record.telemetry_enabled,
        uploads_allowed: record.telemetry_enabled && terms_current,
        metric_format: Some(TELEMETRY_METRIC_FORMAT_VERSION),
        meters_turn: Some(meters_turn),
    }
}

/// Why an upload from a user in this state is not stored, or `None` when it is.
pub(crate) fn upload_refusal(consent: &MyConsent) -> Option<TelemetryUploadRefusal> {
    if !consent.telemetry_enabled {
        Some(TelemetryUploadRefusal::ConsentOff)
    } else if !consent.terms_current {
        Some(TelemetryUploadRefusal::TermsOutdated)
    } else {
        None
    }
}
