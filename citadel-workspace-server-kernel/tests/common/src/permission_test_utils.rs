use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_types::structs::{User, UserRole};
use std::collections::HashMap;
use std::sync::Arc;

/// Standard admin password used across permission tests
pub const ADMIN_PASSWORD: &str = "admin_password";

/// Helper function to create a test user with specified role
///
/// Creates a test user with:
/// - Formatted name based on ID
/// - Specified user role
/// - Empty permissions map (to be populated by tests)
/// - Default metadata
pub fn create_test_user(id: &str, role: UserRole) -> User {
    User {
        id: id.to_string(),
        name: format!("Test {}", id),
        role,
        permissions: HashMap::new(),
        metadata: Default::default(),
    }
}

/// Helper to setup a test environment with admin, domains, and test infrastructure
///
/// Creates a complete test environment with:
/// - AsyncWorkspaceServerKernel with admin user pre-configured
/// - AsyncDomainServerOperations for domain management
/// - Logging setup for test debugging
///
/// Returns the kernel and domain operations
pub async fn setup_test_environment() -> (
    Arc<AsyncWorkspaceServerKernel<StackedRatchet>>,
    AsyncDomainServerOperations<StackedRatchet>,
) {
    citadel_logging::setup_log();
    let kernel = Arc::new(
        AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
            ADMIN_PASSWORD,
        )
        .await
        .expect("Failed to create kernel with admin"),
    );
    let domain_ops = kernel.domain_ops().clone();

    (kernel, domain_ops)
}
