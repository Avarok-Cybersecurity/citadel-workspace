//! What the app holds itself to, which its manifest declares: the host clamps to the manifest,
//! and a test here keeps these equal to `manifest.json`, so the two cannot drift apart.

/// `limits.p2p`.
pub const MAX_FANOUT_CONCURRENCY: u32 = 8;
pub const MAX_FANOUT_BYTES: u32 = 4 * 1024 * 1024;
pub const MAX_FANOUT_MS: u32 = 20_000;
pub const MAX_RESPONSE_BYTES: u32 = 65_536;
/// One call's share of the fan-out's time.
pub const PER_CALL_MS: u32 = 10_000;
/// `limits.topics`.
pub const TOPIC_MAX_MSG_BYTES: u32 = 4096;
pub const TOPIC_MAX_MSGS_PER_S: u32 = 2;
/// How often a member says it is there, and how long a silent member stays on the dashboard.
pub const HEARTBEAT_MS: u32 = 10_000;
pub const PEER_STALE_MS: u64 = 35_000;
/// How long a job collects claims before it is handed out.
pub const CLAIM_WINDOW_MS: u32 = 1_500;
/// The job history kept in `storage.user`.
pub const HISTORY_LEN: usize = 50;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{format, string::String, vec::Vec};

    fn field(manifest: &str, path: &[&str]) -> u64 {
        let mut v: &serde_json::Value = &serde_json::from_str(manifest).unwrap();
        for p in path {
            v = &v[p];
        }
        v.as_u64()
            .unwrap_or_else(|| panic!("{path:?} is not a number"))
    }

    #[test]
    fn the_constants_are_the_manifests_limits() {
        let m = include_str!("../../manifest.json");
        let p2p = |f| field(m, &["limits", "p2p", f]);
        assert_eq!(
            p2p("max_fanout_concurrency"),
            u64::from(MAX_FANOUT_CONCURRENCY)
        );
        assert_eq!(p2p("max_fanout_bytes"), u64::from(MAX_FANOUT_BYTES));
        assert_eq!(p2p("max_fanout_ms"), u64::from(MAX_FANOUT_MS));
        assert_eq!(p2p("max_response_bytes"), u64::from(MAX_RESPONSE_BYTES));
        let topics = |f| field(m, &["limits", "topics", f]);
        assert_eq!(topics("max_msg_bytes"), u64::from(TOPIC_MAX_MSG_BYTES));
        assert_eq!(topics("max_msgs_per_s"), u64::from(TOPIC_MAX_MSGS_PER_S));
        const { assert!(PER_CALL_MS <= MAX_FANOUT_MS) };
    }

    #[test]
    fn the_manifest_serves_exactly_the_apps_routes_on_both_planes_and_names_its_topic() {
        let m: serde_json::Value =
            serde_json::from_str(include_str!("../../manifest.json")).unwrap();
        let caps = m["capabilities"].as_array().unwrap();
        let of = |cap: &str, key: &str| -> Vec<String> {
            let request = caps
                .iter()
                .find(|c| c["cap"] == cap)
                .unwrap_or_else(|| panic!("{cap}"));
            serde_json::from_value(request[key].clone()).unwrap()
        };
        let routes: Vec<String> = crate::wire::ROUTES
            .iter()
            .map(|(method, path)| format!("{} {path}", crate::wire::method_name(method)))
            .collect();
        assert_eq!(of("ihttp.serve", "routes"), routes);
        assert_eq!(of("ihttp.p2p.serve", "routes"), routes);
        assert_eq!(of("ihttp.p2p.call", "targets"), Vec::<String>::new());
        for cap in ["group.topic.subscribe", "group.topic.publish"] {
            assert_eq!(of(cap, "topics"), [crate::wire::TOPIC]);
        }
    }
}
