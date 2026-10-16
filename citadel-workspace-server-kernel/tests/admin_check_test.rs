use citadel_workspace_types::structs::{Permission, UserRole};

use common::permissions_test_utils::*;

/// # Admin Check Test Suite
///
/// Tests admin role verification and detection including:
/// - Verifying custom admin users are recognized
/// - Testing non-admin user detection
/// - Validating multiple admin users
/// - Ensuring admin role persistence
/// - Testing admin role assignment verification
///
/// ## Admin Detection Flow
/// ```
/// Admin Creation → Role Verification → Non-Admin Testing → Multi-Admin Validation
/// ```
///
/// **Expected Outcome:** Admin detection works correctly for various user roles and configurations

#[tokio::test]
async fn test_admin_check() {
    let admin_id = "custom_admin";
    let (kernel, domain_ops, _admin_id_str) = setup_custom_admin_test_environment(admin_id).await;

    let manages_roles = |id: &'static str| {
        let domain_ops = domain_ops.clone();
        async move {
            domain_ops
                .holds_workspace_permission(id, Permission::ManageRoles)
                .await
                .unwrap()
        }
    };

    // Verify that the admin check works with custom admin ID
    assert!(manages_roles("custom_admin").await);

    // Create a non-admin user for testing this specific check
    let non_admin_id = "non_admin_user";
    let non_admin_user_obj = create_test_user(non_admin_id, UserRole::Member);
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(non_admin_id.to_string(), non_admin_user_obj)
        .await
        .unwrap();

    // Verify that non-admin users are recognized as such
    join_root_workspace(&kernel, non_admin_id).await;
    assert!(!manages_roles("non_admin_user").await);

    // Create another user with admin role
    let second_admin_id = "second_admin";
    let admin2 = create_test_user(second_admin_id, UserRole::Admin);

    // Add the user to the kernel
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(second_admin_id.to_string(), admin2)
        .await
        .unwrap();

    // An Admin record outside the workspace is not an administrator of it: the role is a
    // standing in that workspace's table. The old check read a global enum and said yes.
    assert!(!manages_roles("second_admin").await);

    // Verify that the second admin is recognized once they belong to the workspace
    join_root_workspace(&kernel, second_admin_id).await;
    assert!(manages_roles("second_admin").await);
}
