use citadel_workspace_server_kernel::handlers::domain::async_ops::{
    AsyncOfficeOperations, AsyncPermissionOperations,
};
use citadel_workspace_types::structs::{Domain, Permission, UserRole, Workspace};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::permissions_test_utils::*;

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
    let (kernel, domain_ops) = setup_permissions_test_environment().await;

    const TEST_WORKSPACE_ID: &str = "test_workspace_id";

    // Create test users with different roles
    let owner_user = create_test_user("owner", UserRole::Admin); // Changed to Admin to have permissions
    let member_user = create_test_user("member", UserRole::Member);
    let guest_user = create_test_user("guest", UserRole::Guest);

    // Add users to the kernel and set up workspace & permissions
    // Create and insert the workspace
    let workspace = Workspace {
        id: TEST_WORKSPACE_ID.to_string(),
        name: "Test Workspace".to_string(),
        description: "A workspace for testing".to_string(),
        owner_id: owner_user.id.clone(),
        members: vec![owner_user.id.clone()],
        offices: Vec::new(),
        metadata: Vec::new(),
    };
    let workspace_domain = Domain::Workspace {
        workspace: workspace.clone(),
    };

    // Insert into both workspace table and domain table
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_workspace(TEST_WORKSPACE_ID.to_string(), workspace)
        .await
        .unwrap();
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_domain(TEST_WORKSPACE_ID.to_string(), workspace_domain)
        .await
        .unwrap();

    // Insert users
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

    // Grant CreateOffice permission to owner_user for the workspace
    let mut fetched_owner_user = kernel
        .domain_operations
        .backend_tx_manager
        .get_user(&owner_user.id)
        .await
        .unwrap()
        .unwrap()
        .clone();
    fetched_owner_user
        .permissions
        .entry(TEST_WORKSPACE_ID.to_string())
        .or_default()
        .insert(Permission::CreateOffice);
    kernel
        .domain_operations
        .backend_tx_manager
        .update_user(&owner_user.id, fetched_owner_user)
        .await
        .unwrap();

    // Add owner to the workspace members and grant permissions
    let mut workspace_domain_mut = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(TEST_WORKSPACE_ID)
        .await
        .unwrap()
        .unwrap();
    if let Domain::Workspace { ref mut workspace } = workspace_domain_mut {
        workspace.members.push(owner_user.id.clone());
    }
    kernel
        .domain_operations
        .backend_tx_manager
        .update_domain(TEST_WORKSPACE_ID, workspace_domain_mut)
        .await
        .unwrap();

    // Create an office using domain_ops directly instead of protocol command
    let office = domain_ops
        .create_office(
            owner_user.id.as_str(),
            TEST_WORKSPACE_ID,
            "Test Office",
            "Test Description",
            None,
        )
        .await
        .unwrap();

    let office_id = office.id.clone();

    // First check if the creator (owner) has permissions
    let has_edit_permission = domain_ops
        .check_entity_permission(
            owner_user.id.as_str(),
            office_id.as_str(),
            Permission::EditOfficeConfig,
        )
        .await
        .unwrap();
    assert!(
        has_edit_permission,
        "Owner should have EditOfficeConfig permission"
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
    let mut domain = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(&office_id)
        .await
        .unwrap()
        .unwrap()
        .clone();
    if let Domain::Office { ref mut office } = domain {
        office.members.push(member_user.id.clone());
    }
    kernel
        .domain_operations
        .backend_tx_manager
        .update_domain(&office_id, domain)
        .await
        .unwrap();

    // Verify member was actually added to the office
    {
        let domain = kernel
            .domain_operations
            .backend_tx_manager
            .get_domain(&office_id)
            .await
            .unwrap()
            .unwrap();
        match domain {
            Domain::Office { office } => {
                assert!(
                    office.members.contains(&member_user.id),
                    "Member should be in the office members list"
                );
            }
            _ => panic!("Expected office domain"),
        }
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
            Permission::EditOfficeConfig,
        )
        .await
        .unwrap();
    assert!(
        !has_edit_permission,
        "Member should not have EditOfficeConfig permission"
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
