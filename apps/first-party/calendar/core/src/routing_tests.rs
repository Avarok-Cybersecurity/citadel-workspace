//! `routing`: rules are tried in order and the first that holds wins; nothing holding goes to the
//! fallback; text compares trimmed and without case; a required question must be answered and a
//! choice answered with one of its options; a form that does not hold together routes nowhere.

use crate::model_booking::{Answer, Question, QuestionKind};
use crate::routing::*;
use std::string::{String, ToString};
use std::vec;
use std::vec::Vec;

fn q(id: &str, kind: QuestionKind, required: bool) -> Question {
    Question {
        id: id.into(),
        label: id.into(),
        kind,
        required,
    }
}

fn member(name: &str) -> RoutingTarget {
    RoutingTarget::Member {
        username: name.into(),
        slug: "intro".into(),
    }
}

fn when(question_id: &str, test: AnswerTest) -> Condition {
    Condition {
        question_id: question_id.into(),
        test,
    }
}

fn form() -> RoutingForm {
    let size = QuestionKind::Choice {
        options: vec!["Small".into(), "Enterprise".into()],
    };
    RoutingForm {
        id: "sales".into(),
        name: "Talk to sales".into(),
        questions: vec![q("size", size, true), q("about", QuestionKind::Text, false)],
        rules: vec![
            RoutingRule {
                when: vec![
                    when(
                        "size",
                        AnswerTest::Is {
                            value: "Enterprise".into(),
                        },
                    ),
                    when("about", AnswerTest::Contains { text: "SSO".into() }),
                ],
                target: RoutingTarget::TeamType {
                    node_id: "sec".into(),
                    type_id: "rr".into(),
                },
            },
            RoutingRule {
                when: vec![when(
                    "size",
                    AnswerTest::IsOneOf {
                        values: vec!["enterprise".into()],
                    },
                )],
                target: member("ana"),
            },
        ],
        fallback: RoutingTarget::Node {
            node_id: "sales".into(),
        },
    }
}

fn answers(pairs: &[(&str, &str)]) -> Vec<Answer> {
    pairs
        .iter()
        .map(|(q, v)| Answer {
            question_id: q.to_string(),
            value: v.to_string(),
        })
        .collect()
}

#[test]
fn the_first_rule_that_holds_wins_and_none_holding_goes_to_the_fallback() {
    let f = form();
    let both = answers(&[("size", "Enterprise"), ("about", "we need sso and audit")]);
    assert_eq!(route(&f, &both), Ok(&f.rules[0].target));
    // The first rule needs both conditions; the second holds, in a different case and padded.
    assert_eq!(
        route(&f, &answers(&[("size", "  enterprise ")])),
        Ok(&member("ana"))
    );
    assert_eq!(
        route(&f, &answers(&[("size", "Small"), ("about", "SSO")])),
        Ok(&f.fallback)
    );
}

#[test]
fn the_order_of_the_rules_decides_when_two_hold() {
    let mut f = form();
    f.rules.swap(0, 1);
    let both = answers(&[("size", "Enterprise"), ("about", "SSO")]);
    assert_eq!(route(&f, &both), Ok(&member("ana")));
}

#[test]
fn a_required_question_must_be_answered_and_a_choice_with_its_options() {
    let f = form();
    assert_eq!(
        route(&f, &answers(&[("about", "x")])),
        Err(RoutingError::Unanswered("size".into()))
    );
    assert_eq!(
        route(&f, &answers(&[("size", "   ")])),
        Err(RoutingError::Unanswered("size".into()))
    );
    assert_eq!(
        route(&f, &answers(&[("size", "Huge")])),
        Err(RoutingError::NotAnOption("size".into()))
    );
}

#[test]
fn a_form_that_does_not_hold_together_routes_nowhere() {
    let unknown = RoutingForm {
        rules: vec![RoutingRule {
            when: vec![when("nope", AnswerTest::Is { value: "x".into() })],
            target: member("a"),
        }],
        ..form()
    };
    let off_menu = RoutingForm {
        rules: vec![RoutingRule {
            when: vec![when(
                "size",
                AnswerTest::Is {
                    value: "Huge".into(),
                },
            )],
            target: member("a"),
        }],
        ..form()
    };
    let contains_on_choice = RoutingForm {
        rules: vec![RoutingRule {
            when: vec![when("size", AnswerTest::Contains { text: "E".into() })],
            target: member("a"),
        }],
        ..form()
    };
    let empty_rule = RoutingForm {
        rules: vec![RoutingRule {
            when: vec![],
            target: member("a"),
        }],
        ..form()
    };
    let mut twice = form();
    twice.questions.push(q("size", QuestionKind::Text, false));
    for bad in [unknown, off_menu, contains_on_choice, empty_rule, twice] {
        assert!(
            matches!(
                route(&bad, &answers(&[("size", "Small")])),
                Err(RoutingError::BadForm(_))
            ),
            "{:?}",
            bad.rules
        );
    }
    let many = RoutingForm {
        rules: vec![form().rules[1].clone(); MAX_RULES + 1],
        ..form()
    };
    assert_eq!(
        check_form(&many),
        Err(RoutingError::BadForm("too many rules"))
    );
    assert_eq!(
        check_form(&RoutingForm {
            rules: vec![form().rules[1].clone(); MAX_RULES],
            ..form()
        }),
        Ok(())
    );
}

#[test]
fn an_unanswered_optional_question_holds_no_condition_on_it() {
    let f = RoutingForm {
        rules: vec![RoutingRule {
            when: vec![when(
                "about",
                AnswerTest::Contains {
                    text: String::new(),
                },
            )],
            target: member("bo"),
        }],
        ..form()
    };
    // "Contains nothing" holds for any answer, including none: the condition is the editor's to word.
    assert_eq!(route(&f, &answers(&[("size", "Small")])), Ok(&member("bo")));
    let is = RoutingForm {
        rules: vec![RoutingRule {
            when: vec![when("about", AnswerTest::Is { value: "x".into() })],
            target: member("bo"),
        }],
        ..form()
    };
    assert_eq!(route(&is, &answers(&[("size", "Small")])), Ok(&is.fallback));
}
