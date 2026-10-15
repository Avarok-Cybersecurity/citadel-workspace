//! Typed records under one key each, for kernel services that keep their own state.
//!
//! The telemetry store and the startup migrations persist through these, so they reach the
//! backend the same way every other record does (JSON values, the retrying save, test-mode
//! storage) without each growing its own copy of that path.

use super::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use serde::de::DeserializeOwned;
use serde::Serialize;

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn get_record<T: DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, NetworkError> {
        self.backend_get(key).await
    }

    pub(crate) async fn save_record<T: Serialize>(
        &self,
        key: &str,
        value: &T,
    ) -> Result<(), NetworkError> {
        self.backend_save(key, value).await
    }

    pub(crate) async fn delete_record(&self, key: &str) -> Result<(), NetworkError> {
        self.backend_delete(key).await
    }
}
