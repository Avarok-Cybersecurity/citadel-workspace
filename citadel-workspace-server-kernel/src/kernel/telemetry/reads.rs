//! The Telemetry Service's reads, and the admin settings. Every telemetry read is audited.

use super::rules;
use super::store::TelemetryStore;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::telemetry::{
    TelemetryAccessLogEntry, TelemetryAccessor, TelemetryFilter, TelemetryPage,
    TelemetryPageResult, TelemetryRecord, TelemetryResponse, TelemetrySettings,
    MAX_TELEMETRY_PER_USER_BYTES, MAX_TELEMETRY_RETENTION_DAYS,
};

fn reply(response: TelemetryResponse) -> WorkspaceProtocolResponse {
    WorkspaceProtocolResponse::Telemetry(response)
}

/// One page of matching records, newest first, recorded in the access log as `accessor`'s.
pub(crate) async fn list<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    accessor: TelemetryAccessor,
    filter: &TelemetryFilter,
    page: &TelemetryPage,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if let Err(e) = rules::validate_page(page) {
        return Ok(WorkspaceProtocolResponse::Error(e));
    }
    let policy = store.policy().await?;
    let mut segments = Vec::new();
    for user_id in store.users().await? {
        if !rules::user_matches(filter, &user_id) {
            continue;
        }
        for meta in store.index(&user_id).await?.segments {
            // Past retention but not yet purged: already not kept.
            if !rules::is_expired(meta.received_at_ms, &policy, now_ms) {
                segments.push((meta.received_at_ms, meta.seq, user_id.clone()));
            }
        }
    }
    segments.sort_by(|a, b| b.cmp(a));

    let wanted = page.offset as usize + page.limit as usize;
    let mut matched = 0usize;
    let mut records = Vec::new();
    let mut has_more = false;
    'segments: for (_, seq, user_id) in segments {
        let Some(segment) = store.segment(&user_id, seq).await? else {
            continue;
        };
        for entry in rules::matching_entries(filter, &segment) {
            if matched == wanted {
                has_more = true;
                break 'segments;
            }
            if matched >= page.offset as usize {
                records.push(TelemetryRecord {
                    user_id: user_id.clone(),
                    received_at_ms: segment.received_at_ms,
                    agent_version: segment.agent_version.clone(),
                    os: segment.os.clone(),
                    entry: entry.clone(),
                });
            }
            matched += 1;
        }
    }

    let mut log = store.access_log().await?;
    rules::push_access_log(
        &mut log,
        TelemetryAccessLogEntry {
            at_ms: now_ms,
            accessor,
            filter: filter.clone(),
            returned: records.len() as u32,
        },
    );
    store.save_access_log(&log).await?;
    Ok(reply(TelemetryResponse::Page(TelemetryPageResult {
        records,
        has_more,
    })))
}

pub(crate) async fn settings<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(reply(TelemetryResponse::Settings(TelemetrySettings {
        policy: store.policy().await?,
        max_retention_days: MAX_TELEMETRY_RETENTION_DAYS,
        max_per_user_bytes: MAX_TELEMETRY_PER_USER_BYTES,
        support_access: store.support_access().await?,
    })))
}

/// A lower limit applies at once, to what is already stored.
pub(crate) async fn set_policy<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    retention_days: u32,
    per_user_bytes: u64,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let policy = match rules::validate_policy(retention_days, per_user_bytes) {
        Ok(policy) => policy,
        Err(e) => return Ok(WorkspaceProtocolResponse::Error(e)),
    };
    store.save_policy(&policy).await?;
    super::service::enforce_policy(store, &policy, now_ms).await?;
    settings(store).await
}

pub(crate) async fn set_support_access<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    enabled: bool,
    until_ms: Option<u64>,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    match rules::validate_support_access(enabled, until_ms, now_ms) {
        Ok(access) => store.save_support_access(&access).await?,
        Err(e) => return Ok(WorkspaceProtocolResponse::Error(e)),
    }
    settings(store).await
}

/// Newest first.
pub(crate) async fn access_log<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let mut log = store.access_log().await?;
    log.reverse();
    Ok(reply(TelemetryResponse::AccessLog(log)))
}
