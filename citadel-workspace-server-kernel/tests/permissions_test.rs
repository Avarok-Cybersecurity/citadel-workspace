use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole};
use std::collections::HashMap;
use std::sync::Arc;

const ADMIN_PASSWORD: &str = "admin_password";

#[cfg(test)]
mod tests {
    use super::*;

    // Helper function to create a test user
    fn create_test_user(id: &str, role: UserRole) -> User {
        User {
            id: id.to_string(),
            name: format!("Test {}", id),
            role,
            permissions: HashMap::new(),
            metadata: Default::default(),
        }
    }

    #[test]
    fn test_permission_set() {
        citadel_logging::setup_log();
        // Create a kernel with an admin user for testing
        let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
            "admin",
            "Administrator",
            ADMIN_PASSWORD,
        ));

        // Add a test user with explicit permissions
        let user_id = "test_user";
        let user = create_test_user(user_id, UserRole::Member);

        // Add the user to the kernel
        {
            kernel
                .tx_manager()
                .with_write_transaction(|tx| {
                    tx.insert_user(user_id.to_string(), user.clone())?;
                    Ok(())
                })
                .unwrap();
        }

        // Create an office
        let domain_ops = kernel.domain_ops().clone();
        let office = domain_ops
            .create_office(
                "admin",
                "test_workspace_id",
                "Test Office",
                "Test Description",
                None,
            )
            .unwrap();

        // Check that the user doesn't have permissions yet
        let result = domain_ops.with_read_transaction(|tx| {
            domain_ops.check_entity_permission(
                tx,
                user_id,
                office.id.as_str(),
                Permission::ViewContent,
            )
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
            domain_ops.check_entity_permission(
                tx,
                user_id,
                office.id.as_str(),
                Permission::ViewContent,
            )
        });
        assert!(result.is_ok());
        assert!(result.unwrap(), "Member should have ViewContent permission");
    }

    #[test]
    fn test_admin_check() {
        citadel_logging::setup_log();
        // Create a kernel with a custom admin user
        let admin_id = "custom_admin";
        let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
            admin_id,
            "Custom Administrator",
            ADMIN_PASSWORD,
        ));
        let domain_ops = kernel.domain_ops();

        // Verify that the admin check works with custom admin ID
        // is_admin needs a transaction
        assert!(domain_ops
            .with_read_transaction(|tx| domain_ops.is_admin(tx, admin_id))
            .unwrap());

        // Verify that non-admin users are recognized as such
        assert!(!domain_ops
            .with_read_transaction(|tx| domain_ops.is_admin(tx, "non_admin_user"))
            .unwrap());

        // Create another user with admin role
        let second_admin_id = "second_admin";
        let admin2 = create_test_user(second_admin_id, UserRole::Admin);

        // Add the user to the kernel
        {
            kernel
                .tx_manager()
                .with_write_transaction(|tx| {
                    tx.insert_user(second_admin_id.to_string(), admin2)?;
                    Ok(())
                })
                .unwrap();
        }

        // Verify that the second admin is recognized
        assert!(domain_ops
            .with_read_transaction(|tx| domain_ops.is_admin(tx, second_admin_id))
            .unwrap());
    }

    #[test]
    fn test_role_based_permissions() {
        citadel_logging::setup_log();
        // Create a kernel with an admin user for testing
        let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
            "admin",
            "Administrator",
            ADMIN_PASSWORD,
        ));
        let domain_ops = kernel.domain_ops();

        // Create test users with different roles
        let owner_user = create_test_user("owner", UserRole::Owner);
        let member_user = create_test_user("member", UserRole::Member);
        let guest_user = create_test_user("guest", UserRole::Guest);

        // Add users to the kernel
        {
            kernel
                .tx_manager()
                .with_write_transaction(|tx| {
                    tx.insert_user(owner_user.id.clone(), owner_user.clone())?;
                    tx.insert_user(member_user.id.clone(), member_user.clone())?;
                    tx.insert_user(guest_user.id.clone(), guest_user.clone())?;
                    Ok(())
                })
                .unwrap();
        }

        // Create an office
        let office = domain_ops
            .create_office(
                owner_user.id.as_str(),
                "test_workspace_id",
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

        // Guest should not have permissions without explicit addition
        let result = domain_ops.with_read_transaction(|tx| {
            domain_ops.check_entity_permission(
                tx,
                guest_user.id.as_str(),
                office.id.as_str(),
                Permission::ViewContent,
            )
        });
        assert!(result.is_ok());
        assert!(!result.unwrap(), "Guest should not have permissions");
    }
}
