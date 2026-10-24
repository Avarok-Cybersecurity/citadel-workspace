//! `topic`: a change names a node and a key, and a payload carrying anything more is refused.

use crate::topic::*;
use std::string::String;
use std::vec;

#[test]
fn a_change_round_trips() {
    let c = CalChange {
        node: "eng".into(),
        key: "cal/event/e1".into(),
    };
    assert_eq!(decode_change(&encode_change(&c).expect("fits")), Ok(c));
}

#[test]
fn a_payload_with_content_is_refused() {
    #[derive(serde::Serialize)]
    struct Leaky {
        node: String,
        key: String,
        title: String,
    }
    let leaky = Leaky {
        node: "eng".into(),
        key: "cal/event/e1".into(),
        title: "Layoffs".into(),
    };
    assert_eq!(
        decode_change(&citadel_app_sdk_types::encode(&leaky)),
        Err(TopicError::Refused)
    );
}

#[test]
fn a_change_past_the_topic_limit_is_refused() {
    let c = CalChange {
        node: "eng".into(),
        key: String::from_utf8(vec![b'k'; TOPIC_MAX_BYTES]).expect("ascii"),
    };
    assert_eq!(encode_change(&c), Err(TopicError::TooLarge));
    assert_eq!(
        decode_change(&vec![0u8; TOPIC_MAX_BYTES + 1]),
        Err(TopicError::TooLarge)
    );
}
