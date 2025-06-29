/// # Permission Inheritance Test Suite
/// 
/// This module orchestrates comprehensive permission inheritance testing across the domain hierarchy.
/// The tests are organized into focused modules covering different aspects of permission inheritance.
/// 
/// ## Test Organization
/// - **Office-Room Tests**: Hierarchical inheritance from office to room
/// - **Permission Escalation**: Role-based permission upgrades
/// - **Domain Membership**: Membership behavior and inheritance patterns
/// - **Workspace Inheritance**: Workspace to office permission flow
/// 
/// ## Permission Hierarchy
/// ```
/// Workspace (Root)
///   ├── Office (Child of Workspace) 
///   │   └── Room (Child of Office)
///   └── Permissions cascade down the hierarchy
/// ```

// Import focused test modules
mod office_room_inheritance_test;
mod permission_escalation_test;
mod domain_membership_test;
mod workspace_inheritance_test;
