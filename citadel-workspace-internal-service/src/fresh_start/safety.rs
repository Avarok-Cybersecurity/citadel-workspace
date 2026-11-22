//! Which directory starting fresh may remove: only the configured data directory, and never one
//! whose removal would take more than the agent's own data with it.

use std::path::{Component, Path};

/// What the filesystem says about the target, read without following a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirFacts {
    pub is_symlink: bool,
    pub is_dir: bool,
}

impl DirFacts {
    pub fn of(path: &Path) -> std::io::Result<Self> {
        let meta = std::fs::symlink_metadata(path)?;
        Ok(Self {
            is_symlink: meta.file_type().is_symlink(),
            is_dir: meta.is_dir(),
        })
    }
}

/// Why a target is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unsafe {
    NotTheConfiguredDir,
    NotAbsolute,
    /// A `..` or `.` component: what it names depends on what is linked where.
    NotNormal,
    Root,
    Home,
    /// It contains the home directory, so removing it removes the person's files.
    ContainsHome,
    Symlink,
    NotADirectory,
}

impl std::fmt::Display for Unsafe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let why = match self {
            Unsafe::NotTheConfiguredDir => "it is not this agent's data directory",
            Unsafe::NotAbsolute => "its path is not absolute",
            Unsafe::NotNormal => "its path has a '.' or '..' in it",
            Unsafe::Root => "it is the root of the filesystem",
            Unsafe::Home => "it is your home folder",
            Unsafe::ContainsHome => "your home folder is inside it",
            Unsafe::Symlink => "it is a link to somewhere else",
            Unsafe::NotADirectory => "it is not a folder",
        };
        write!(f, "Citadel did not remove that folder: {why}.")
    }
}

impl std::error::Error for Unsafe {}

/// Decides whether `target` may be removed. Pure: the facts are read by the caller.
pub fn judge(
    target: &Path,
    configured: &Path,
    home: Option<&Path>,
    facts: &DirFacts,
) -> Result<(), Unsafe> {
    if target != configured {
        return Err(Unsafe::NotTheConfiguredDir);
    }
    if !target.is_absolute() {
        return Err(Unsafe::NotAbsolute);
    }
    if target
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err(Unsafe::NotNormal);
    }
    if target.parent().is_none() {
        return Err(Unsafe::Root);
    }
    if let Some(home) = home {
        if target == home {
            return Err(Unsafe::Home);
        }
        if home.starts_with(target) {
            return Err(Unsafe::ContainsHome);
        }
    }
    if facts.is_symlink {
        return Err(Unsafe::Symlink);
    }
    if !facts.is_dir {
        return Err(Unsafe::NotADirectory);
    }
    Ok(())
}
