use super::*;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Quota {
    per_member: Limit,
    pool: Limit,
}

/// The host answer as the kernel read it before v2: counts only.
#[derive(Debug, Deserialize)]
struct V1Quota {
    #[allow(dead_code)]
    per_member: u32,
    #[allow(dead_code)]
    pool: u32,
}

fn quota(json: &str) -> Result<Quota, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

#[test]
fn a_count_is_a_limit_and_null_is_none() {
    let q = quota(r#"{"per_member":5,"pool":null}"#).expect("reads");
    assert_eq!(q.per_member, Limit::At(5));
    assert_eq!(q.pool, Limit::Unlimited);
    assert_eq!(
        quota(r#"{"per_member":0,"pool":4294967295}"#)
            .expect("reads")
            .pool,
        Limit::At(u32::MAX)
    );
}

#[test]
fn a_limit_left_out_or_misstated_is_refused_never_unlimited() {
    for bad in [
        r#"{"per_member":5}"#,
        r#"{"pool":null}"#,
        r#"{"per_member":-1,"pool":0}"#,
        r#"{"per_member":4294967296,"pool":0}"#,
        r#"{"per_member":1.5,"pool":0}"#,
        r#"{"per_member":"unlimited","pool":0}"#,
        r#"{"per_member":true,"pool":0}"#,
        r#"{"per_member":{},"pool":0}"#,
        r#"{"per_member":[],"pool":0}"#,
    ] {
        assert!(quota(bad).is_err(), "{bad} was read as {:?}", quota(bad));
    }
}

#[test]
fn a_v1_reader_given_null_refuses_rather_than_grants() {
    let refused = serde_json::from_str::<V1Quota>(r#"{"per_member":null,"pool":null}"#);
    assert!(refused.is_err(), "{refused:?}");
    assert!(serde_json::from_str::<V1Quota>(r#"{"per_member":5,"pool":50}"#).is_ok());
}

#[test]
fn a_limit_round_trips_through_its_wire_form() {
    for limit in [Limit::At(0), Limit::At(7), Limit::Unlimited] {
        let text = serde_json::to_string(&limit).expect("writes");
        assert_eq!(serde_json::from_str::<Limit>(&text).expect("reads"), limit);
        assert_eq!(
            serde_json::from_str::<Option<u32>>(&text).expect("as Option"),
            limit.ceiling()
        );
    }
}

#[test]
fn storage_is_a_byte_count_or_an_explicit_null() {
    use StorageAnswer::*;
    assert_eq!(
        storage_quota(Integer(25_000_000_000)),
        Ok(StorageQuota::Bytes(25_000_000_000))
    );
    assert_eq!(storage_quota(Integer(0)), Ok(StorageQuota::Bytes(0)));
    assert_eq!(storage_quota(Null), Ok(StorageQuota::Unlimited));
    for bad in [
        Missing,
        Integer(-1),
        Unreadable("\"unlimited\"".to_string()),
    ] {
        assert!(storage_quota(bad.clone()).is_err(), "{bad:?}");
    }
}
