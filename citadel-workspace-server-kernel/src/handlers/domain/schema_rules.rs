//! What makes a hierarchy schema one the workspace can live in.
//!
//! UpdateTreeSchema stored whatever it was sent. The hierarchy editor puts every one of these
//! mistakes one drag away, so each is refused here, named, before anything is saved:
//! - no rule for the Workspace root (`rules: []` reads as "anything nests anywhere");
//! - a Workspace nested under something;
//! - a cycle (a level that can contain itself, directly or through others);
//! - a level with no display config, or two configs for one level;
//! - a type name, label or placeholder the client cannot show safely, or an icon it has no
//!   drawing for.
//!
//! `max_depth` is not trusted from the caller: it is derived from the rules (the longest chain
//! from the Workspace) and returned, so it can never cut off a level the rules allow.

use citadel_workspace_types::structs::{DomainNode, TreeSchema};
use std::collections::{BTreeSet, HashMap, HashSet};

pub const WORKSPACE_TYPE: &str = "Workspace";
pub const MAX_TYPE_NAME_CHARS: usize = 32;
pub const MAX_LABEL_CHARS: usize = 40;
pub const MAX_PLACEHOLDER_CHARS: usize = 120;
pub const MAX_LEVEL_TYPES: usize = 16;
/// The icons the client can draw: `ICON_MAP` in citadel-workspaces/src/lib/entity-type-registry.ts.
pub const LEVEL_ICONS: [&str; 7] = [
    "building-2",
    "briefcase",
    "message-square",
    "folder",
    "users",
    "folder-kanban",
    "layers",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaProblem {
    NoRootRule,
    WorkspaceNested(String),
    Cycle(String),
    MissingConfig(String),
    DuplicateType(String),
    BadTypeName(String),
    LabelTooLong(String),
    PlaceholderTooLong(String),
    UnknownIcon(String),
    TooManyLevels,
}

impl std::fmt::Display for SchemaProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoRootRule => write!(f, "nothing is allowed directly under the Workspace"),
            Self::WorkspaceNested(p) => write!(f, "a Workspace cannot be placed inside {p}"),
            Self::Cycle(t) => write!(f, "{t} can end up inside itself"),
            Self::MissingConfig(t) => write!(f, "the level {t} has no label"),
            Self::DuplicateType(t) => write!(f, "the level {t} is defined twice"),
            Self::BadTypeName(t) => write!(
                f,
                "\"{t}\" is not a usable level name (1 to {MAX_TYPE_NAME_CHARS} letters, digits, spaces, - or _)"
            ),
            Self::LabelTooLong(t) => write!(f, "a label of {t} is longer than {MAX_LABEL_CHARS} characters"),
            Self::PlaceholderTooLong(t) => {
                write!(f, "a placeholder of {t} is longer than {MAX_PLACEHOLDER_CHARS} characters")
            }
            Self::UnknownIcon(t) => write!(f, "the icon of {t} is not one the app can draw"),
            Self::TooManyLevels => write!(f, "a hierarchy can have at most {MAX_LEVEL_TYPES} levels"),
        }
    }
}

fn usable_type_name(name: &str) -> bool {
    let chars = name.chars().count();
    (1..=MAX_TYPE_NAME_CHARS).contains(&chars)
        && name.trim() == name
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '_')
}

/// Every problem with `schema`, or the depth of its deepest level (the Workspace is depth 0).
pub fn validate_schema(schema: &TreeSchema) -> Result<u32, Vec<SchemaProblem>> {
    let mut problems = Vec::new();
    let children: HashMap<&str, Vec<&str>> = schema
        .rules
        .iter()
        .map(|r| {
            (
                r.parent_type.as_str(),
                r.allowed_child_types.iter().map(String::as_str).collect(),
            )
        })
        .collect();

    if children.get(WORKSPACE_TYPE).is_none_or(|c| c.is_empty()) {
        problems.push(SchemaProblem::NoRootRule);
    }
    let mut levels: HashSet<&str> = HashSet::from([WORKSPACE_TYPE]);
    for rule in &schema.rules {
        levels.insert(rule.parent_type.as_str());
        for child in &rule.allowed_child_types {
            if child == WORKSPACE_TYPE {
                problems.push(SchemaProblem::WorkspaceNested(rule.parent_type.clone()));
            }
            levels.insert(child.as_str());
        }
    }
    if levels.len() > MAX_LEVEL_TYPES {
        problems.push(SchemaProblem::TooManyLevels);
    }

    let mut configured: HashSet<&str> = HashSet::new();
    for config in &schema.entity_type_configs {
        let t = config.type_name.as_str();
        if !configured.insert(t) {
            problems.push(SchemaProblem::DuplicateType(t.to_string()));
        }
        if [&config.label, &config.plural_label]
            .iter()
            .any(|l| l.trim().is_empty() || l.chars().count() > MAX_LABEL_CHARS)
        {
            problems.push(SchemaProblem::LabelTooLong(t.to_string()));
        }
        if [&config.name_placeholder, &config.description_placeholder]
            .iter()
            .any(|p| p.chars().count() > MAX_PLACEHOLDER_CHARS)
        {
            problems.push(SchemaProblem::PlaceholderTooLong(t.to_string()));
        }
        if !LEVEL_ICONS.contains(&config.icon.as_str()) {
            problems.push(SchemaProblem::UnknownIcon(t.to_string()));
        }
    }
    let mut sorted_levels: Vec<&str> = levels.iter().copied().collect();
    sorted_levels.sort_unstable();
    for level in sorted_levels {
        if !usable_type_name(level) {
            problems.push(SchemaProblem::BadTypeName(level.to_string()));
        }
        if !configured.contains(level) {
            problems.push(SchemaProblem::MissingConfig(level.to_string()));
        }
    }

    match deepest_level(&children) {
        Ok(depth) if problems.is_empty() => Ok(depth),
        Ok(_) => Err(problems),
        Err(cycle) => {
            problems.push(SchemaProblem::Cycle(cycle));
            Err(problems)
        }
    }
}

/// The longest chain of nesting from the Workspace, or the level at which a cycle closes.
fn deepest_level(children: &HashMap<&str, Vec<&str>>) -> Result<u32, String> {
    fn walk<'a>(
        at: &'a str,
        children: &HashMap<&'a str, Vec<&'a str>>,
        path: &mut Vec<&'a str>,
        memo: &mut HashMap<&'a str, u32>,
    ) -> Result<u32, String> {
        if path.contains(&at) {
            return Err(at.to_string());
        }
        if let Some(depth) = memo.get(at) {
            return Ok(*depth);
        }
        path.push(at);
        let mut deepest = 0;
        for child in children.get(at).into_iter().flatten() {
            if *child == WORKSPACE_TYPE {
                continue; // reported as WorkspaceNested, not walked
            }
            deepest = deepest.max(1 + walk(child, children, path, memo)?);
        }
        path.pop();
        memo.insert(at, deepest);
        Ok(deepest)
    }
    // Every level is walked, not only those reachable from the Workspace, so a cycle among
    // levels nothing uses yet is still refused.
    let mut memo = HashMap::new();
    let mut roots: Vec<&str> = children.keys().copied().collect();
    roots.sort_unstable();
    for root in roots {
        walk(root, children, &mut Vec::new(), &mut memo)?;
    }
    Ok(memo.get(WORKSPACE_TYPE).copied().unwrap_or(0))
}

/// The nodes `schema` does not allow where they stand: under a parent whose level may not contain
/// theirs, or deeper than the schema's `max_depth`. Every one, not the first, so a refused save
/// can name them all.
pub fn nodes_outside(nodes: &HashMap<String, DomainNode>, schema: &TreeSchema) -> BTreeSet<String> {
    nodes
        .values()
        .filter(|node| {
            let too_deep = schema.max_depth.is_some_and(|max| node.depth > max);
            // The implicit root is typed Workspace, as TreeValidator types it.
            let parent_type = match node.parent_id.as_deref() {
                None | Some(crate::WORKSPACE_ROOT_ID) => Some(WORKSPACE_TYPE),
                Some(id) => nodes.get(id).map(|p| p.entity_type.type_name()),
            };
            let misplaced = parent_type.is_some_and(|parent| {
                !schema.is_child_allowed(parent, node.entity_type.type_name())
            });
            too_deep || misplaced
        })
        .map(|node| node.id.clone())
        .collect()
}

/// `node` carrying the child levels the CURRENT schema allows it.
///
/// Stored nodes keep the list they were created with, so after a hierarchy change every stored
/// copy is stale. Clients read it to offer "add child" and move targets, so every node sent out
/// has it re-derived here instead.
pub fn with_derived_children(mut node: DomainNode, schema: &TreeSchema) -> DomainNode {
    node.allowed_child_types = schema
        .rules
        .iter()
        .find(|r| r.parent_type == node.entity_type.type_name())
        .map(|r| r.allowed_child_types.clone());
    node
}
