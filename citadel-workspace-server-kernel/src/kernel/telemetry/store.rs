//! The Telemetry Service's I/O: typed reads and writes of its records, nothing decided here.

use super::records::{
    consent_key, index_key, segment_key, ConsentRecord, StoredSegment, UserTelemetryIndex,
    WorkspaceTermsRecord, ACCESS_LOG_KEY, POLICY_KEY, SUPPORT_ACCESS_KEY, USERS_KEY,
    WORKSPACE_TERMS_KEY,
};
use crate::kernel::transaction::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::telemetry::{
    SupportAccess, TelemetryAccessLogEntry, TelemetryPolicy, DEFAULT_TELEMETRY_POLICY,
};
use std::collections::BTreeSet;

/// Support access a workspace has until its admin grants it: none.
const NO_SUPPORT_ACCESS: SupportAccess = SupportAccess {
    enabled: false,
    until_ms: None,
};

pub(crate) struct TelemetryStore<'a, R: Ratchet + Send + Sync + 'static> {
    backend: &'a BackendTransactionManager<R>,
    /// Configuration, not stored: see `ServerConfig::require_platform_terms`.
    platform_terms_required: bool,
    /// Configuration, not stored: whether the host meters TURN (`TurnUsageSink`).
    meters_turn: bool,
}

impl<'a, R: Ratchet + Send + Sync + 'static> TelemetryStore<'a, R> {
    pub(crate) fn new(
        backend: &'a BackendTransactionManager<R>,
        platform_terms_required: bool,
        meters_turn: bool,
    ) -> Self {
        Self {
            backend,
            platform_terms_required,
            meters_turn,
        }
    }

    pub(crate) fn platform_terms_required(&self) -> bool {
        self.platform_terms_required
    }

    pub(crate) fn meters_turn(&self) -> bool {
        self.meters_turn
    }

    pub(crate) async fn users(&self) -> Result<BTreeSet<String>, NetworkError> {
        Ok(self
            .backend
            .get_record(USERS_KEY)
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn save_users(&self, users: &BTreeSet<String>) -> Result<(), NetworkError> {
        self.backend.save_record(USERS_KEY, users).await
    }

    pub(crate) async fn index(&self, user_id: &str) -> Result<UserTelemetryIndex, NetworkError> {
        Ok(self
            .backend
            .get_record(&index_key(user_id))
            .await?
            .unwrap_or_else(UserTelemetryIndex::empty))
    }

    pub(crate) async fn save_index(
        &self,
        user_id: &str,
        index: &UserTelemetryIndex,
    ) -> Result<(), NetworkError> {
        self.backend.save_record(&index_key(user_id), index).await
    }

    /// `None` when the index lists a segment whose write never landed.
    pub(crate) async fn segment(
        &self,
        user_id: &str,
        seq: u64,
    ) -> Result<Option<StoredSegment>, NetworkError> {
        self.backend.get_record(&segment_key(user_id, seq)).await
    }

    pub(crate) async fn save_segment(
        &self,
        user_id: &str,
        seq: u64,
        segment: &StoredSegment,
    ) -> Result<(), NetworkError> {
        self.backend
            .save_record(&segment_key(user_id, seq), segment)
            .await
    }

    pub(crate) async fn delete_segments(
        &self,
        user_id: &str,
        seqs: &[u64],
    ) -> Result<(), NetworkError> {
        for seq in seqs {
            self.backend
                .delete_record(&segment_key(user_id, *seq))
                .await?;
        }
        Ok(())
    }

    pub(crate) async fn consent(&self, user_id: &str) -> Result<ConsentRecord, NetworkError> {
        Ok(self
            .backend
            .get_record(&consent_key(user_id))
            .await?
            .unwrap_or_else(ConsentRecord::none))
    }

    pub(crate) async fn save_consent(
        &self,
        user_id: &str,
        consent: &ConsentRecord,
    ) -> Result<(), NetworkError> {
        self.backend
            .save_record(&consent_key(user_id), consent)
            .await
    }

    pub(crate) async fn policy(&self) -> Result<TelemetryPolicy, NetworkError> {
        Ok(self
            .backend
            .get_record(POLICY_KEY)
            .await?
            .unwrap_or(DEFAULT_TELEMETRY_POLICY))
    }

    pub(crate) async fn save_policy(&self, policy: &TelemetryPolicy) -> Result<(), NetworkError> {
        self.backend.save_record(POLICY_KEY, policy).await
    }

    pub(crate) async fn support_access(&self) -> Result<SupportAccess, NetworkError> {
        Ok(self
            .backend
            .get_record(SUPPORT_ACCESS_KEY)
            .await?
            .unwrap_or(NO_SUPPORT_ACCESS))
    }

    pub(crate) async fn save_support_access(
        &self,
        access: &SupportAccess,
    ) -> Result<(), NetworkError> {
        self.backend.save_record(SUPPORT_ACCESS_KEY, access).await
    }

    /// Oldest first.
    pub(crate) async fn access_log(&self) -> Result<Vec<TelemetryAccessLogEntry>, NetworkError> {
        Ok(self
            .backend
            .get_record(ACCESS_LOG_KEY)
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn save_access_log(
        &self,
        log: &Vec<TelemetryAccessLogEntry>,
    ) -> Result<(), NetworkError> {
        self.backend.save_record(ACCESS_LOG_KEY, log).await
    }

    pub(crate) async fn workspace_terms(
        &self,
    ) -> Result<Option<WorkspaceTermsRecord>, NetworkError> {
        self.backend.get_record(WORKSPACE_TERMS_KEY).await
    }

    pub(crate) async fn save_workspace_terms(
        &self,
        terms: &WorkspaceTermsRecord,
    ) -> Result<(), NetworkError> {
        self.backend.save_record(WORKSPACE_TERMS_KEY, terms).await
    }
}
