use crate::kernel::transaction::{Transaction, TransactionManager};
use citadel_workspace_types::structs::UserRole;

// Define the submodules
mod member_operations;
pub mod permission_checks;
mod role_permissions;
mod transaction_operations;

// Re-export key functions and types for external users
pub use role_permissions::retrieve_role_permissions;
pub use transaction_operations::TransactionManagerExt;

/// Helper enum to distinguish domain types for permission mapping
#[derive(Debug)]
pub enum DomainType {
    Workspace,
    Office,
    Room,
}

impl TransactionManager {
    /// Checks if a user has admin privileges
    pub fn is_admin(&self, user_id: &str) -> bool {
        self.with_read_transaction(|tx| {
            Ok(tx
                .get_user(user_id)
                .map(|u| u.role == UserRole::Admin)
                .unwrap_or(false))
        })
        .unwrap_or(false)
    }
}
