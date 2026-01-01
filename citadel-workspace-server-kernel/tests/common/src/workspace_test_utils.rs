use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use std::sync::Arc;

/// Helper function to create a test kernel with an admin user
///
/// Creates a complete test environment with:
/// - An AsyncWorkspaceServerKernel with admin user pre-configured
/// - Admin user: "admin-user" with password "admin-password"
/// - Root workspace pre-created and ready for operations
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

    // Inject admin user
    kernel
        .inject_admin_user("admin-password")
        .await
        .expect("Failed to inject admin user");

    Arc::new(kernel)
}
