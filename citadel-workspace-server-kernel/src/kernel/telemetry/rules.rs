//! The Telemetry Service's decisions, with no I/O: what is valid, what is current, what is kept.

use super::records::{ConsentRecord, StoredSegment, UserTelemetryIndex, WorkspaceTermsRecord};
use citadel_workspace_types::telemetry::{
    SupportAccess, TelemetryAccessLogEntry, TelemetryBatch, TelemetryEntry, TelemetryFilter,
    TelemetryPage, TelemetryPolicy, TelemetryUploadRefusal, MAX_SUPPORT_ACCESS_GRANT_MS,
    MAX_TELEMETRY_ACCESS_LOG_ENTRIES, MAX_TELEMETRY_BATCH_BYTES, MAX_TELEMETRY_BATCH_ENTRIES,
    MAX_TELEMETRY_PAGE_RECORDS, MAX_TELEMETRY_PER_USER_BYTES, MAX_TELEMETRY_RETENTION_DAYS,
    TELEMETRY_BATCH_FORMAT_VERSION,
};
use citadel_workspace_types::terms::{
    CurrentTerms, MyConsent, TermsDocument, MAX_WORKSPACE_TERMS_CHARS, PLATFORM_TERMS_TEXT,
    PLATFORM_TERMS_VERSION,
};

const MS_PER_DAY: u64 = 24 * 60 * 60 * 1000;
/// The version the first workspace terms an admin writes are given.
const FIRST_WORKSPACE_TERMS_VERSION: u32 = 1;

pub(crate) fn current_terms(workspace: Option<&WorkspaceTermsRecord>) -> CurrentTerms {
    CurrentTerms {
        platform: TermsDocument {
            version: PLATFORM_TERMS_VERSION,
            text: PLATFORM_TERMS_TEXT.to_string(),
        },
        workspace: workspace.and_then(|record| {
            record.text.as_ref().map(|text| TermsDocument {
                version: record.version,
                text: text.clone(),
            })
        }),
    }
}

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

pub(crate) fn validate_batch(batch: &TelemetryBatch) -> Result<(), String> {
    if batch.format_version != TELEMETRY_BATCH_FORMAT_VERSION {
        return Err(format!(
            "Telemetry batch format {} is not {TELEMETRY_BATCH_FORMAT_VERSION}",
            batch.format_version
        ));
    }
    if batch.entries.is_empty() {
        return Err("A telemetry batch must carry at least one entry".to_string());
    }
    if batch.entries.len() > MAX_TELEMETRY_BATCH_ENTRIES {
        return Err(format!(
            "A telemetry batch carries at most {MAX_TELEMETRY_BATCH_ENTRIES} entries"
        ));
    }
    super::entry_rules::validate_entries(&batch.entries)
}

/// The bytes a stored segment occupies, refused when one batch is over the batch cap.
pub(crate) fn segment_bytes(serialised_len: usize) -> Result<u64, String> {
    if serialised_len > MAX_TELEMETRY_BATCH_BYTES {
        return Err(format!(
            "A telemetry batch is at most {MAX_TELEMETRY_BATCH_BYTES} bytes"
        ));
    }
    Ok(serialised_len as u64)
}

/// A policy within the platform maxima. The per-user cap must hold at least one batch, so the
/// newest upload always survives its own enforcement.
pub(crate) fn validate_policy(
    retention_days: u32,
    per_user_bytes: u64,
) -> Result<TelemetryPolicy, String> {
    if !(1..=MAX_TELEMETRY_RETENTION_DAYS).contains(&retention_days) {
        return Err(format!(
            "Retention must be 1 to {MAX_TELEMETRY_RETENTION_DAYS} days"
        ));
    }
    let min_bytes = MAX_TELEMETRY_BATCH_BYTES as u64;
    if !(min_bytes..=MAX_TELEMETRY_PER_USER_BYTES).contains(&per_user_bytes) {
        return Err(format!(
            "The per-user limit must be {min_bytes} to {MAX_TELEMETRY_PER_USER_BYTES} bytes"
        ));
    }
    Ok(TelemetryPolicy {
        retention_days,
        per_user_bytes,
    })
}

/// Whether a segment stored at `received_at_ms` is past retention at `now_ms`.
pub(crate) fn is_expired(received_at_ms: u64, policy: &TelemetryPolicy, now_ms: u64) -> bool {
    let retention_ms = u64::from(policy.retention_days).saturating_mul(MS_PER_DAY);
    received_at_ms.saturating_add(retention_ms) <= now_ms
}

/// The segments to delete, oldest first: those past retention, then the oldest of the rest
/// until the user is within the byte cap.
pub(crate) fn segments_to_drop(
    index: &UserTelemetryIndex,
    policy: &TelemetryPolicy,
    now_ms: u64,
) -> Vec<u64> {
    let mut kept_bytes: u64 = index.segments.iter().map(|s| s.bytes).sum();
    let mut drop = Vec::new();
    for segment in &index.segments {
        let expired = is_expired(segment.received_at_ms, policy, now_ms);
        if expired || kept_bytes > policy.per_user_bytes {
            kept_bytes -= segment.bytes;
            drop.push(segment.seq);
        }
    }
    drop
}

pub(crate) fn validate_support_access(
    enabled: bool,
    until_ms: Option<u64>,
    now_ms: u64,
) -> Result<SupportAccess, String> {
    if !enabled {
        return Ok(SupportAccess {
            enabled: false,
            until_ms: None,
        });
    }
    let latest = now_ms.saturating_add(MAX_SUPPORT_ACCESS_GRANT_MS);
    match until_ms {
        Some(until) if until > now_ms && until <= latest => Ok(SupportAccess {
            enabled: true,
            until_ms: Some(until),
        }),
        _ => Err(format!(
            "Support access needs an expiry in the future, at most {MAX_SUPPORT_ACCESS_GRANT_MS} ms ahead"
        )),
    }
}

pub(crate) fn support_access_active(access: &SupportAccess, now_ms: u64) -> bool {
    access.enabled && access.until_ms.is_some_and(|until| now_ms < until)
}

pub(crate) fn validate_page(page: &TelemetryPage) -> Result<(), String> {
    if page.limit == 0 || page.limit > MAX_TELEMETRY_PAGE_RECORDS {
        return Err(format!(
            "A telemetry page holds 1 to {MAX_TELEMETRY_PAGE_RECORDS} records"
        ));
    }
    Ok(())
}

pub(crate) fn user_matches(filter: &TelemetryFilter, user_id: &str) -> bool {
    filter.user_id.as_deref().is_none_or(|u| u == user_id)
}

pub(crate) fn entry_matches(filter: &TelemetryFilter, entry: &TelemetryEntry) -> bool {
    filter
        .peer_cid
        .is_none_or(|cid| entry.peer_cid == Some(cid))
        && filter.min_level.is_none_or(|level| entry.level >= level)
        && filter.since_ms.is_none_or(|since| entry.time_ms >= since)
        && filter.until_ms.is_none_or(|until| entry.time_ms <= until)
}

/// A segment's matching entries, newest first.
pub(crate) fn matching_entries<'a>(
    filter: &'a TelemetryFilter,
    segment: &'a StoredSegment,
) -> impl Iterator<Item = &'a TelemetryEntry> + 'a {
    segment
        .entries
        .iter()
        .rev()
        .filter(move |entry| entry_matches(filter, entry))
}

pub(crate) fn push_access_log(
    log: &mut Vec<TelemetryAccessLogEntry>,
    row: TelemetryAccessLogEntry,
) {
    log.push(row);
    let excess = log.len().saturating_sub(MAX_TELEMETRY_ACCESS_LOG_ENTRIES);
    log.drain(..excess);
}

/// The workspace terms after an admin sets `text`, or `None` when nothing changes.
pub(crate) fn next_workspace_terms(
    current: Option<&WorkspaceTermsRecord>,
    text: Option<&str>,
) -> Result<Option<WorkspaceTermsRecord>, String> {
    let text = text.map(str::trim);
    if let Some(text) = text {
        if text.is_empty() {
            return Err("Workspace terms cannot be empty; clear them instead".to_string());
        }
        if text.chars().count() > MAX_WORKSPACE_TERMS_CHARS {
            return Err(format!(
                "Workspace terms are at most {MAX_WORKSPACE_TERMS_CHARS} characters"
            ));
        }
    }
    let current_text = current.and_then(|c| c.text.as_deref());
    if current_text == text {
        return Ok(None);
    }
    Ok(Some(WorkspaceTermsRecord {
        version: current.map_or(FIRST_WORKSPACE_TERMS_VERSION, |c| c.version + 1),
        text: text.map(str::to_string),
    }))
}
