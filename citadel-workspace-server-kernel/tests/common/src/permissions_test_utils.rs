use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_types::structs::{User, UserRole};
use std::collections::HashMap;
use std::sync::Arc;

/// Standard admin password used across permission tests
pub const ADMIN_PASSWORD: &str = "admin_password";

/// Helper function to create a test user with specified role for permission testing
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

/// Helper to setup a test environment specifically for permission testing
///
/// Creates a complete test environment with:
/// - Backend-based AsyncWorkspaceServerKernel for isolated testing
/// - AsyncWorkspaceServerKernel with workspace initialized
/// - AsyncDomainServerOperations for domain management
/// - Logging setup for test debugging
///
/// Note: No admin user is pre-created. Tests should create their own admin users.
///
/// Returns the kernel and domain operations
pub async fn setup_permissions_test_environment() -> (
    Arc<AsyncWorkspaceServerKernel<MonoRatchet>>,
    AsyncDomainServerOperations<MonoRatchet>,
) {
    citadel_logging::setup_log();

    let kernel = AsyncWorkspaceServerKernel::<MonoRatchet>::new(None);

    // Initialize the backend
    kernel
        .domain_operations
        .backend_tx_manager
        .init()
        .await
        .expect("Failed to initialize backend");

    // Initialize workspace (no admin user created)
    kernel
        .inject_admin_user(ADMIN_PASSWORD)
        .await
        .expect("Failed to initialize workspace");

    let domain_ops = kernel.domain_ops().clone();

    (Arc::new(kernel), domain_ops)
}

/// Helper to setup a test environment with custom admin for permission testing
///
/// Creates a test environment with a custom admin user.
/// The admin user is created and inserted into the kernel.
///
/// Returns the kernel, domain operations, and admin ID
pub async fn setup_custom_admin_test_environment(
    admin_id: &str,
) -> (
    Arc<AsyncWorkspaceServerKernel<MonoRatchet>>,
    AsyncDomainServerOperations<MonoRatchet>,
    String,
) {
    citadel_logging::setup_log();

    let kernel = AsyncWorkspaceServerKernel::<MonoRatchet>::new(None);

    // Initialize the backend
    kernel
        .domain_operations
        .backend_tx_manager
        .init()
        .await
        .expect("Failed to initialize backend");

    // Initialize workspace (no admin user created)
    kernel
        .inject_admin_user(ADMIN_PASSWORD)
        .await
        .expect("Failed to initialize workspace");

    // Create and insert the custom admin user
    let admin_user = create_test_user(admin_id, UserRole::Admin);
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(admin_id.to_string(), admin_user)
        .await
        .expect("Failed to insert admin user");

    let domain_ops = kernel.domain_ops().clone();

    (Arc::new(kernel), domain_ops, admin_id.to_string())
}
