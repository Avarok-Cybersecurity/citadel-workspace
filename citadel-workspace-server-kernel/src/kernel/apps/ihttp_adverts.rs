//! Who serves which install through the relay, until when (R4.4), pure. A session serves an
//! install while any of its running instances advertises it: one session may run several
//! instances of one install (two zones, two tabs), and one of them closing must not withdraw
//! what the others still serve.

use super::ihttp_relay_types::RelayFault;
use std::collections::HashMap;

/// The instances one session may advertise one install for at once.
pub const MAX_INSTANCES_PER_SESSION: usize = 16;
/// An instance name: what the host chose, 1 to 64 of `[A-Za-z0-9_-]`.
pub const MAX_INSTANCE_BYTES: usize = 64;

#[derive(Debug, Clone)]
struct Advert {
    username: String,
    /// Instance to the time its advertisement runs out.
    instances: HashMap<String, u64>,
}

impl Advert {
    fn until(&self) -> u64 {
        self.instances.values().copied().max().unwrap_or(0)
    }
}

/// What a withdrawal left behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Withdrawal {
    /// Another instance of the session still advertises the install.
    StillServed,
    /// The session no longer serves the install.
    Ended,
}

pub fn is_instance_name(name: &str) -> bool {
    (1..=MAX_INSTANCE_BYTES).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Debug, Default)]
pub struct Adverts {
    by_install: HashMap<String, HashMap<u64, Advert>>,
}

impl Adverts {
    pub fn advertise(
        &mut self,
        install_id: &str,
        cid: u64,
        username: &str,
        instance: &str,
        until_ms: u64,
    ) -> Result<(), RelayFault> {
        if !is_instance_name(instance) {
            return Err(RelayFault::Instance);
        }
        let sessions = self.by_install.entry(install_id.to_string()).or_default();
        let advert = sessions.entry(cid).or_insert_with(|| Advert {
            username: username.to_string(),
            instances: HashMap::new(),
        });
        let known = advert.instances.contains_key(instance);
        if !known && advert.instances.len() >= MAX_INSTANCES_PER_SESSION {
            return Err(RelayFault::Busy);
        }
        advert.username = username.to_string();
        advert.instances.insert(instance.to_string(), until_ms);
        Ok(())
    }

    /// A session serving `install_id` now (as `username`, if given): the one advertised
    /// furthest ahead. Its cid and username.
    pub fn host(
        &self,
        install_id: &str,
        username: Option<&str>,
        now_ms: u64,
    ) -> Option<(u64, String)> {
        self.by_install
            .get(install_id)?
            .iter()
            .filter(|(_, a)| a.until() > now_ms && username.is_none_or(|u| a.username == u))
            .max_by_key(|(cid, a)| (a.until(), **cid))
            .map(|(cid, a)| (*cid, a.username.clone()))
    }

    pub fn expire(&mut self, now_ms: u64) {
        self.by_install.retain(|_, sessions| {
            sessions.retain(|_, a| {
                a.instances.retain(|_, until| *until > now_ms);
                !a.instances.is_empty()
            });
            !sessions.is_empty()
        });
    }

    /// `instance` of session `cid` stops advertising `install_id`.
    pub fn withdraw(&mut self, install_id: &str, cid: u64, instance: &str) -> Withdrawal {
        let Some(sessions) = self.by_install.get_mut(install_id) else {
            return Withdrawal::Ended;
        };
        let still = sessions.get_mut(&cid).is_some_and(|a| {
            a.instances.remove(instance);
            !a.instances.is_empty()
        });
        if !still {
            sessions.remove(&cid);
        }
        if sessions.is_empty() {
            self.by_install.remove(install_id);
        }
        match still {
            true => Withdrawal::StillServed,
            false => Withdrawal::Ended,
        }
    }

    pub fn forget_session(&mut self, cid: u64) {
        self.by_install.retain(|_, sessions| {
            sessions.remove(&cid);
            !sessions.is_empty()
        });
    }

    pub fn forget_install(&mut self, install_id: &str) {
        self.by_install.remove(install_id);
    }
}
