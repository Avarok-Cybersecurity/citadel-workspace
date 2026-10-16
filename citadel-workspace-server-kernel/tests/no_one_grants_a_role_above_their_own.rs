//! You cannot hand out a role at or above your own, or one carrying authority you do not hold.
//!
//! `add_user_to_domain` writes a caller-supplied role and is gated only on `AddUsers`, which any
//! role may be given, and `user_id_to_add` may be the caller. So without a rule on WHICH role:
//!
//!     add_user_to_domain(me, me, WORKSPACE_ROOT, "admin")
//!
//! would make the caller an administrator. `update_workspace_member_role` is the same shape.
//!
//! Two rules, both required:
//!   - position: only a role below your own (the Owner is above the ladder);
//!   - containment: only a role whose permissions your own role confers. A role placed high
//!     but holding little cannot assign one holding more.
//!
//! The permitted grants are asserted alongside the refusals; a rule that refused everything
//! would satisfy the refusals alone.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::roles::{ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID};
use citadel_workspace_types::roles_protocol::MemberRole;
use citadel_workspace_types::structs::{Permission, UserRole};
use common::member_test_utils::{
    insert_user_with_role, join_root, member_holding, role_id_of, seed_role, GateKernel as Kernel,
};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// What the old rank-16 Custom role held: AddUsers among them. Between Member and Admin.
const EDITOR: &[Permission] = &[
    Permission::ViewContent,
    Permission::ViewMembers,
    Permission::ReadMessages,
    Permission::EditContent,
    Permission::SendMessages,
    Permission::UploadFiles,
    Permission::DownloadFiles,
    Permission::AddUsers,
    Permission::RemoveUsers,
    Permission::EditMdx,
    Permission::ManageRoles,
];

async fn an_editor(kernel: &Kernel, id: &str) {
    seed_role(kernel, "editor", 250, EDITOR).await;
    member_holding(kernel, id, "editor").await;
}

fn id(role_id: &str) -> MemberRole {
    MemberRole::Id(role_id.to_string())
}

async fn try_add_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: MemberRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .add_user_to_domain(actor, target, ROOT, role)
        .await
        .map_err(|e| e.to_string())
}

async fn try_set_role_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: MemberRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .update_workspace_member_role(actor, target, role, None)
        .await
        .map_err(|e| e.to_string())
}

// ---------- the escalation ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_cannot_make_itself_an_admin() {
    let kernel = create_test_kernel().await;
    an_editor(&kernel, "climber").await;

    let outcome = try_add_as(&kernel, "climber", "climber", id(ADMIN_ROLE_ID)).await;
    assert!(
        outcome.is_err(),
        "AddUsers must not be a route to the admin role: {outcome:?}"
    );
    assert_eq!(
        role_id_of(&kernel, "climber").await.as_deref(),
        Some("editor"),
        "the refusal must also leave the role unwritten",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_cannot_mint_an_admin_accomplice() {
    let kernel = create_test_kernel().await;
    an_editor(&kernel, "climber").await;
    insert_user_with_role(&kernel, "accomplice", UserRole::Member).await;

    assert!(
        try_add_as(&kernel, "climber", "accomplice", id(ADMIN_ROLE_ID))
            .await
            .is_err(),
        "granting Admin to someone else is the same escalation, one step longer",
    );
    assert!(
        try_set_role_as(&kernel, "climber", "accomplice", UserRole::Admin.into())
            .await
            .is_err(),
        "nor through the legacy spelling of the role",
    );
}

/// Peers are not below each other. An Admin appointing a second Admin creates a peer, and the
/// owner's rule is that nobody assigns their own position: that is the Owner's to do.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_appoint_a_peer() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", id(ADMIN_ROLE_ID)).await;
    assert!(
        outcome.is_err(),
        "an Admin assigned their own position: {outcome:?}"
    );
    assert_eq!(
        role_id_of(&kernel, "target").await.as_deref(),
        Some(MEMBER_ROLE_ID)
    );
}

/// A role placed above Admin but holding a fraction of its authority cannot assign it: position
/// alone is not power, and a role is the permissions it carries.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn position_without_the_permissions_does_not_assign_them() {
    let kernel = create_test_kernel().await;
    seed_role(&kernel, "steward", 400, EDITOR).await;
    member_holding(&kernel, "steward", "steward").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, "steward", "target", id(ADMIN_ROLE_ID)).await;
    assert!(
        outcome.is_err(),
        "a role above Admin without `All` handed out `All`: {outcome:?}"
    );
    assert!(
        try_add_as(&kernel, "steward", "steward", id(OWNER_ROLE_ID))
            .await
            .is_err(),
        "nor the Owner's seat, which is above every role",
    );
}

/// The Owner is above the ladder: it appoints Admins, and other Owners.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_grant_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_set_role_as(&kernel, "owner", "target", id(ADMIN_ROLE_ID))
            .await
            .is_ok(),
        "the Owner appoints administrators",
    );
    assert_eq!(
        role_id_of(&kernel, "target").await.as_deref(),
        Some(ADMIN_ROLE_ID)
    );
}

/// A workspace created before its first account became the Owner has an Admin and no Owner.
/// While the seat is vacant, a role conferring everything the Owner's does may fill it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_fill_a_vacant_owner_seat() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_set_role_as(
            &kernel,
            TEST_ADMIN_USER_ID,
            "target",
            UserRole::Owner.into()
        )
        .await
        .is_ok(),
        "a workspace with no Owner must be able to gain one",
    );
}

/// And the seat closes behind itself, which is what makes the ladder a ladder.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_grant_owner_once_one_exists() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "founder", UserRole::Owner).await;
    join_root(&kernel, "founder").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", id(OWNER_ROLE_ID))
            .await
            .is_err(),
        "an Admin does not mint a peer for the person who appoints them",
    );
}

/// The vacant seat is the Admin's to fill, not any role's: a role short of the Owner's
/// permissions cannot take it, even while it is empty.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lesser_role_cannot_fill_the_vacant_seat() {
    let kernel = create_test_kernel().await;
    an_editor(&kernel, "climber").await;

    assert!(
        try_add_as(&kernel, "climber", "climber", id(OWNER_ROLE_ID))
            .await
            .is_err(),
        "a role holding a third of the Owner's authority took the empty seat",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_that_is_not_in_the_table_is_refused() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", id("role-nope"))
            .await
            .is_err()
    );
    assert!(
        try_set_role_as(
            &kernel,
            TEST_ADMIN_USER_ID,
            "target",
            UserRole::Custom("editor".into(), 16).into()
        )
        .await
        .is_err(),
        "a legacy Custom role names nothing in the table and must not be guessed at",
    );
}

// ---------- what must still work ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_grant_the_roles_beneath_them() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", id(GUEST_ROLE_ID)).await;
    assert!(outcome.is_ok(), "{outcome:?}");
    assert_eq!(
        role_id_of(&kernel, "target").await.as_deref(),
        Some(GUEST_ROLE_ID)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_grant_the_roles_beneath_them() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, "owner", "target", UserRole::Guest.into()).await;
    assert!(outcome.is_ok(), "{outcome:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_may_still_add_ordinary_members() {
    let kernel = create_test_kernel().await;
    an_editor(&kernel, "climber").await;

    // A registered account: AddMember admits no other.
    insert_user_with_role(&kernel, "newcomer", UserRole::Member).await;
    let outcome = try_add_as(&kernel, "climber", "newcomer", id(MEMBER_ROLE_ID)).await;
    assert!(
        outcome.is_ok(),
        "AddUsers still means what it says for roles beneath the grantor: {outcome:?}",
    );
}

/// A created role is assignable like a built-in, by whoever is above it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_created_role_is_assigned_by_id() {
    let kernel = create_test_kernel().await;
    seed_role(
        &kernel,
        "role-scribe",
        150,
        &[Permission::ViewContent, Permission::EditMdx],
    )
    .await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", id("role-scribe")).await;
    assert!(outcome.is_ok(), "{outcome:?}");
    assert_eq!(
        role_id_of(&kernel, "target").await.as_deref(),
        Some("role-scribe")
    );
}
