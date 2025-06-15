use citadel_sdk::prelude::{NetworkError, StackedRatchet};
use citadel_workspace_server_kernel::handlers::domain::server_ops::DomainServerOperations;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, Office, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use rocksdb::DB;
use std::sync::Arc;
use tempfile::TempDir;

const ADMIN_PASSWORD: &str = "admin_password";

// Helper function to create a test user
fn create_test_user(id: &str, role: UserRole) -> User {
    User {
        id: id.to_string(),
        name: format!("Test {}", id),
        role,
        permissions: Default::default(),
        metadata: Default::default(),
    }
}

// Helper to setup a test environment with admin, domains, and test users
fn setup_test_environment() -> (
    Arc<WorkspaceServerKernel<StackedRatchet>>,
    DomainServerOperations<StackedRatchet>,
    TempDir,
) {
    citadel_logging::setup_log();
    let db_temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
    let db_path = db_temp_dir.path().join("test_member_db");
    let db = DB::open_default(&db_path).expect("Failed to open DB");
    let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
        "admin",
        "Administrator",
        ADMIN_PASSWORD,
        Arc::new(db),
    ));
    let domain_ops = kernel.domain_ops().clone();

    (kernel, domain_ops, db_temp_dir)
}

#[test]
fn test_add_user_to_domain() {
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();
    let _domain_ops = domain_ops; // Use the returned domain_ops

    // Create a test user
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

    // Create an office
    let office = _domain_ops
        .create_office(
            "admin",
            WORKSPACE_ROOT_ID,
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Add the user to the office
    _domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Verify the user is in the office
    let office_domain = _domain_ops.get_domain(&office.id).unwrap();
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
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();
    let _domain_ops = domain_ops; // Use the returned domain_ops

    // Create a test user
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

    // Create an office
    let office = _domain_ops
        .create_office(
            "admin",
            WORKSPACE_ROOT_ID,
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Add the user to the office first
    _domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Remove the user from the office
    _domain_ops
        .remove_user_from_domain("admin", user_id, &office.id)
        .unwrap();

    // Verify the user is no longer in the office
    let office_domain = _domain_ops.get_domain(&office.id).unwrap();
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
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();
    let _domain_ops = domain_ops; // Use the returned domain_ops

    // Create a test user
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

    // Create an office
    let office = _domain_ops
        .create_office(
            "admin",
            WORKSPACE_ROOT_ID,
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Add the user to the office
    _domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Use transaction to completely remove the user
    kernel
        .tx_manager()
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
        .tx_manager()
        .with_read_transaction(|tx| Ok(tx.get_user(user_id).is_some()))
        .unwrap();

    assert!(!user_exists, "User should have been completely removed");
}

#[test]
fn test_member_command_processing() {
    // Force recompile to pick up latest changes
    let (kernel, _domain_ops, _db_temp_dir) = setup_test_environment();

    citadel_logging::setup_log();
    citadel_logging::trace!(target: "citadel", "Starting test_member_command_processing");

    citadel_logging::trace!(target: "citadel", "Created kernel");

    // Create a test user
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    citadel_logging::trace!(target: "citadel", "Created test user");

    // Insert the user
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            citadel_logging::trace!(target: "citadel", "Inserting user");
            tx.insert_user(user_id.to_string(), user)?;
            citadel_logging::trace!(target: "citadel", "User inserted");
            Ok(())
        })
        .unwrap();

    citadel_logging::trace!(target: "citadel", "Inserted test user");

    // Create the office manually in the transaction for testing command processing
    let office_id = "test_office";
    let _workspace_id = WORKSPACE_ROOT_ID.to_string();
    citadel_logging::trace!(target: "citadel", "Creating office");

    // The root workspace is created by setup_test_environment(), so we use it directly.
    citadel_logging::trace!(target: "citadel", "Using existing root workspace (ID: {})", WORKSPACE_ROOT_ID);
    let workspace_id_str = WORKSPACE_ROOT_ID.to_string();

    // Grant admin All permissions on this new workspace (may be redundant if CreateWorkspace does it, but explicit for test clarity)
    // This needs to be in a transaction after the workspace is created.
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            if let Some(admin_user) = tx.get_user_mut("admin") {
                admin_user.permissions.entry(workspace_id_str.clone()).or_default().insert(citadel_workspace_types::structs::Permission::All);
                citadel_logging::trace!(target: "citadel", "Granted admin All permissions on workspace {}", workspace_id_str);
                tx.commit()?;
                Ok(())
            } else {
                Err(NetworkError::Generic("Admin user not found in transaction for workspace permission grant".to_string()))
            }
        })
        .unwrap();

    // Now, create the office manually within the workspace created by command
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            citadel_logging::trace!(target: "citadel", "In transaction to create office");
            let office = Office {
                id: office_id.to_string(),
                owner_id: "admin".to_string(),
                workspace_id: workspace_id_str.to_string(),
                name: "Test Office".to_string(),
                description: "Test Office Description".to_string(),
                members: vec!["admin".to_string()],
                // denylist: Vec::new(),
                rooms: Vec::new(),
                mdx_content: "".to_string(),
                metadata: Vec::new(),
            };
            tx.insert_domain(office_id.to_string(), Domain::Office { office })?;
            citadel_logging::trace!(target: "citadel", "Office created");

            // Grant admin All permissions on this new office
            if let Some(admin_user) = tx.get_user_mut("admin") {
                admin_user.permissions.entry(office_id.to_string()).or_default().insert(citadel_workspace_types::structs::Permission::All);
                citadel_logging::trace!(target: "citadel", "Granted admin All permissions on office {}", office_id);
            } else {
                return Err(NetworkError::Generic("Admin user not found in transaction for office permission grant".to_string()));
            }
            tx.commit()?;
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
        .tx_manager()
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
    let user_in_office = kernel.tx_manager()
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
