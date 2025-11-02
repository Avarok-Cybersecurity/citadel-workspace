//! # Async Transaction Operations Module
//!
//! This module provides async transaction management operations

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::future::Future;

/// Async transaction management operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncTransactionOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Executes an async function within a read-only transaction context
    async fn with_read_transaction<F, Fut, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = Result<T, NetworkError>> + Send,
        T: Send;

    /// Executes an async function within a read-write transaction context
    async fn with_write_transaction<F, Fut, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = Result<T, NetworkError>> + Send,
        T: Send;
}
