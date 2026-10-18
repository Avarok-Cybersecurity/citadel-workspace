use super::config::{DocumentsConfig, JSON_BYTES_PER_PAYLOAD_BYTE};

/// Small enough that every bound is reachable, and consistent with each other.
fn config() -> DocumentsConfig {
    DocumentsConfig {
        max_updates_per_pull: 1,
        snapshot_min_updates: 1,
        max_update_bytes: 1,
        max_snapshot_bytes: 1,
        max_awareness_bytes: 1,
        awareness_per_second: 1,
        appends_per_second: 1,
        pulls_per_second: 1,
        max_pending_log_bytes: 2,
        compact_at_pending_bytes: 1,
        retain_covered_updates_seqs: 1,
        max_clients_per_document: 1,
        max_request_frame_bytes: JSON_BYTES_PER_PAYLOAD_BYTE + 1,
    }
}

#[test]
fn every_bound_must_be_positive() {
    assert_eq!(config().validate(), Ok(()));
    let zeroed = [
        DocumentsConfig {
            max_updates_per_pull: 0,
            ..config()
        },
        DocumentsConfig {
            snapshot_min_updates: 0,
            ..config()
        },
        DocumentsConfig {
            max_update_bytes: 0,
            ..config()
        },
        DocumentsConfig {
            max_snapshot_bytes: 0,
            ..config()
        },
        DocumentsConfig {
            max_awareness_bytes: 0,
            ..config()
        },
        DocumentsConfig {
            awareness_per_second: 0,
            ..config()
        },
        DocumentsConfig {
            appends_per_second: 0,
            ..config()
        },
        DocumentsConfig {
            pulls_per_second: 0,
            ..config()
        },
        DocumentsConfig {
            max_pending_log_bytes: 0,
            ..config()
        },
        DocumentsConfig {
            compact_at_pending_bytes: 0,
            ..config()
        },
        DocumentsConfig {
            retain_covered_updates_seqs: 0,
            ..config()
        },
        DocumentsConfig {
            max_clients_per_document: 0,
            ..config()
        },
        DocumentsConfig {
            max_request_frame_bytes: 0,
            ..config()
        },
    ];
    for bad in zeroed {
        assert!(bad.validate().is_err(), "accepted {bad:?}");
    }
}

#[test]
fn a_log_cap_the_compaction_hint_cannot_precede_is_refused() {
    let at_the_hint = DocumentsConfig {
        snapshot_min_updates: 4,
        max_update_bytes: 8,
        max_pending_log_bytes: 32,
        max_request_frame_bytes: 64,
        ..config()
    };
    let refused = at_the_hint
        .validate()
        .expect_err("a cap at the hint was accepted");
    assert!(refused.contains("max_pending_log_bytes"), "{refused}");
    let past_it = DocumentsConfig {
        max_pending_log_bytes: 33,
        ..at_the_hint
    };
    assert_eq!(past_it.validate(), Ok(()));
}

#[test]
fn a_compaction_threshold_at_or_past_the_hard_cap_is_refused() {
    let at_cap = DocumentsConfig {
        compact_at_pending_bytes: 2,
        ..config()
    };
    let refused = at_cap
        .validate()
        .expect_err("a threshold at the cap was accepted");
    assert!(refused.contains("compact_at_pending_bytes"), "{refused}");
}

#[test]
fn a_frame_cap_that_cannot_carry_the_largest_payload_is_refused() {
    let snapshot = 100;
    let tight = DocumentsConfig {
        max_snapshot_bytes: snapshot,
        max_request_frame_bytes: snapshot * JSON_BYTES_PER_PAYLOAD_BYTE,
        ..config()
    };
    let refused = tight
        .validate()
        .expect_err("a frame too small for a snapshot was accepted");
    assert!(refused.contains("max_request_frame_bytes"), "{refused}");
    let roomy = DocumentsConfig {
        max_request_frame_bytes: snapshot * JSON_BYTES_PER_PAYLOAD_BYTE + 1,
        ..tight
    };
    assert_eq!(roomy.validate(), Ok(()));
}

#[test]
fn a_missing_key_is_a_parse_error_not_a_default() {
    let complete = "max_updates_per_pull = 1\nsnapshot_min_updates = 1\nmax_update_bytes = 1\n\
                    max_snapshot_bytes = 1\nmax_awareness_bytes = 1\nawareness_per_second = 1\n\
                    appends_per_second = 1\npulls_per_second = 1\nmax_pending_log_bytes = 2\n\
                    compact_at_pending_bytes = 1\nretain_covered_updates_seqs = 1\nmax_clients_per_document = 1\n\
                    max_request_frame_bytes = 5\n";
    let parsed: DocumentsConfig = toml::from_str(complete).expect("every key given");
    assert_eq!(parsed, config());
    for line in complete.lines() {
        let without: String = complete
            .lines()
            .filter(|l| *l != line)
            .map(|l| format!("{l}\n"))
            .collect();
        let parsed: Result<DocumentsConfig, _> = toml::from_str(&without);
        assert!(parsed.is_err(), "{line} was defaulted");
    }
}
