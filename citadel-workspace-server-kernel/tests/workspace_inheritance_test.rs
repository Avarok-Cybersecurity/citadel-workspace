use citadel_logging::{debug, info};
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Workspace Inheritance Test Suite
///
/// Tests permission inheritance from workspace to office including:
/// - Adding users to workspace (parent) but not office (child)
/// - Verifying permission inheritance from workspace to office
/// - Testing explicit vs inherited permissions
/// - Ensuring proper workspace-office relationship
/// - Validating inheritance cascade behavior
///
/// ## Workspace-Office Inheritance Flow
/// ```
/// Workspace (Member: Basic Permissions) →
/// Office (Inherited: Access from workspace membership)
/// ```
///
/// **Expected Outcome:** Users in workspace inherit appropriate access to child offices

#[tokio::test]
async fn test_workspace_add_no_explicit_office_perms() {
    let kernel = create_test_kernel().await;

    // Create test user
    let user_id = "test_user_ws_add";
    let user = User::new(
        user_id.to_string(),
        "Test User".to_string(),
        UserRole::Member,
    );

    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(user_id.to_string(), user)
        .await
        .unwrap();

    // Use the existing root workspace
    let workspace_id = WORKSPACE_ROOT_ID.to_string();
    info!(target: "citadel", "Using existing workspace for test_workspace_add_no_explicit_office_perms: {}", workspace_id);

    // Create an office in this workspace
    eprintln!(
        "[TEST_EPRINTLN] Attempting to create office 'OfficeInWsPermTest' in workspace_id: {}",
        workspace_id
    );
    let office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.clone(),
            name: "OfficeInWsPermTest".to_string(),
            description: "Test Office".to_string(),
            mdx_content: None,
            metadata: None,
            is_default: None,
        },
    )
    .await;

    let office_id = match office_result {
        Ok(WorkspaceProtocolResponse::Office(office)) => office.id,
        _ => panic!("Expected Office response, got {:?}", office_result),
    };

    // Add user to the WORKSPACE
    eprintln!(
        "[TEST_EPRINTLN] Adding user '{}' to dynamic workspace '{}'",
        user_id, workspace_id
    );
    debug!(
        "[TEST_LOG] About to add user_id: '{}' to workspace_id: '{}'",
        user_id, &workspace_id
    );

    let add_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            office_id: None, // Adding to workspace, not office
            room_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await;
    assert!(add_result.is_ok());

    eprintln!(
        "[TEST_EPRINTLN] Added user '{}' to dynamic workspace '{}'",
        user_id, workspace_id
    );

    // ASSERTION 1: User should NOT have explicit permissions on the OFFICE
    let u = kernel
        .domain_operations
        .backend_tx_manager
        .get_user(user_id)
        .await
        .unwrap()
        .expect("User should exist");

    // We expect no entry for office_id, or an empty set of permissions if an entry exists for some reason
    let user_explicit_office_perms = u.permissions.get(&office_id);
    println!(
        "CASCADE_TEST_DEBUG: User '{}' explicit permissions for office '{}': {:?}",
        user_id, office_id, user_explicit_office_perms
    );

    assert!(
        user_explicit_office_perms.is_none() || user_explicit_office_perms.unwrap().is_empty(),
        "User should have no explicit permissions (or an empty set) on child office '{}' after being added to workspace '{}'. Found: {:?}",
        office_id, workspace_id, user_explicit_office_perms
    );

    // ASSERTION 2: User SHOULD have inherited access to the OFFICE (is_member_of_domain checks this)
    debug!(
        "[TEST_LOG] About to check inherited access. user_id: '{}', office_id: '{}', workspace_id_for_context: '{}'",
        user_id,
        &office_id,
        &workspace_id
    );
    let has_inherited_office_access = kernel
        .domain_operations
        .is_member_of_domain(user_id, &office_id)
        .await
        .unwrap();
    assert!(
        has_inherited_office_access,
        "User should have inherited access to office '{}' as a member of workspace '{}'",
        office_id, workspace_id
    );
}
