//! The Telemetry Service's writes: terms, consent, uploads, erasure and retention.
//!
//! Callers hold `TELEMETRY_LOCK` (see `mod.rs`). Write order keeps the index a superset of
//! the segments that exist: segments are deleted before the index stops listing them, and the
//! index lists a new segment before it is written. A crash in between leaves an index entry
//! with no segment, which reads skip and retention removes, and never a segment nothing lists.

use super::records::{SegmentMeta, StoredSegment};
use super::rules;
use super::store::TelemetryStore;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::telemetry::{TelemetryBatch, TelemetryPolicy, TelemetryResponse};
use citadel_workspace_types::terms::CurrentTerms;

fn reply(response: TelemetryResponse) -> WorkspaceProtocolResponse {
    WorkspaceProtocolResponse::Telemetry(response)
}

fn refuse(message: impl Into<String>) -> WorkspaceProtocolResponse {
    WorkspaceProtocolResponse::Error(message.into())
}

pub(crate) async fn current_terms<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
) -> Result<CurrentTerms, NetworkError> {
    Ok(rules::current_terms(
        store.workspace_terms().await?.as_ref(),
    ))
}

pub(crate) async fn my_consent<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let terms = current_terms(store).await?;
    let consent = store.consent(user_id).await?;
    Ok(reply(TelemetryResponse::Consent(rules::consent_view(
        &consent,
        &terms,
        store.platform_terms_required(),
    ))))
}

pub(crate) async fn accept_terms<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    user_id: &str,
    platform_version: u32,
    workspace_version: Option<u32>,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let terms = current_terms(store).await?;
    let require_platform = store.platform_terms_required();
    if !rules::terms_accepted(
        &terms,
        require_platform,
        Some(platform_version),
        workspace_version,
    ) {
        return Ok(refuse(
            "These are not the current terms; read them again with GetTerms",
        ));
    }
    let mut consent = store.consent(user_id).await?;
    consent.accepted_platform_version = require_platform.then_some(platform_version);
    consent.accepted_workspace_version = workspace_version;
    consent.accepted_at_ms = Some(now_ms);
    store.save_consent(user_id, &consent).await?;
    my_consent(store, user_id).await
}

/// Turning telemetry off deletes what was stored.
pub(crate) async fn set_consent<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    user_id: &str,
    enabled: bool,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let terms = current_terms(store).await?;
    let mut consent = store.consent(user_id).await?;
    if enabled
        && !rules::consent_view(&consent, &terms, store.platform_terms_required()).terms_current
    {
        return Ok(refuse(
            "Accept the current terms before turning on diagnostics",
        ));
    }
    if !enabled {
        delete_user(store, user_id).await?;
    }
    consent.telemetry_enabled = enabled;
    consent.telemetry_changed_at_ms = Some(now_ms);
    store.save_consent(user_id, &consent).await?;
    my_consent(store, user_id).await
}

pub(crate) async fn upload<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    user_id: &str,
    batch: &TelemetryBatch,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let terms = current_terms(store).await?;
    let consent = rules::consent_view(
        &store.consent(user_id).await?,
        &terms,
        store.platform_terms_required(),
    );
    if let Some(refusal) = rules::upload_refusal(&consent) {
        return Ok(reply(TelemetryResponse::UploadRefused(refusal)));
    }
    if let Err(e) = rules::validate_batch(batch) {
        return Ok(refuse(e));
    }
    let segment = StoredSegment {
        received_at_ms: now_ms,
        agent_version: batch.agent_version.clone(),
        os: batch.os.clone(),
        entries: batch.entries.clone(),
    };
    let serialised = serde_json::to_vec(&segment)
        .map_err(|e| NetworkError::msg(format!("Failed to measure a telemetry batch: {e}")))?;
    let bytes = match rules::segment_bytes(serialised.len()) {
        Ok(bytes) => bytes,
        Err(e) => return Ok(refuse(e)),
    };

    let mut index = store.index(user_id).await?;
    let seq = index.next_seq;
    index.next_seq += 1;
    index.segments.push(SegmentMeta {
        seq,
        received_at_ms: now_ms,
        bytes,
    });
    let policy = store.policy().await?;
    let dropped = rules::segments_to_drop(&index, &policy, now_ms);
    store.delete_segments(user_id, &dropped).await?;
    index.segments.retain(|s| !dropped.contains(&s.seq));
    store.save_index(user_id, &index).await?;
    store.save_segment(user_id, seq, &segment).await?;

    let mut users = store.users().await?;
    if users.insert(user_id.to_string()) {
        store.save_users(&users).await?;
    }
    Ok(reply(TelemetryResponse::Uploaded {
        stored_entries: batch.entries.len() as u32,
    }))
}

/// Deletes every segment `user_id` has; returns how many there were.
pub(crate) async fn delete_user<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    user_id: &str,
) -> Result<u32, NetworkError> {
    let mut index = store.index(user_id).await?;
    let seqs: Vec<u64> = index.segments.iter().map(|s| s.seq).collect();
    store.delete_segments(user_id, &seqs).await?;
    index.segments.clear();
    store.save_index(user_id, &index).await?;
    let mut users = store.users().await?;
    if users.remove(user_id) {
        store.save_users(&users).await?;
    }
    Ok(seqs.len() as u32)
}

/// Applies retention and the byte cap to every user; returns the segments removed.
pub(crate) async fn enforce_policy<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    policy: &TelemetryPolicy,
    now_ms: u64,
) -> Result<u32, NetworkError> {
    let mut removed = 0u32;
    for user_id in store.users().await? {
        let mut index = store.index(&user_id).await?;
        let dropped = rules::segments_to_drop(&index, policy, now_ms);
        if dropped.is_empty() {
            continue;
        }
        store.delete_segments(&user_id, &dropped).await?;
        index.segments.retain(|s| !dropped.contains(&s.seq));
        store.save_index(&user_id, &index).await?;
        removed += dropped.len() as u32;
    }
    Ok(removed)
}

pub(crate) async fn set_workspace_terms<R: Ratchet + Send + Sync + 'static>(
    store: &TelemetryStore<'_, R>,
    text: Option<&str>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let current = store.workspace_terms().await?;
    match rules::next_workspace_terms(current.as_ref(), text) {
        Err(e) => return Ok(refuse(e)),
        Ok(Some(next)) => store.save_workspace_terms(&next).await?,
        Ok(None) => {}
    }
    Ok(reply(TelemetryResponse::Terms(current_terms(store).await?)))
}
