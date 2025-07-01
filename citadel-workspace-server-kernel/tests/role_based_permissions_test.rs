use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_types::structs::{Domain, Permission, UserRole, Workspace};

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

#[test]
fn test_role_based_permissions() {
    let (kernel, domain_ops, _db_temp_dir) = setup_permissions_test_environment();

    const TEST_WORKSPACE_ID: &str = "test_workspace_id";

    // Create test users with different roles
    let owner_user = create_test_user("owner", UserRole::Owner);
    let member_user = create_test_user("member", UserRole::Member);
    let guest_user = create_test_user("guest", UserRole::Guest);

    // Add users to the kernel and set up workspace & permissions
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            // Create and insert the workspace
            let workspace = Workspace {
                id: TEST_WORKSPACE_ID.to_string(),
                name: "Test Workspace".to_string(),
                description: "A workspace for testing".to_string(),
                owner_id: owner_user.id.clone(),
                members: vec![owner_user.id.clone()],
                offices: Vec::new(),
                metadata: Vec::new(),
                password_protected: false,
            };
            let workspace_domain = Domain::Workspace {
                workspace: workspace.clone(),
            };

            // Insert into both workspace table and domain table
            tx.insert_workspace(TEST_WORKSPACE_ID.to_string(), workspace)?;
            tx.insert_domain(TEST_WORKSPACE_ID.to_string(), workspace_domain)?;

            // Insert users
            tx.insert_user(owner_user.id.clone(), owner_user.clone())?;
            tx.insert_user(member_user.id.clone(), member_user.clone())?;
            tx.insert_user(guest_user.id.clone(), guest_user.clone())?;

            // Grant CreateOffice permission to owner_user for the workspace
            let mut fetched_owner_user = tx.get_user(&owner_user.id).unwrap().clone();
            fetched_owner_user
                .permissions
                .entry(TEST_WORKSPACE_ID.to_string())
                .or_default()
                .insert(Permission::CreateOffice);
            tx.update_user(&owner_user.id, fetched_owner_user)?;

            Ok(())
        })
        .unwrap();

    // Create an office
    let office = domain_ops
        .create_office(
            owner_user.id.as_str(),
            TEST_WORKSPACE_ID, // Use the defined workspace ID
            "Test Office",
            "Test Description",
            None,
        )
        .unwrap();

    // First check if the creator (owner) has permissions
    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(
            tx,
            owner_user.id.as_str(),
            office.id.as_str(),
            Permission::EditOfficeConfig,
        )
    });
    assert!(result.is_ok());
    assert!(
        result.unwrap(),
        "Owner should have EditOfficeConfig permission"
    );

    // Member should not have permission until added
    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(
            tx,
            member_user.id.as_str(),
            office.id.as_str(),
            Permission::ViewContent,
        )
    });
    assert!(result.is_ok());
    assert!(
        !result.unwrap(),
        "Member shouldn't have permission before being added"
    );

    // Manually add the member to the office via a write transaction
    domain_ops
        .with_write_transaction(|tx| {
            let mut domain = tx.get_domain(&office.id).unwrap().clone();
            if let Domain::Office { ref mut office } = domain {
                office.members.push(member_user.id.clone());
            }
            tx.update_domain(&office.id, domain)?;
            Ok(())
        })
        .unwrap();

    // Verify member was actually added to the office
    {
        let domain = domain_ops.get_domain(&office.id).unwrap();
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
    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(
            tx,
            member_user.id.as_str(),
            office.id.as_str(),
            Permission::ViewContent,
        )
    });
    assert!(result.is_ok());
    assert!(
        result.unwrap(),
        "Member should have ViewContent permission after being added"
    );

    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(
            tx,
            member_user.id.as_str(),
            office.id.as_str(),
            Permission::EditOfficeConfig,
        )
    });
    assert!(result.is_ok());
    assert!(
        !result.unwrap(),
        "Member should not have EditOfficeConfig permission"
    );

    // Guest should not have any permissions
    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(
            tx,
            guest_user.id.as_str(),
            office.id.as_str(), // This was the final intended fix
            Permission::ViewContent,
        )
    });
    assert!(result.is_ok());
    assert!(!result.unwrap(), "Guest should not have permissions");
}
