use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::handlers::domain::OfficeOperations;
use citadel_workspace_server_kernel::handlers::domain::{TransactionOperations, PermissionOperations};
use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, Permission, UserRole};

#[path = "common/mod.rs"] mod common;
use common::permissions_test_utils::*;

/// # Basic Permission Test Suite
///
/// Tests fundamental permission setting and verification including:
/// - Setting permissions for users on domains
/// - Verifying permission checks work correctly
/// - Testing member addition to office domains
/// - Validating permission inheritance for members
/// - Ensuring permission state consistency
///
/// ## Permission Flow
/// ```
/// User Creation → Domain Creation → Member Addition → Permission Verification
/// ```
///
/// **Expected Outcome:** Basic permission operations work correctly and maintain consistent state

#[test]
fn test_permission_set() {
    let (kernel, domain_ops, _db_temp_dir) = setup_permissions_test_environment();

    // Add a test user with explicit permissions
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    // Add the user to the kernel
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user.clone())?;
            Ok(())
        })
        .unwrap();

    // Create an office
    let office = domain_ops
        .create_office(
            "admin",
            WORKSPACE_ROOT_ID,
            "Test Office",
            "Test Description",
            None,
        )
        .unwrap();

    // Check that the user doesn't have permissions yet
    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(tx, user_id, office.id.as_str(), Permission::ViewContent)
    });
    assert!(result.is_ok());
    assert!(!result.unwrap()); // User isn't a member yet, so should be false

    // Manually add the user's ID to the office members list via a write transaction
    domain_ops
        .with_write_transaction(|tx| {
            let mut domain = tx.get_domain(&office.id).unwrap().clone();
            if let Domain::Office { ref mut office } = domain {
                office.members.push(user_id.to_string());
            }
            tx.update_domain(&office.id, domain)?;
            Ok(())
        })
        .unwrap();

    // Verify the user is now in the members list
    {
        let domain = domain_ops.get_domain(&office.id).unwrap();
        match domain {
            Domain::Office { office } => {
                assert!(
                    office.members.contains(&user_id.to_string()),
                    "User should be in the members list"
                );
            }
            _ => panic!("Expected office domain"),
        }
    }

    // Now check again - user should have permission
    let result = domain_ops.with_read_transaction(|tx| {
        domain_ops.check_entity_permission(tx, user_id, office.id.as_str(), Permission::ViewContent)
    });
    assert!(result.is_ok());
    assert!(result.unwrap(), "Member should have ViewContent permission");
}
