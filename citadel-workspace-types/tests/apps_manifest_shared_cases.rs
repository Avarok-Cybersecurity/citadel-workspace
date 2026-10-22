//! The manifest cases the marketplace's TypeScript rules and the catalogue check are also held to
//! (apps/catalogue/fixtures/manifest-cases.json): each is accepted or refused here as the fixture
//! says, for the same field, so the three readers of a manifest cannot drift apart.

use citadel_workspace_types::apps_manifest::AppManifest;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Change {
    path: Vec<Value>,
    value: Value,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    expect: String,
    #[serde(default)]
    set: Vec<Change>,
    #[serde(default)]
    remove: Vec<Vec<Value>>,
    raw: Option<String>,
}

#[derive(Deserialize)]
struct Cases {
    base: Value,
    cases: Vec<Case>,
}

fn at<'a>(root: &'a mut Value, path: &[Value]) -> &'a mut Value {
    path.iter().fold(root, |at, key| match key {
        Value::String(name) => &mut at[name.as_str()],
        Value::Number(index) => &mut at[index.as_u64().expect("an index") as usize],
        other => panic!("not a path segment: {other}"),
    })
}

fn bytes_of(base: &Value, case: &Case) -> Vec<u8> {
    if let Some(raw) = &case.raw {
        return raw.as_bytes().to_vec();
    }
    let mut value = base.clone();
    for change in &case.set {
        *at(&mut value, &change.path) = change.value.clone();
    }
    for path in &case.remove {
        let (last, parent) = path.split_last().expect("a path");
        let name = last.as_str().expect("a field name");
        at(&mut value, parent)
            .as_object_mut()
            .expect("an object")
            .remove(name);
    }
    serde_json::to_vec(&value).expect("serializable")
}

#[test]
fn every_shared_case_is_answered_as_the_fixture_says() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../apps/catalogue/fixtures/manifest-cases.json"
    );
    let text = std::fs::read_to_string(path).expect("the shared cases are readable");
    let cases: Cases = serde_json::from_str(&text).expect("the cases' format");
    assert!(cases.cases.iter().any(|c| c.expect == "ok"));
    for case in &cases.cases {
        let answer = match AppManifest::from_bytes(&bytes_of(&cases.base, case)) {
            Ok(_) => "ok".to_string(),
            Err(refusal) => format!("{refusal:?}")
                .split('(')
                .next()
                .unwrap_or_default()
                .to_string(),
        };
        assert_eq!(answer, case.expect, "{}", case.name);
    }
}
