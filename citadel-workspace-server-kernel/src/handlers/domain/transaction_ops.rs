//! # Transaction Operations Module
//!
//! This module defines transaction management operations for the domain system,
//! providing safe read and write transaction handling with automatic rollback on errors.

use citadel_sdk::prelude::{NetworkError, Ratchet};
use crate::kernel::transaction::Transaction;

/// Transaction management operations for the domain operations trait.
///
/// This module provides extension methods for handling database transactions
/// safely within the domain operations system.
pub trait TransactionOperations<R: Ratchet + Send + Sync + 'static> {
    
    // ────────────────────────────────────────────────────────────────────────────
    // TRANSACTION MANAGEMENT OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Executes a function within a read-only transaction context.
    ///
    /// Read transactions provide consistent snapshots of data and are safe
    /// for concurrent access. Use for all query and validation operations.
    ///
    /// # Arguments
    /// * `f` - Function to execute within the read transaction
    ///
    /// # Returns
    /// * `Ok(T)` - Function executed successfully with result
    /// * `Err(NetworkError)` - Transaction or function execution failed
    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>;

    /// Executes a function within a read-write transaction context.
    ///
    /// Write transactions provide exclusive access for data modifications
    /// with automatic rollback on errors. Use for all create, update, and delete operations.
    ///
    /// # Arguments
    /// * `f` - Function to execute within the write transaction
    ///
    /// # Returns
    /// * `Ok(T)` - Function executed successfully with result
    /// * `Err(NetworkError)` - Transaction or function execution failed (automatic rollback)
    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>;
}
