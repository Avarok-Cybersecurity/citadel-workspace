# Server Kernel Cleanup Plan

This document outlines findings from the audit of the `citadel-workspace-server-kernel` codebase and a plan to address them.

## Audit Findings

### 1. Authorization Logic

* Observations about how authorization is currently handled and where it can be centralized.

  * The file `src/handlers/permissions.rs` defines core data structures for managing permissions (`PermissionSet`, `Membership`) and assigning default permissions based on `UserRole`.
  * Methods like `PermissionSet::has()`, `Membership::has_permission()` allow checking if a user/role possesses a specific permission.
  * A crucial comment in `permissions.rs` states: `/// The logic for checking permissions is inside src/kernel/transactions/rbac.rs`. This `rbac.rs` file is a key target for review.
  * The `Membership` struct is tied to a `domain_id`, suggesting permissions are scoped by "domains".
  * Handlers like `src/handlers/office.rs` delegate operations to a `domain_operations` object.
  * The `src/handlers/domain/mod.rs` file defines the `DomainOperations` trait. Its implementation is in `src/handlers/domain/server_ops.rs` (`ServerDomainOps`).
    * The `check_entity_permission(user_id, entity_id, permission)` method in `ServerDomainOps` **delegates directly to `self.tx_manager.check_entity_permission(...)`**. This means the `TransactionManager` (from `src/kernel/transaction/mod.rs`) is the next critical component for understanding the core permission checking mechanism and its potential interaction with `rbac.rs`.
    * The `is_admin` method in `ServerDomainOps` uses a read transaction via `tx_manager` to check `UserRole::Admin`.
    * Transactional methods (`with_read_transaction`, `with_write_transaction`) in `ServerDomainOps` correctly delegate to the `tx_manager`.
  * **`TransactionManager::check_entity_permission` (in `src/kernel/transaction/rbac.rs`)**: This method is central to permission checking.
    * It operates within a read transaction.
    * **System Admin Override**: Grants permission if the user has `UserRole::Admin` (global system admin).
    * **Explicit User Permissions**: Checks `user.has_permission(entity_id, permission)` for direct grants.
    * **Ownership**: Grants permission if the user is the `owner_id` of the Workspace, Office, or Room.
    * **Membership & Role**: If the user is a member of the Workspace, Office, or Room, permission is granted if the user's global `User.role` is `Admin` or `Owner`. This implies that a global Admin/Owner role grants broad access within any domain they are a member of.
    * **Hierarchical Check**: For Offices and Rooms, if direct access isn't granted, it checks membership and owner/admin role in parent domains (Office -> Workspace, Room -> Office -> Workspace).
    * **Done.** The `User` struct (in `citadel-workspace-types`) stores permissions in a `HashMap<domain_id, HashSet<Permission>>`. `User::has_permission()` retrieves this set for a domain and checks if it contains the specific permission or `Permission::All`.

### 2. Code Redundancy

* Instances of duplicated or similar logic that can be consolidated.

  * In `src/handlers/domain/server_ops.rs`, specific entity manipulation methods (e.g., `create_office`, `get_office`) are thin wrappers around generic methods (e.g., `create_domain_entity<Office>`). This provides type safety and handles `parent_id` logic (e.g., `None` for Office, `Some(office_id)` for Room). This is more of a design choice for usability than problematic redundancy, but worth noting.

### 3. Unused Code

* Code components (functions, structs, variables) that appear to be unused.

  * The file `src/handlers/member.rs` is empty and should likely be removed along with its declaration in `src/handlers/mod.rs`.

### 4. Inconsistencies

* Variations in coding patterns, naming, error handling, etc., for similar tasks.

  * **`owner_id` Initialization**: In `src/handlers/domain/entity.rs`, the `create()` methods for `Office` and `Room` initialize `owner_id` to an empty string. How the actual creator/owner is assigned needs to be determined by examining `ServerDomainOps::create_domain_entity` and the transaction logic it uses. The definition of the internal helper method `create_domain_entity_inner` (called by `create_domain_entity`) proved elusive despite extensive search attempts using various tools. It is assumed that the `user_id` passed to `create_domain_entity` is used as the `owner_id` for the new entity, as this is a common and logical pattern.

### 5. Potential Bad Logic or Areas for Improvement

* Code sections that seem overly complex, potentially error-prone, or could be designed more effectively.

  * **Clarified "Domain" Concept**: `src/handlers/domain/entity.rs` shows:
    * An `Office`'s `domain_id` is its own `id`.
    * A `Room`'s `domain_id` is its parent `office_id`.
    * This confirms a `Workspace -> Office -> Room` domain hierarchy.
  * The comment `// workspace_id field removed - all offices belong to the single workspace` in `Office::create` and patterns in `server_ops.rs` (ignoring `workspace_id` parameters) strongly suggest a single-workspace architecture.

## Remediation Checklist

* A step-by-step plan to address the findings.

1. ~~Analyze `TransactionManager::check_entity_permission`~~: Investigated its implementation in `src/kernel/transaction/rbac.rs`. Findings documented.
2. ~~Analyze `ServerDomainOps::create_domain_entity`~~ (Covered by `owner_id` investigation): View its full implementation in `src/handlers/domain/server_ops.rs` to understand `owner_id` assignment and entity persistence mechanisms.
3. Review `src/kernel/transactions/rbac.rs`: Understand its role in permission checking as hinted by `permissions.rs` and its potential use by `TransactionManager`. (Partially covered by `check_entity_permission` analysis, further review might be needed for other RBAC aspects).
4. Clarify "Domain" Concept Fully: Solidify the definition of "Domain" at all levels and ensure consistent `domain_id` usage.
5. Document `owner_id` Assignment: Based on the assumption that `user_id` from `create_domain_entity` becomes `owner_id`. Document the difficulty in locating the `create_domain_entity_inner` method definition, suggesting potential macro usage or tool limitations for this specific case.
6. Document Specific vs. Generic Methods in `DomainOperations`: Note the wrapper pattern as a design choice.
7. ~~Remove `src/handlers/member.rs`: If confirmed unused, delete the file and its module declaration. (Confirmed empty, pending deletion and mod removal).~~ **Done.** File deleted and module declaration removed.
8. Centralize Authorization Checks: Confirm if `TransactionManager::check_entity_permission` (with `rbac.rs`) serves as the central point. Refactor if necessary. (Current findings suggest it is indeed central).
9. **Done.** The `User` struct (in `citadel-workspace-types`) stores permissions in a `HashMap<domain_id, HashSet<Permission>>`. `User::has_permission()` retrieves this set for a domain and checks if it contains the specific permission or `Permission::All`.
10. Address other identified inconsistencies or areas for improvement.
11. Ensure `cargo test` passes in `citadel-workspace-server-kernel`.
