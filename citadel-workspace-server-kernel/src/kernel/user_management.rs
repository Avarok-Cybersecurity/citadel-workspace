use super::core::WorkspaceServerKernel;
use crate::kernel::transaction::rbac::transaction_operations::TransactionManagerExt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{User, UserRole};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Inject a user for testing purposes
    /// 
    /// This method provides a simple way to add users to the system for testing:
    /// - Creates a user with the specified username and role
    /// - Uses username for both ID and display name for simplicity
    /// - Is idempotent - won't error if the user already exists
    /// - Provides console output for test debugging
    /// 
    /// **Note:** This method is intended for testing only and should not be used in production.
    pub fn inject_user_for_test(&self, username: &str, role: UserRole) -> Result<(), NetworkError> {
        self.tx_manager().with_write_transaction(|tx| {
            let user_id_string = username.to_string();
            if tx.get_user(&user_id_string).is_some() {
                // For tests, if user already exists, we might not want to error out,
                // or we might want a specific error. For now, let's allow re-injection to be idempotent for simplicity.
                // If strict "already exists" is needed, return Err(NetworkError::user_exists(username));
                println!(
                    "[INJECT_USER_FOR_TEST] User {} already exists. Skipping creation.",
                    username
                );
                return Ok(());
            }
            // Use username for both id and name for simplicity in tests
            let user = User::new(user_id_string.clone(), user_id_string.clone(), role.clone()); // Clone role here
            tx.insert_user(username.to_string(), user)?;
            println!(
                "[INJECT_USER_FOR_TEST] Successfully injected user {} with role {:?}.",
                username, role
            ); // Original role can now be used
            Ok(())
        })
    }
} 