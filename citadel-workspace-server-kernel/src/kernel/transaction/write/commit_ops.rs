use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::write::WriteTransaction;
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use bincode;

impl<'a> WriteTransaction<'a> {
    /// Commit transaction changes to the database
    ///
    /// Note: As per the Citadel Workspace transaction system behavior, changes made during a 
    /// transaction are immediately applied to the in-memory storage. This commit() method 
    /// only syncs those changes to the backend store (RocksDB).
    pub fn commit(&self) -> Result<(), NetworkError> {
        debug!("Committing transaction changes to database");
        
        // Note that in-memory changes are already applied at this point
        
        // Create a write batch for RocksDB
        let mut batch = rocksdb::WriteBatch::default();

        // Process domain changes
        for domain in self.domains.values() {
            let serialized = bincode::serialize(domain)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize domain: {}", e)))?;

            // Add to write batch
            batch.put(
                format!("domain:{}", domain.id()).as_bytes(),
                serialized.as_slice(),
            );
        }

        // Process user changes
        for user in self.users.values() {
            let serialized = bincode::serialize(user)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize user: {}", e)))?;

            // Add to write batch
            batch.put(
                format!("user:{}", user.id).as_bytes(),
                serialized.as_slice(),
            );
        }

        // Process workspace changes
        for workspace in self.workspaces.values() {
            let serialized = bincode::serialize(workspace)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize workspace: {}", e)))?;

            // Add to write batch
            batch.put(
                format!("workspace:{}", workspace.id).as_bytes(),
                serialized.as_slice(),
            );
        }

        // Process workspace passwords
        for (workspace_id, password) in self.workspace_password.iter() {
            let serialized = bincode::serialize(password)
                .map_err(|e| {
                    NetworkError::msg(format!("Failed to serialize workspace password: {}", e))
                })?;

            // Add to write batch
            batch.put(
                format!("workspace_password:{}", workspace_id).as_bytes(),
                serialized.as_slice(),
            );
        }

        // Commit the write batch to the database
        self.db.write(batch).map_err(|e| {
            NetworkError::msg(format!("Failed to write batch to database: {}", e))
        })?;

        debug!("Transaction committed successfully");
        Ok(())
    }
}
