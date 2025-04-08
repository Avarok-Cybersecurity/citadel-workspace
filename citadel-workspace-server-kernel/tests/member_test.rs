use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::handlers::domain::server_ops::ServerDomainOps;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_server_kernel::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_workspace_types::structs::{Domain, Office, User, UserRole};
use std::sync::Arc;

// Helper function to create a test user
fn create_test_user(id: &str, role: UserRole) -> User {
    User {
        id: id.to_string(),
        name: format!("Test {}", id),
        role,
        permissions: std::collections::HashMap::new(),
        metadata: Vec::new(),
    }
}

// Helper to setup a test environment with admin, domains, and test users
fn setup_test_environment() -> (
    Arc<WorkspaceServerKernel<StackedRatchet>>,
    ServerDomainOps<StackedRatchet>,
) {
    citadel_logging::setup_log();
    let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
        "admin",
        "Administrator",
    ));
    let domain_ops = ServerDomainOps::new(kernel.clone());

    (kernel, domain_ops)
}

#[test]
fn test_add_user_to_domain() {
    let (kernel, domain_ops) = setup_test_environment();

    // Create a test user
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    // Insert the user
    kernel
        .transaction_manager
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user)?;
            Ok(())
        })
        .unwrap();

    // Create an office
    let office = domain_ops
        .create_office("admin", "Test Office", "For Testing", None)
        .unwrap();

    // Add the user to the office
    domain_ops
        .add_user_to_domain(user_id, &office.id, UserRole::Member)
        .unwrap();

    // Verify the user is in the office
    let office_domain = domain_ops.get_domain(&office.id).unwrap();
    match office_domain {
        Domain::Office { office } => {
            assert!(
                office.members.contains(&user_id.to_string()),
                "User should be in the office members list"
            );
        }
        _ => panic!("Expected office domain"),
    }
}

#[test]
fn test_remove_user_from_domain() {
    let (kernel, domain_ops) = setup_test_environment();

    // Create a test user
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    // Insert the user
    kernel
        .transaction_manager
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user)?;
            Ok(())
        })
        .unwrap();

    // Create an office
    let office = domain_ops
        .create_office("admin", "Test Office", "For Testing", None)
        .unwrap();

    // Add the user to the office first
    domain_ops
        .add_user_to_domain(user_id, &office.id, UserRole::Member)
        .unwrap();

    // Remove the user from the office
    domain_ops
        .remove_user_from_domain(user_id, &office.id)
        .unwrap();

    // Verify the user is no longer in the office
    let office_domain = domain_ops.get_domain(&office.id).unwrap();
    match office_domain {
        Domain::Office { office } => {
            assert!(
                !office.members.contains(&user_id.to_string()),
                "User should not be in the office members list after removal"
            );
        }
        _ => panic!("Expected office domain"),
    }
}

#[test]
fn test_complete_user_removal() {
    let (kernel, domain_ops) = setup_test_environment();

    // Create a test user
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    // Insert the user
    kernel
        .transaction_manager
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user)?;
            Ok(())
        })
        .unwrap();

    // Create an office
    let office = domain_ops
        .create_office("admin", "Test Office", "For Testing", None)
        .unwrap();

    // Add the user to the office
    domain_ops
        .add_user_to_domain(user_id, &office.id, UserRole::Member)
        .unwrap();

    // Use transaction to completely remove the user
    kernel
        .transaction_manager
        .with_write_transaction(|tx| {
            // First remove user from all domains
            if let Some(Domain::Office { mut office }) = tx.get_domain(&office.id).cloned() {
                office.members.retain(|id| id != user_id);
                let office_id = office.id.clone(); // Clone the ID to avoid borrow issues
                tx.update_domain(&office_id, Domain::Office { office })?;
            }

            // Then remove the user completely
            tx.remove_user(user_id)?;
            Ok(())
        })
        .unwrap();

    // Verify the user no longer exists
    let user_exists = kernel
        .transaction_manager
        .with_read_transaction(|tx| Ok(tx.get_user(user_id).is_some()))
        .unwrap();

    assert!(!user_exists, "User should have been completely removed");
}

#[test]
fn test_member_command_processing() {
    citadel_logging::setup_log();
    citadel_logging::trace!(target: "citadel", "Starting test_member_command_processing");

    let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
        "admin",
        "Administrator",
    ));

    citadel_logging::trace!(target: "citadel", "Created kernel");

    // Create a test user
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    citadel_logging::trace!(target: "citadel", "Created test user");

    // Insert the user
    kernel
        .transaction_manager
        .with_write_transaction(|tx| {
            citadel_logging::trace!(target: "citadel", "Inserting user");
            tx.insert_user(user_id.to_string(), user)?;
            citadel_logging::trace!(target: "citadel", "User inserted");
            Ok(())
        })
        .unwrap();

    citadel_logging::trace!(target: "citadel", "Inserted test user");

    // Create an office via command processing
    let office_id = "test_office";

    citadel_logging::trace!(target: "citadel", "Creating office");

    // First manually create an office since the command doesn't have office_id field
    kernel
        .transaction_manager
        .with_write_transaction(|tx| {
            citadel_logging::trace!(target: "citadel", "In transaction to create office");
            tx.insert_domain(
                office_id.to_string(),
                Domain::Office {
                    office: Office {
                        id: office_id.to_string(),
                        name: "Test Office".to_string(),
                        description: "Test Office Description".to_string(),
                        owner_id: "admin".to_string(),
                        members: Vec::new(),
                        rooms: Vec::new(),
                        mdx_content: String::new(),
                        metadata: Vec::new(),
                    },
                },
            )?;
            citadel_logging::trace!(target: "citadel", "Office created");
            Ok(())
        })
        .unwrap();

    citadel_logging::trace!(target: "citadel", "Office created successfully");

    // Add user to the office via command processing
    citadel_logging::trace!(target: "citadel", "About to add member via command");
    let result = kernel.process_command(
        "admin",
        WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.to_string()),
            room_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    );

    citadel_logging::trace!(target: "citadel", "Add member command processed: {:?}", result);

    match result {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            citadel_logging::trace!(target: "citadel", "Add member command succeeded");
        }
        _ => panic!("Failed to add member: {:?}", result),
    }

    // Verify the user is in the office
    citadel_logging::trace!(target: "citadel", "Verifying user is in office");
    let office_exists = kernel
        .transaction_manager
        .with_read_transaction(|tx| {
            citadel_logging::trace!(target: "citadel", "In transaction to verify user in office");
            if let Some(Domain::Office { office }) = tx.get_domain(office_id) {
                let result = office.members.contains(&user_id.to_string());
                citadel_logging::trace!(target: "citadel", "User in office: {}", result);
                Ok(result)
            } else {
                citadel_logging::trace!(target: "citadel", "Office not found");
                Ok(false)
            }
        })
        .unwrap();

    citadel_logging::trace!(target: "citadel", "Verified user in office: {}", office_exists);
    assert!(office_exists, "User should be in the office after adding");

    // Remove user from the office via command processing
    citadel_logging::trace!(target: "citadel", "About to remove member via command");
    let result = kernel.process_command(
        "admin",
        WorkspaceProtocolRequest::RemoveMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.to_string()),
            room_id: None,
        },
    );

    citadel_logging::trace!(target: "citadel", "Remove member command processed: {:?}", result);

    match result {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            citadel_logging::trace!(target: "citadel", "Remove member command succeeded");
        }
        _ => panic!("Failed to remove member: {:?}", result),
    }

    // Verify the user is no longer in the office
    citadel_logging::trace!(target: "citadel", "Verifying user is no longer in office");
    let user_in_office = kernel
        .transaction_manager
        .with_read_transaction(|tx| {
            citadel_logging::trace!(target: "citadel", "In transaction to verify user not in office");
            if let Some(Domain::Office { office }) = tx.get_domain(office_id) {
                let result = office.members.contains(&user_id.to_string());
                citadel_logging::trace!(target: "citadel", "User in office: {}", result);
                Ok(result)
            } else {
                citadel_logging::trace!(target: "citadel", "Office not found");
                Ok(false)
            }
        })
        .unwrap();

    citadel_logging::trace!(target: "citadel", "Verified user not in office: {}", !user_in_office);
    assert!(
        !user_in_office,
        "User should not be in the office after removal"
    );
    citadel_logging::trace!(target: "citadel", "Test completed successfully");
}
