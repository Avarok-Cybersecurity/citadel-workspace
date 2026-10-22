//! An admin payload must state every field: nothing it leaves out is filled in for it.

use super::tests::{issue, public_key, request, sealed, AUDIENCE, NOW};
use super::*;

/// The payload of `action`, edited as JSON, signed under the admin domain.
fn signed_with(action: AdminAction, edit: impl Fn(&mut serde_json::Value)) -> SignedAdminRequest {
    let mut value = serde_json::to_value(request(action)).expect("serialises");
    edit(&mut value["action"]);
    sealed(ADMIN_DOMAIN, &value)
}

fn remove(field: &'static str) -> impl Fn(&mut serde_json::Value) {
    move |action| {
        let fields = action.as_object_mut().expect("an internally tagged action");
        assert!(
            fields.remove(field).is_some(),
            "{field} was there to remove"
        );
    }
}

#[test]
fn revoke_must_say_whether_grants_go_too() {
    let revoke = AdminAction::RevokeCoupon {
        code: "PARTNER-ACME".to_string(),
        also_revoke_grants: true,
    };
    let silent = signed_with(revoke.clone(), remove("also_revoke_grants"));
    assert!(matches!(
        verify_admin(&public_key(), &silent, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(why)) if why.contains("also_revoke_grants")
    ));
    assert!(verify_admin(&public_key(), &signed_with(revoke, |_| {}), AUDIENCE, NOW).is_ok());
}

#[test]
fn issue_must_name_its_deadline_even_when_it_has_none() {
    let missing = signed_with(issue(), remove("redeem_by_ms"));
    assert!(matches!(
        verify_admin(&public_key(), &missing, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(why)) if why.contains("redeem_by_ms")
    ));
    let none = signed_with(issue(), |a| a["redeem_by_ms"] = serde_json::Value::Null);
    let got = verify_admin(&public_key(), &none, AUDIENCE, NOW).expect("null is a stated none");
    assert!(matches!(
        got.action,
        AdminAction::IssueCoupon {
            redeem_by_ms: None,
            ..
        }
    ));
}

#[test]
fn an_unknown_field_in_the_action_is_refused() {
    let extra = signed_with(issue(), |a| a["unlimited"] = true.into());
    assert!(matches!(
        verify_admin(&public_key(), &extra, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(_))
    ));
}

fn refused(signed: &SignedAdminRequest, why: &str) {
    assert!(
        matches!(
            verify_admin(&public_key(), signed, AUDIENCE, NOW),
            Err(Refusal::MalformedRequest(ref got)) if got.contains(why)
        ),
        "expected a refusal naming {why}"
    );
}

#[test]
fn the_action_is_signed_in_the_shape_the_worker_reads() {
    let value = serde_json::to_value(request(issue())).expect("serialises");
    assert_eq!(
        value["action"],
        serde_json::json!({
            "kind": "issue_coupon", "code": "PARTNER-ACME", "template": null,
            "grant_id": "design-partner", "available_on": ["business"], "intervals": ["month"],
            "max_redemptions": 1, "redeem_by_ms": NOW + 30 * 24 * 3_600_000,
            "note": "acme design partner",
        })
    );
    let list = serde_json::to_value(request(AdminAction::ListCoupons)).expect("serialises");
    assert_eq!(
        list["action"],
        serde_json::json!({ "kind": "list_coupons" })
    );
}

#[test]
fn an_issue_names_exactly_one_of_template_and_grant_id_and_states_both() {
    refused(&signed_with(issue(), remove("template")), "template");
    refused(&signed_with(issue(), remove("grant_id")), "grant_id");
    refused(
        &signed_with(issue(), |a| a["grant_id"] = serde_json::Value::Null),
        "exactly one of template and grant_id",
    );
    refused(
        &signed_with(issue(), |a| a["template"] = "pct-10-once".into()),
        "exactly one of template and grant_id",
    );
}

#[test]
fn a_field_less_action_still_refuses_an_unknown_field() {
    let extra = signed_with(AdminAction::ListCoupons, |a| a["code"] = "X".into());
    assert!(matches!(
        verify_admin(&public_key(), &extra, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(_))
    ));
    let untagged = signed_with(AdminAction::ListCoupons, |a| *a = "list_coupons".into());
    assert!(matches!(
        verify_admin(&public_key(), &untagged, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(_))
    ));
}
