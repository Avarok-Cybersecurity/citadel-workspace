use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, User, UserRole};
use std::collections::HashMap;
use std::sync::Arc;

/// Test admin user ID used by execute_command
pub const TEST_ADMIN_USER_ID: &str = "__test_admin_user";

/// Admin password for test workspace
pub const TEST_ADMIN_PASSWORD: &str = "admin-password";

/// Helper function to create a test kernel with an admin user
///
/// Creates a complete test environment with:
/// - An AsyncWorkspaceServerKernel with admin user pre-configured
/// - Admin user: TEST_ADMIN_USER_ID with Admin role
/// - Root workspace pre-created and ready for operations
/// - Test admin is added as a member of the workspace
///
/// Returns the kernel instance
pub async fn create_test_kernel() -> Arc<AsyncWorkspaceServerKernel<MonoRatchet>> {
    // Create kernel without node_remote
    let kernel = AsyncWorkspaceServerKernel::<MonoRatchet>::new(None);

    // Initialize the backend without node_remote for testing
    // The backend will use a default in-memory storage
    kernel
        .domain_operations
        .backend_tx_manager
        .init()
        .await
        .expect("Failed to initialize backend");

    // Initialize workspace (no longer creates a hardcoded admin user)
    kernel
        .inject_admin_user(TEST_ADMIN_PASSWORD)
        .await
        .expect("Failed to initialize workspace");

    // Create test admin user for running test commands
    let admin_user = User {
        id: TEST_ADMIN_USER_ID.to_string(),
        name: "Test Admin".to_string(),
        role: UserRole::Admin,
        permissions: HashMap::new(),
        metadata: Default::default(),
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(TEST_ADMIN_USER_ID.to_string(), admin_user)
        .await
        .expect("Failed to insert test admin user");

    // Add test admin to workspace members
    let mut workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get workspace")
        .expect("Workspace should exist");

    workspace.members.push(TEST_ADMIN_USER_ID.to_string());
    // Also set the test admin as owner for tests
    workspace.owner_id = TEST_ADMIN_USER_ID.to_string();

    kernel
        .domain_operations
        .backend_tx_manager
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace.clone())
        .await
        .expect("Failed to update workspace");

    // Update domain as well
    let ws_domain = Domain::Workspace { workspace };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_domain(WORKSPACE_ROOT_ID.to_string(), ws_domain)
        .await
        .expect("Failed to update domain");

    Arc::new(kernel)
}
