//! Reading telemetry is an administrator's permission: Admin holds it through `All`, Owner
//! explicitly, and no everyday role holds it at all.

use citadel_workspace_types::roles::{
    WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::structs::Permission;

fn grants_view_telemetry(role_id: &str) -> bool {
    WorkspaceRoles::seeded()
        .get(role_id)
        .expect("a seeded role")
        .grants(Permission::ViewTelemetry)
}

#[test]
fn admin_and_owner_may_read_telemetry() {
    assert!(grants_view_telemetry(ADMIN_ROLE_ID));
    assert!(grants_view_telemetry(OWNER_ROLE_ID));
}

#[test]
fn no_everyday_role_may_read_telemetry() {
    for role_id in [MEMBER_ROLE_ID, GUEST_ROLE_ID] {
        assert!(!grants_view_telemetry(role_id), "{role_id} reads telemetry");
    }
}
