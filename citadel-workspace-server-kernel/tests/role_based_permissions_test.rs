use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use citadel_workspace_types::WorkspaceProtocolRequest;

use common::async_test_helpers::*;
use common::permissions_test_utils::create_test_user;
use common::workspace_test_utils::*;

/// # Role-Based Permission Test Suite
///
/// Tests comprehensive role-based permission system including:
/// - Owner permissions and capabilities
/// - Member permissions and restrictions
/// - Guest permissions and limitations
/// - Permission inheritance across domain hierarchy
/// - Role-based access control validation
/// - Multi-user permission interaction
///
/// ## Role Permission Hierarchy
/// ```
/// Owner (Full Control) → Member (Limited Access) → Guest (Minimal/No Access)
/// ```
///
/// **Expected Outcome:** Role-based permissions work correctly across all user roles and domain types

#[tokio::test]
async fn test_role_based_permissions() {
    let kernel = create_test_kernel().await;
    let domain_ops = kernel.domain_operations.clone();

    // Use the root workspace ID
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

    // Create test users with different roles
    let owner_user = create_test_user("owner", UserRole::Admin);
    let member_user = create_test_user("member", UserRole::Member);
    let guest_user = create_test_user("guest", UserRole::Guest);

    // Insert users into the kernel
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(owner_user.id.clone(), owner_user.clone())
        .await
        .unwrap();
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(member_user.id.clone(), member_user.clone())
        .await
        .unwrap();
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(guest_user.id.clone(), guest_user.clone())
        .await
        .unwrap();

    // Create an office using protocol command (parent is the root workspace)
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(workspace_id.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Test Office".to_string(),
            description: "Test Description".to_string(),
        },
    )
    .await
    .unwrap();

    let office = extract_node(create_office_response).expect("Failed to create office");
    let office_id = office.id.clone();

    // First check if the creator (owner) has permissions
    let has_edit_permission = domain_ops
        .check_entity_permission(
            owner_user.id.as_str(),
            office_id.as_str(),
            Permission::EditNodeConfig,
        )
        .await
        .unwrap();
    assert!(
        has_edit_permission,
        "Owner should have EditNodeConfig permission"
    );

    // Member should not have permission until added
    let has_view_permission = domain_ops
        .check_entity_permission(
            member_user.id.as_str(),
            office_id.as_str(),
            Permission::ViewContent,
        )
        .await
        .unwrap();
    assert!(
        !has_view_permission,
        "Member shouldn't have permission before being added"
    );

    // Manually add the member to the office via backend
    let mut node = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(&office_id)
        .await
        .unwrap()
        .expect("Node should exist")
        .clone();
    node.members.push(member_user.id.clone());
    kernel
        .domain_operations
        .backend_tx_manager
        .update_node(&office_id, node)
        .await
        .unwrap();

    // Verify member was actually added to the office
    {
        let node = kernel
            .domain_operations
            .backend_tx_manager
            .get_node(&office_id)
            .await
            .unwrap()
            .expect("Node should exist");
        assert!(
            node.members.contains(&member_user.id),
            "Member should be in the office members list"
        );
    }

    // Now member should have basic permissions but not admin permissions
    let has_view_permission = domain_ops
        .check_entity_permission(
            member_user.id.as_str(),
            office_id.as_str(),
            Permission::ViewContent,
        )
        .await
        .unwrap();
    assert!(
        has_view_permission,
        "Member should have ViewContent permission after being added"
    );

    let has_edit_permission = domain_ops
        .check_entity_permission(
            member_user.id.as_str(),
            office_id.as_str(),
            Permission::EditNodeConfig,
        )
        .await
        .unwrap();
    assert!(
        !has_edit_permission,
        "Member should not have EditNodeConfig permission"
    );

    // Guest should not have any permissions
    let has_guest_permission = domain_ops
        .check_entity_permission(
            guest_user.id.as_str(),
            office_id.as_str(),
            Permission::ViewContent,
        )
        .await
        .unwrap();
    assert!(!has_guest_permission, "Guest should not have permissions");
}
