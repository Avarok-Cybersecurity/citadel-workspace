/// # Integration Test Suite
///
/// This module provides comprehensive integration testing for workspace operations.
/// Originally a 695-line monolithic file, it has been broken apart into focused modules:
///
/// - **Office Operations**: Complete office CRUD testing
/// - **Room Operations**: Complete room CRUD testing  
/// - **Common Utilities**: Shared test infrastructure in `tests/common/integration_test_utils.rs`
///
/// Each test module is self-contained and imports necessary utilities from the common module.
/// This modular approach improves maintainability and enables parallel test execution.
// Import focused test modules
mod office_operations_test;
mod room_operations_test;
