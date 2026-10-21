//! An admin payload must state every field: nothing it leaves out is filled in for it.

use super::tests::{issue, public_key, request, sealed, AUDIENCE, NOW};
use super::*;

/// The payload of `action`, edited as JSON, signed under the admin domain.
fn signed_with(action: AdminAction, edit: impl Fn(&mut serde_json::Value)) -> SignedAdminRequest {
    let mut value = serde_json::to_value(request(action)).expect("serialises");
    edit(&mut value["action"]);
    sealed(ADMIN_DOMAIN, &value)
}

fn remove(field: &'static str, variant: &'static str) -> impl Fn(&mut serde_json::Value) {
    move |action| {
        let fields = action[variant].as_object_mut().expect("a struct variant");
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
    let silent = signed_with(
        revoke.clone(),
        remove("also_revoke_grants", "revoke_coupon"),
    );
    assert!(matches!(
        verify_admin(&public_key(), &silent, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(why)) if why.contains("also_revoke_grants")
    ));
    assert!(verify_admin(&public_key(), &signed_with(revoke, |_| {}), AUDIENCE, NOW).is_ok());
}

#[test]
fn issue_must_name_its_deadline_even_when_it_has_none() {
    let missing = signed_with(issue(), remove("redeem_by_ms", "issue_coupon"));
    assert!(matches!(
        verify_admin(&public_key(), &missing, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(why)) if why.contains("redeem_by_ms")
    ));
    let none = signed_with(issue(), |a| {
        a["issue_coupon"]["redeem_by_ms"] = serde_json::Value::Null
    });
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
    let extra = signed_with(issue(), |a| a["issue_coupon"]["unlimited"] = true.into());
    assert!(matches!(
        verify_admin(&public_key(), &extra, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(_))
    ));
}
