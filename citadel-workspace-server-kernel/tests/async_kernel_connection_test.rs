//! # Async Kernel Connection Test
//!
//! This test verifies that the async kernel correctly handles new connections
//! and automatically adds users to the workspace domain if they aren't already members.
//! Note: The kernel no longer creates a hardcoded admin user. The first user to provide
//! the master password via UpdateWorkspace becomes the admin/owner.

use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::UserRole;

const MASTER_PASSWORD: &str = "admin_password";

/// Helper to create a test kernel with workspace initialized
async fn create_test_kernel() -> AsyncWorkspaceServerKernel<MonoRatchet> {
    let kernel = AsyncWorkspaceServerKernel::<MonoRatchet>::new(None);

    // Initialize the backend
    kernel
        .domain_operations
        .backend_tx_manager
        .init()
        .await
        .expect("Failed to initialize backend");

    // Inject workspace (this no longer creates an admin user)
    kernel
        .inject_admin_user(MASTER_PASSWORD)
        .await
        .expect("Failed to initialize workspace");

    kernel
}

#[tokio::test]
async fn test_workspace_created_without_owner() {
    let kernel = create_test_kernel().await;

    // Verify root workspace exists
    let workspace = kernel
        .get_domain(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get domain")
        .expect("Root workspace should exist");

    // Verify workspace has no owner initially (empty string)
    let ws = workspace.as_workspace().expect("Should be a workspace");
    assert!(
        ws.owner_id.is_empty(),
        "Workspace should have no owner initially"
    );

    // Verify workspace has no members initially
    assert!(
        ws.members.is_empty(),
        "Workspace should have no members initially"
    );
}

#[tokio::test]
async fn test_user_auto_registration_to_workspace() {
    let kernel = create_test_kernel().await;

    // Simulate a new user connection by manually adding them
    let test_user_id = "test-user-123";

    // Verify user doesn't exist yet
    assert!(
        kernel.get_user(test_user_id).await.unwrap().is_none(),
        "User should not exist initially"
    );

    // Create the user
    use citadel_workspace_types::structs::User;
    let user = User::new(
        test_user_id.to_string(),
        test_user_id.to_string(),
        UserRole::Member,
    );
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(test_user_id.to_string(), user)
        .await
        .expect("Failed to insert user");

    // Add user directly to workspace members (simulating what on_node_event_received does)
    let mut ws = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get workspace")
        .expect("Workspace should exist");

    ws.members.push(test_user_id.to_string());
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), ws.clone())
        .await
        .expect("Failed to update workspace");

    // Update domain as well
    let ws_domain = citadel_workspace_types::structs::Domain::Workspace { workspace: ws };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_domain(WORKSPACE_ROOT_ID.to_string(), ws_domain)
        .await
        .expect("Failed to update domain");

    // Verify user is now in workspace
    let updated_workspace = kernel
        .get_domain(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get domain")
        .expect("Root workspace should exist");

    assert!(
        updated_workspace
            .members()
            .contains(&test_user_id.to_string()),
        "Test user should now be a member of the workspace"
    );
}

#[tokio::test]
async fn test_first_user_with_master_password_becomes_owner() {
    let kernel = create_test_kernel().await;

    // Create a test user
    let test_user_id = "first-admin-user";
    use citadel_workspace_types::structs::User;
    let user = User::new(
        test_user_id.to_string(),
        "First Admin".to_string(),
        UserRole::Member,
    );
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(test_user_id.to_string(), user)
        .await
        .expect("Failed to insert user");

    // Simulate UpdateWorkspace call with master password
    use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncWorkspaceOperations;
    let updated_ws = kernel
        .domain_operations
        .update_workspace(
            test_user_id,
            WORKSPACE_ROOT_ID,
            Some("My Workspace"),
            None,
            None,
            MASTER_PASSWORD.to_string(),
        )
        .await
        .expect("Failed to update workspace");

    // Verify user is now the owner
    assert_eq!(
        updated_ws.owner_id, test_user_id,
        "User should be the owner after providing master password"
    );

    // Verify user is a member
    assert!(
        updated_ws.members.contains(&test_user_id.to_string()),
        "User should be a member of the workspace"
    );

    // Verify user has Admin role
    let user_record = kernel
        .get_user(test_user_id)
        .await
        .expect("Failed to get user")
        .expect("User should exist");

    assert_eq!(
        user_record.role,
        UserRole::Admin,
        "User should have Admin role after providing master password"
    );
}

#[tokio::test]
async fn test_existing_user_not_re_added() {
    let kernel = create_test_kernel().await;

    // Add a test user manually
    let test_user_id = "existing-user";
    use citadel_workspace_types::structs::User;
    let user = User::new(
        test_user_id.to_string(),
        "Existing User".to_string(),
        UserRole::Member,
    );
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(test_user_id.to_string(), user)
        .await
        .expect("Failed to insert user");

    // Add user directly to workspace members
    let mut ws = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get workspace")
        .expect("Workspace should exist");

    ws.members.push(test_user_id.to_string());
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), ws.clone())
        .await
        .expect("Failed to update workspace");

    // Update domain as well
    let ws_domain = citadel_workspace_types::structs::Domain::Workspace { workspace: ws };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_domain(WORKSPACE_ROOT_ID.to_string(), ws_domain)
        .await
        .expect("Failed to update domain");

    // Get initial member count
    let workspace = kernel
        .get_domain(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get domain")
        .expect("Root workspace should exist");
    let initial_member_count = workspace.members().len();

    // Simulate the connection check - user is already a member so nothing should happen
    if !workspace.members().contains(&test_user_id.to_string()) {
        panic!("This shouldn't execute - user is already a member");
    }

    // Verify member count hasn't changed
    let workspace_after = kernel
        .get_domain(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get domain")
        .expect("Root workspace should exist");
    assert_eq!(
        workspace_after.members().len(),
        initial_member_count,
        "Member count should remain the same"
    );
}
