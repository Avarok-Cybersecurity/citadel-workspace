use crate::kernel::transaction::read::ReadTransaction;
use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::{Transaction, TransactionManager};
use citadel_logging::{debug, error, info};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole};
use citadel_workspace_types::UpdateOperation;
use parking_lot::RwLock;
use std::collections::HashSet;
use std::sync::Arc;

// Define the submodules
mod permission_checks;
mod member_operations;
mod transaction_operations;
mod role_permissions;

// Re-export key functions and types for external users
pub use permission_checks::*;
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
