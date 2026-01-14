use crate::kernel::transaction::read::ReadTransaction;
use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::TransactionManager;
use citadel_logging::{debug, error};
use citadel_sdk::prelude::NetworkError;
use parking_lot::RwLock;
use std::sync::Arc;

impl TransactionManager {
    /// Create a new read transaction
    ///
    /// Read transactions allow for querying the current state without making changes
    pub fn read_transaction(&self) -> ReadTransaction {
        let domains = self.domains.read();
        let users = self.users.read();
        let workspaces = self.workspaces.read();
        let workspace_password = self.workspace_password.read();

        ReadTransaction::new(domains, users, workspaces, workspace_password)
    }

    /// Create a new write transaction
    ///
    /// Note: As per the Citadel Workspace transaction system behavior, changes made during a
    /// transaction are immediately applied to the in-memory storage. The commit() method
    /// is a no-op for in-memory storage.
    ///
    /// If the transaction returns an error, the changes are NOT automatically rolled back
    /// from the in-memory storage. This must be handled explicitly if rollback behavior
    /// is desired.
    pub fn write_transaction(&self) -> WriteTransaction {
        let domains = self.domains.write();
        let users = self.users.write();
        let workspaces = self.workspaces.write();
        let workspace_password = self.workspace_password.write();

        WriteTransaction::new(
            domains,
            users,
            workspaces,
            workspace_password,
        )
    }

    /// Execute a function with a read transaction
    ///
    /// This method creates a read transaction, passes it to the provided function,
    /// and returns the result. This is a convenience method to avoid having to
    /// create and manage the transaction manually.
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&ReadTransaction) -> Result<T, NetworkError>,
    {
        let tx = self.read_transaction();
        f(&tx)
    }

    /// Execute a function with a write transaction
    ///
    /// This method creates a write transaction, passes it to the provided function,
    /// commits the transaction if the function returns Ok, and returns the result.
    ///
    /// Note: As per the Citadel Workspace transaction system behavior, changes made during the
    /// transaction function are immediately applied to the in-memory storage. If the function
    /// returns an error, changes are NOT automatically rolled back unless you explicitly call
    /// tx.rollback() before returning the error.
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut WriteTransaction) -> Result<T, NetworkError>,
    {
        let mut tx = self.write_transaction();
        match f(&mut tx) {
            Ok(result) => {
                if let Err(e) = tx.commit() {
                    error!(target: "citadel", "Error committing transaction: {:?}", e);
                    return Err(e);
                }
                Ok(result)
            }
            Err(e) => {
                // Note: No automatic rollback here - changes made during the transaction
                // will persist in memory even though the transaction failed.
                // To implement rollback behavior, the closure should explicitly call
                // tx.rollback() before returning an error.
                debug!(target: "citadel", "Error in transaction: {:?}", e);
                Err(e)
            }
        }
    }
}

/// Extension trait for TransactionManager to provide convenient transaction methods
/// when wrapped in Arc<RwLock<>>
pub trait TransactionManagerExt {
    /// Execute a function with a read transaction
    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&ReadTransaction) -> Result<T, NetworkError>;

    /// Execute a function with a write transaction
    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut WriteTransaction) -> Result<T, NetworkError>;
}

impl TransactionManagerExt for Arc<RwLock<TransactionManager>> {
    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&ReadTransaction) -> Result<T, NetworkError>,
    {
        let tm = self.read();
        tm.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut WriteTransaction) -> Result<T, NetworkError>,
    {
        let tm = self.read();
        tm.with_write_transaction(f)
    }
}
