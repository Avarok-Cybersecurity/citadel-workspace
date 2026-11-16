//! Routing forms (Calendar design §3.6.3): a node's questions, and an ordered rule list mapping a
//! booker's answers to where they book: a member's page, a team type, or a node's page. The
//! booker's client evaluates it; the first rule whose every condition holds wins, else the form's
//! fallback. The chosen target then runs the ordinary booking flow, so a form grants nothing.
//!
//! Text compares trimmed and without regard to case; a choice answer must be one of its options.

use crate::model::{NodeId, Username};
use crate::model_booking::{Answer, Question, QuestionKind};
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// The most rules a form holds, and conditions a rule holds: a form an editor can still read.
pub const MAX_RULES: usize = 64;
pub const MAX_CONDITIONS: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct RoutingForm {
    pub id: String,
    pub name: String,
    pub questions: Vec<Question>,
    /// Tried in order; the first that holds routes the booker.
    pub rules: Vec<RoutingRule>,
    /// Where a booker goes when no rule holds.
    pub fallback: RoutingTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct RoutingRule {
    /// Every one must hold; at least one.
    pub when: Vec<Condition>,
    pub target: RoutingTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Condition {
    pub question_id: String,
    pub test: AnswerTest,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum AnswerTest {
    Is { value: String },
    IsOneOf { values: Vec<String> },
    Contains { text: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum RoutingTarget {
    Member { username: Username, slug: String },
    TeamType { node_id: NodeId, type_id: String },
    Node { node_id: NodeId },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RoutingError {
    /// A required question has no answer, or the form names a question it does not ask.
    Unanswered(String),
    /// A choice answered with something that is not one of its options.
    NotAnOption(String),
    /// The form itself does not hold together; the reason, for its editor.
    BadForm(&'static str),
}

fn norm(text: &str) -> String {
    text.trim().to_lowercase()
}

fn question<'a>(form: &'a RoutingForm, id: &str) -> Option<&'a Question> {
    form.questions.iter().find(|q| q.id == id)
}

/// Whether `form` holds together: distinct question ids, rules within bounds, each condition on a
/// question it asks, and a choice test naming only that choice's options.
pub fn check_form(form: &RoutingForm) -> Result<(), RoutingError> {
    let ids: Vec<&str> = form.questions.iter().map(|q| q.id.as_str()).collect();
    if ids.iter().enumerate().any(|(i, id)| ids[..i].contains(id)) {
        return Err(RoutingError::BadForm("two questions share an id"));
    }
    if form.rules.len() > MAX_RULES {
        return Err(RoutingError::BadForm("too many rules"));
    }
    for rule in &form.rules {
        if rule.when.is_empty() || rule.when.len() > MAX_CONDITIONS {
            return Err(RoutingError::BadForm(
                "a rule needs one to eight conditions",
            ));
        }
        for condition in &rule.when {
            let Some(q) = question(form, &condition.question_id) else {
                return Err(RoutingError::BadForm(
                    "a rule asks about a question the form does not ask",
                ));
            };
            if let QuestionKind::Choice { options } = &q.kind {
                let named: Vec<&String> = match &condition.test {
                    AnswerTest::Is { value } => alloc::vec![value],
                    AnswerTest::IsOneOf { values } => values.iter().collect(),
                    AnswerTest::Contains { .. } => {
                        return Err(RoutingError::BadForm("a choice is tested by its options"))
                    }
                };
                if !named
                    .iter()
                    .all(|v| options.iter().any(|o| norm(o) == norm(v)))
                {
                    return Err(RoutingError::BadForm(
                        "a rule names an option the choice does not offer",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn holds(test: &AnswerTest, answer: &str) -> bool {
    let answer = norm(answer);
    match test {
        AnswerTest::Is { value } => norm(value) == answer,
        AnswerTest::IsOneOf { values } => values.iter().any(|v| norm(v) == answer),
        AnswerTest::Contains { text } => answer.contains(&norm(text)),
    }
}

/// Where `answers` route on `form`: the first rule whose every condition holds, else the fallback.
pub fn route<'a>(
    form: &'a RoutingForm,
    answers: &[Answer],
) -> Result<&'a RoutingTarget, RoutingError> {
    check_form(form)?;
    let given = |id: &str| -> &str {
        answers
            .iter()
            .find(|a| a.question_id == id)
            .map_or("", |a| a.value.as_str())
    };
    for q in &form.questions {
        let value = given(&q.id);
        if q.required && value.trim().is_empty() {
            return Err(RoutingError::Unanswered(q.id.clone()));
        }
        if let QuestionKind::Choice { options } = &q.kind {
            let chosen = !value.trim().is_empty();
            if chosen && !options.iter().any(|o| norm(o) == norm(value)) {
                return Err(RoutingError::NotAnOption(q.id.clone()));
            }
        }
    }
    let matched = form.rules.iter().find(|rule| {
        rule.when
            .iter()
            .all(|c| holds(&c.test, given(&c.question_id)))
    });
    Ok(matched.map_or(&form.fallback, |rule| &rule.target))
}
