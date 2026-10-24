use crate::path_policy::*;
use citadel_sdk::prelude::{PathClass, PathKind};

const DOCKER_KERNEL_TOML: &str = include_str!("../../docker/workspace-server/kernel.toml");

#[derive(serde::Deserialize)]
struct Section {
    path_policy: PathPolicyConfig,
}

fn every_path() -> PathPolicyConfig {
    let rule = |kind, cost_weight| PathRuleConfig {
        kind,
        enabled: true,
        attempt_timeout_seconds: 30,
        cost_weight,
        classes: PathClass::ALL.to_vec(),
    };
    PathPolicyConfig {
        rules: vec![
            rule(PathKind::Direct, 0),
            rule(PathKind::PeerRelay, 1),
            rule(PathKind::Turn, 2),
            rule(PathKind::ServerRelay, 3),
        ],
        denied: vec![],
    }
}

#[test]
fn a_native_server_without_a_path_policy_names_the_section() {
    let error = format!("{:?}", native_path_policy(None).unwrap_err());
    assert!(error.contains("[path_policy]"), "{error}");
}

#[test]
fn a_configured_policy_keeps_its_order_timeouts_and_weights() {
    let policy = native_path_policy(Some(&every_path())).unwrap();
    let kinds: Vec<_> = policy.rules().iter().map(|r| r.kind).collect();
    assert_eq!(kinds, PathKind::ALL.to_vec());
    let turn = policy.rule(PathKind::Turn);
    assert_eq!(turn.attempt_timeout.as_secs(), 30);
    assert_eq!(turn.cost_weight, 2);
    assert!(turn.classes.contains(PathClass::Media));
}

#[test]
fn the_protocols_refusals_reach_the_operator_named() {
    let mut late = every_path();
    late.rules.swap(2, 3);
    let mut slow = every_path();
    slow.rules[0].attempt_timeout_seconds = 61;
    let mut missing = every_path();
    missing.rules.pop();
    for bad in [late, slow, missing] {
        let error = format!("{:?}", bad.policy().unwrap_err());
        assert!(error.contains("path_policy"), "{error}");
    }
}

#[test]
fn a_hosted_config_that_names_a_policy_is_refused() {
    assert!(refuse_configured_path_policy(None).is_ok());
    let error = format!(
        "{:?}",
        refuse_configured_path_policy(Some(&every_path())).unwrap_err()
    );
    assert!(error.contains("host supplies"), "{error}");
}

#[test]
fn an_unknown_key_in_the_section_is_refused() {
    let toml = "[path_policy]\ndenied = []\nrules = []\norder = []\n";
    assert!(toml::from_str::<Section>(toml).is_err());
}

#[test]
fn the_docker_kernel_toml_carries_a_valid_policy() {
    let section: Section = toml::from_str(DOCKER_KERNEL_TOML).unwrap();
    native_path_policy(Some(&section.path_policy)).unwrap();
}

#[test]
fn the_hosts_json_for_a_free_plan_keeps_media_off_the_server_relay() {
    // The shape deploy/tenant-worker control/path-policy.mjs sends for a tier without
    // media_on_server_relay.
    let json = r#"{"rules":[
        {"kind":"Direct","enabled":true,"attempt_timeout_seconds":30,"cost_weight":0,"classes":["Control","Msg","File","Media"]},
        {"kind":"PeerRelay","enabled":true,"attempt_timeout_seconds":30,"cost_weight":1,"classes":["Control","Msg","File","Media"]},
        {"kind":"Turn","enabled":true,"attempt_timeout_seconds":30,"cost_weight":2,"classes":["Control","Msg","File","Media"]},
        {"kind":"ServerRelay","enabled":true,"attempt_timeout_seconds":30,"cost_weight":3,"classes":["Control","Msg","File"]}
    ],"denied":[]}"#;
    let config: PathPolicyConfig = serde_json::from_str(json).unwrap();
    let policy = config.policy().unwrap();
    let relay = policy.rule(PathKind::ServerRelay);
    assert!(!relay.classes.contains(PathClass::Media));
    assert!(relay.classes.contains(PathClass::Control));
}
