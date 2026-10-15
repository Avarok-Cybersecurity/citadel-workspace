//! Reading telemetry is an administrator's permission: Admin holds it through `All`, Owner
//! explicitly, and no everyday role holds it at all.

use citadel_workspace_types::structs::{Permission, UserRole};

fn grants_view_telemetry(role: UserRole) -> bool {
    let permissions = Permission::for_role(&role);
    permissions.contains(&Permission::ViewTelemetry) || permissions.contains(&Permission::All)
}

#[test]
fn admin_and_owner_may_read_telemetry() {
    assert!(grants_view_telemetry(UserRole::Admin));
    assert!(Permission::for_role(&UserRole::Owner).contains(&Permission::ViewTelemetry));
}

#[test]
fn no_everyday_role_may_read_telemetry() {
    for role in [
        UserRole::Member,
        UserRole::Guest,
        UserRole::Banned,
        UserRole::Custom("editor".to_string(), u8::MAX),
    ] {
        assert!(
            !grants_view_telemetry(role.clone()),
            "{role:?} reads telemetry"
        );
    }
}
