use citadel_logging::{debug, info};
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::transaction::TransactionManagerExt;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::UserRole;

mod common;
use common::permission_test_utils::*;

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

#[test]
fn test_workspace_add_no_explicit_office_perms() {
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();

    // Create test user
    let user_id = "test_user_ws_add";
    let user = create_test_user(user_id, UserRole::Member);
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user)?;
            Ok(())
        })
        .unwrap();

    // Use the existing root workspace
    let workspace_id = WORKSPACE_ROOT_ID.to_string();
    info!(target: "citadel", "Using existing workspace for test_workspace_add_no_explicit_office_perms: {}", workspace_id);

    // Create an office in this workspace
    eprintln!(
        "[TEST_EPRINTLN] Attempting to create office 'OfficeInWsPermTest' in workspace_id: {}",
        workspace_id
    );
    let office = domain_ops
        .create_office(
            "admin",
            &workspace_id,
            "OfficeInWsPermTest",
            "Test Office",
            None,
        )
        .unwrap();

    // Add user to the WORKSPACE
    eprintln!(
        "[TEST_EPRINTLN] Adding user '{}' to dynamic workspace '{}'",
        user_id, workspace_id
    );
    debug!(
        "[TEST_LOG] About to add user_id: '{}' to workspace_id: '{}'",
        user_id,
        &workspace_id
    );
    domain_ops
        .add_user_to_domain("admin", user_id, &workspace_id, UserRole::Member)
        .unwrap();
    eprintln!(
        "[TEST_EPRINTLN] Added user '{}' to dynamic workspace '{}'",
        user_id, workspace_id
    );

    // ASSERTION 1: User should NOT have explicit permissions on the OFFICE
    let user_explicit_office_perms = kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let u = tx.get_user(user_id).expect("User should exist");
            // We expect no entry for office.id, or an empty set of permissions if an entry exists for some reason
            let perms = u.permissions.get(&office.id);
            println!(
                "CASCADE_TEST_DEBUG: User '{}' explicit permissions for office '{}': {:?}",
                user_id, office.id, perms
            );
            Ok(perms.cloned())
        })
        .unwrap();

    assert!(
        user_explicit_office_perms.as_ref().is_none_or(|p| p.is_empty()),
        "User should have no explicit permissions (or an empty set) on child office '{}' after being added to workspace '{}'. Found: {:?}",
        office.id, workspace_id, user_explicit_office_perms
    );

    // ASSERTION 2: User SHOULD have inherited access to the OFFICE (is_member_of_domain checks this)
    debug!(
        "[TEST_LOG] About to check inherited access. user_id: '{}', office_id: '{}', workspace_id_for_context: '{}'",
        user_id,
        &office.id,
        &workspace_id
    );
    let has_inherited_office_access = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &office.id))
        .unwrap();
    assert!(
        has_inherited_office_access,
        "User should have inherited access to office '{}' as a member of workspace '{}'",
        office.id, workspace_id
    );
} 