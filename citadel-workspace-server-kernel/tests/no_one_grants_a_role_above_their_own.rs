//! You cannot hand out a role carrying authority you do not hold.
//!
//! `add_user_to_domain` writes a caller-supplied `UserRole` and was gated only
//! on `AddUsers` — which `Permission::for_role` grants to every Custom role
//! above the editor threshold (rank > 15). Nothing inspected WHICH role was
//! being granted, and `user_id_to_add` may be the caller. So:
//!
//!     add_user_to_domain(me, me, WORKSPACE_ROOT, UserRole::Admin)
//!
//! passed the gate, reached `write_user_role`, and set the caller's own role to
//! Admin — which carries `Permission::All`. A rank-16 Custom role could make
//! itself an administrator.
//!
//! `update_workspace_member_role` is the same shape and gained the same reach
//! when it began admitting the Owner: an Owner could grant Admin, and with it
//! the `ConfigureSystem` that `for_role` deliberately withholds from Owner.
//!
//! The rule is containment on the PERMISSION SETS: grant a role only if you
//! hold every permission it carries. `All` is the Admin wildcard and
//! `has_permission` honours it, so an Admin still grants anything.
//!
//! It was first written as a rank comparison — grant what you outrank or match —
//! and the section at the foot of this file records why that was the wrong
//! invariant. Rank does not track power.
//!
//! The permitted grants are asserted alongside the refusals; a rule that refused
//! everything would satisfy the refusals alone.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// Rank 16: above `CUSTOM_EDITOR_THRESHOLD`, so `for_role` grants it AddUsers.
fn elevated_custom() -> UserRole {
    UserRole::create_custom_role("elevated".to_string(), 16).expect("rank 16 is not reserved")
}

async fn try_add_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: UserRole,
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
    role: UserRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .update_workspace_member_role(actor, target, role, None)
        .await
        .map_err(|e| e.to_string())
}

// ---------- the escalation ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_cannot_make_itself_an_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "climber", elevated_custom()).await;
    join_root(&kernel, "climber").await;

    let outcome = try_add_as(&kernel, "climber", "climber", UserRole::Admin).await;
    assert!(
        outcome.is_err(),
        "AddUsers must not be a route to Permission::All: {outcome:?}",
    );

    let after = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("climber")
        .await
        .expect("read user")
        .expect("user exists");
    assert_ne!(
        after.role,
        UserRole::Admin,
        "the refusal must also leave the role unwritten",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_cannot_mint_an_admin_accomplice() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "climber", elevated_custom()).await;
    join_root(&kernel, "climber").await;

    assert!(
        try_add_as(&kernel, "climber", "accomplice", UserRole::Admin)
            .await
            .is_err(),
        "granting Admin to someone else is the same escalation, one step longer",
    );
}

/// The Owner runs the workspace, and an Admin is someone they appoint.
///
/// This asserted the OPPOSITE, on the grounds that `for_role` withholds `All`
/// and `ConfigureSystem` from Owner so permission containment refuses the
/// grant. That is a correct reading of the permission sets and the wrong answer
/// to the question: those sets say what a role may DO, and appointing is about
/// who a role may MANAGE. `UserRole::command_authority` is that ladder now, and
/// it puts Owner above Admin.
///
/// The `for_role` sets are deliberately unchanged. An Owner still does not hold
/// `ConfigureSystem` -- a server-level permission -- and still does not hold the
/// `All` wildcard. Being able to appoint an Admin is not the same as holding
/// everything that Admin holds.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_grant_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_set_role_as(&kernel, "owner", "target", UserRole::Admin)
            .await
            .is_ok(),
        "the Owner appoints administrators",
    );
}

/// An Admin may fill a VACANT Owner seat. This is the bootstrap, and without it
/// the role is unreachable.
///
/// `UserRole::Owner` is never assigned anywhere in the kernel's production code
/// -- it is only ever read -- so this grant is the only way a workspace gains
/// an Owner, and a workspace begins with an Admin and no Owner. A strict ladder
/// would have made "Owner" a role nobody could ever hold.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_fill_a_vacant_owner_seat() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;
    join_root(&kernel, TEST_ADMIN_USER_ID).await;

    assert!(
        try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", UserRole::Owner)
            .await
            .is_ok(),
        "a workspace with no Owner must be able to gain one",
    );
}

/// And the seat closes behind itself, which is what makes the ladder a ladder.
///
/// This is the assertion the bootstrap above must not cost: once an Owner
/// exists, an Admin cannot manufacture a second one. That would be a lateral
/// escalation -- a confederate placed above every other administrator, by an
/// administrator.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_grant_owner_once_one_exists() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "founder", UserRole::Owner).await;
    join_root(&kernel, "founder").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;
    join_root(&kernel, TEST_ADMIN_USER_ID).await;

    assert!(
        try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", UserRole::Owner)
            .await
            .is_err(),
        "an Admin does not mint a peer for the person who appoints them",
    );
}

// ---------- what must still work ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_grant_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", UserRole::Admin).await;
    assert!(
        outcome.is_ok(),
        "Admin is u8::MAX and matches itself, so promotion must still work: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_grant_the_roles_beneath_them() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, "owner", "target", UserRole::Guest).await;
    assert!(
        outcome.is_ok(),
        "containment blocks only what is above the grantor: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_may_still_add_ordinary_members() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "climber", elevated_custom()).await;
    join_root(&kernel, "climber").await;

    let outcome = try_add_as(&kernel, "climber", "newcomer", UserRole::Member).await;
    assert!(
        outcome.is_ok(),
        "AddUsers still means what it says for roles beneath the grantor: {outcome:?}",
    );
}

// ---------------------------------------------------------------------------
// Rank is not power.
//
// The first version of this rule compared ranks: grant what you outrank or
// match. `Owner` is rank 20 and holds 25 of the 27 permissions;
// `create_custom_role` permits ranks 21-254, and a Custom role above the editor
// threshold holds 9. So a rank-21 Custom outranked Owner on nine permissions'
// worth of authority, and the rank rule let it grant Owner — to itself.
//
// The rule now compares the permission sets, which is the property that was
// wanted all along.
// ---------------------------------------------------------------------------

/// Rank 21: outranks Owner (20) while holding a fraction of its permissions.
fn outranks_owner_custom() -> UserRole {
    UserRole::create_custom_role("overranked".to_string(), 21).expect("21 is not reserved")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_that_outranks_owner_still_cannot_grant_owner() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "overranked", outranks_owner_custom()).await;
    join_root(&kernel, "overranked").await;

    let outcome = try_add_as(&kernel, "overranked", "overranked", UserRole::Owner).await;
    assert!(
        outcome.is_err(),
        "rank 21 beats Owner's 20, but Owner carries 25 permissions to its 9: {outcome:?}",
    );

    let after = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("overranked")
        .await
        .expect("read user")
        .expect("user exists");
    assert_ne!(
        after.role,
        UserRole::Owner,
        "and the role must be unwritten"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_may_still_grant_a_role_it_fully_covers() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "overranked", outranks_owner_custom()).await;
    join_root(&kernel, "overranked").await;

    // Guest holds ViewContent alone, which this role has.
    let outcome = try_add_as(&kernel, "overranked", "newcomer", UserRole::Guest).await;
    assert!(
        outcome.is_ok(),
        "containment refuses only what the grantor lacks: {outcome:?}",
    );
}
