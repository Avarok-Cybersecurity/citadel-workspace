use citadel_logging::info;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::transaction::TransactionManagerExt;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::UserRole;

mod common;
use common::permission_test_utils::*;

/// # Domain Membership Behavior Test Suite
/// 
/// Tests domain membership behavior and inheritance patterns including:
/// - Verifying initial non-membership of users
/// - Adding users to office domains
/// - Testing implicit room membership through office membership
/// - Verifying inheritance-based domain access
/// - Ensuring proper membership cascade behavior
/// 
/// ## Membership Inheritance Flow
/// ```
/// User (Not Member) → 
/// Add to Office (Explicit Member) → 
/// Room Access (Implicit Member via inheritance)
/// ```
/// 
/// **Expected Outcome:** Domain membership properly cascades through hierarchy

#[test]
fn test_is_member_of_domain_behavior() {
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();

    // Create test users
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    // Insert the user
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user)?;
            Ok(())
        })
        .unwrap();

    let actual_workspace_id = WORKSPACE_ROOT_ID.to_string();
    info!(target: "citadel", "Using existing workspace for test_is_member_of_domain_behavior: {}", actual_workspace_id);

    // Admin should already have All permissions on actual_workspace_id (WORKSPACE_ROOT_ID) via setup_test_environment

    // Create an office
    let office = domain_ops
        .create_office(
            "admin",
            &actual_workspace_id, // Use the actual ID from CreateWorkspace response
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Create a room in the office
    let room = domain_ops
        .create_room("admin", &office.id, "Test Room", "Room for testing", None)
        .unwrap();

    // Initially user is not a member of any domain
    let is_member_office = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &office.id))
        .unwrap();
    assert!(
        !is_member_office,
        "User should not be member of office initially"
    );
    // CASCADE DEBUG: Check workspace members before checking room membership (initial check)
    let current_workspace_id_for_debug = actual_workspace_id.to_string(); // actual_workspace_id is in scope
    let user_id_for_debug = user_id.to_string(); // user_id is in scope
    let workspace_members_before_room_check = domain_ops.with_read_transaction(|tx| {
        let ws = tx.get_workspace(&current_workspace_id_for_debug).expect("Workspace should exist for debug check");
        println!(
            "CASCADE_TEST_DEBUG: Workspace ({}) members before initial room membership check for user '{}': {:?}",
            current_workspace_id_for_debug, user_id_for_debug, ws.members
        );
        Ok(ws.members.clone())
    }).expect("Transaction for workspace members debug check failed");

    assert!(
        !workspace_members_before_room_check.contains(&user_id_for_debug.to_string()),
        "CRITICAL_ASSERT: test_user ({}) should NOT be in workspace ({}) members list before initial room check. Members: {:?}",
        user_id_for_debug, current_workspace_id_for_debug, workspace_members_before_room_check
    );

    // Original check that was failing
    let is_member_room = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &room.id))
        .unwrap();
    assert!(
        !is_member_room,
        "User should not be member of room initially"
    );

    // Add user to the office only
    domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Now user should be a member of the office but not the room
    let is_member_office = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &office.id))
        .unwrap();

    assert!(
        is_member_office,
        "User should be member of office after addition"
    );

    // But user should still have access to the room because of permission inheritance (implicitly a member for access purposes)
    let has_room_access_via_inheritance = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &room.id))
        .unwrap();
    assert!(
        has_room_access_via_inheritance,
        "User should have room access because they're in the parent office"
    );
} 