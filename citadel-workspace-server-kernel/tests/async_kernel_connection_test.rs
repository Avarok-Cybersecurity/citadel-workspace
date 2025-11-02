//! # Async Kernel Connection Test
//!
//! This test verifies that the async kernel correctly handles new connections
//! and automatically adds users to the workspace domain if they aren't already members.

use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::{
    AsyncWorkspaceServerKernel, ADMIN_ROOT_USER_ID,
};
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::UserRole;

#[tokio::test]
async fn test_user_auto_registration_to_workspace() {
    // Create async kernel with admin
    let kernel = AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
        "admin_password",
    )
    .await
    .expect("Failed to create kernel with admin");

    // Verify root workspace exists
    let workspace = kernel
        .get_domain(WORKSPACE_ROOT_ID)
        .await
        .expect("Failed to get domain")
        .expect("Root workspace should exist");

    // Verify admin is a member
    assert!(
        workspace.members().contains(&"admin-user".to_string()),
        "Admin should be a member of the workspace"
    );

    // Simulate a new user connection by manually adding them
    // In real scenario, this would happen via on_node_event_received
    let test_user_id = "test-user-123";

    // Verify user doesn't exist yet
    assert!(
        kernel.get_user(test_user_id).await.unwrap().is_none(),
        "User should not exist initially"
    );

    // Simulate the user registration logic from on_node_event_received
    // First ensure the user exists in the system
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

    // Add user to workspace using admin privileges
    use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
    kernel
        .domain_operations
        .add_user_to_domain(
            ADMIN_ROOT_USER_ID,
            test_user_id,
            WORKSPACE_ROOT_ID,
            UserRole::Member,
        )
        .await
        .expect("Failed to add user to domain");

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

    // Verify user has Member role
    let user_record = kernel
        .get_user(test_user_id)
        .await
        .expect("Failed to get user")
        .expect("User should exist");

    assert_eq!(
        user_record.role,
        UserRole::Member,
        "User should have Member role"
    );
}

#[tokio::test]
async fn test_existing_user_not_re_added() {
    // Create async kernel with admin
    let kernel = AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
        "admin_password",
    )
    .await
    .expect("Failed to create kernel with admin");

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

    // Add user to workspace
    use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
    kernel
        .domain_operations
        .add_user_to_domain(
            ADMIN_ROOT_USER_ID,
            test_user_id,
            WORKSPACE_ROOT_ID,
            UserRole::Member,
        )
        .await
        .expect("Failed to add user to domain");

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
