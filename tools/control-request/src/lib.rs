//! What Avarok's signed control-plane tools (`tools/telemetry-read`, `tools/coupon-admin`) share:
//! the control plane's origin, which is also the audience a request is signed for; the flag
//! parser; and, in `io`, the nonce, the clock and the post-quantum HTTPS POST.
//!
//! There is no default control plane: every command names its origin.

pub mod io;

use std::collections::BTreeMap;

/// The control plane: where requests go, and the host they are signed for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Control {
    pub origin: String,
    pub audience: String,
}

/// `https://<host>` (no path): the deployment's origin. The host is the request's audience.
pub fn control(text: &str) -> Result<Control, String> {
    let host = text
        .strip_prefix("https://")
        .ok_or_else(|| format!("--control {text:?} is not an https:// origin"))?;
    let valid = !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    if !valid {
        return Err(format!(
            "--control {text:?} is not https://<host> with no port or path"
        ));
    }
    Ok(Control {
        origin: text.to_string(),
        audience: host.to_ascii_lowercase(),
    })
}

/// A command's `--flag value` pairs, each given at most once, plus any `switches` (flags that
/// take no value) it was given.
#[derive(Debug)]
pub struct Flags {
    values: BTreeMap<String, String>,
    switches: Vec<String>,
}

impl Flags {
    /// `args` after the command name. `switches` names the flags that take no value.
    pub fn parse(args: &[String], switches: &[&str]) -> Result<Self, String> {
        let mut values = BTreeMap::new();
        let mut given = Vec::new();
        let mut rest = args.iter();
        while let Some(flag) = rest.next() {
            if !flag.starts_with("--") {
                return Err(format!("unexpected argument {flag:?}"));
            }
            if switches.contains(&flag.as_str()) {
                if given.contains(flag) {
                    return Err(format!("{flag} given twice"));
                }
                given.push(flag.clone());
                continue;
            }
            let value = rest.next().ok_or_else(|| format!("{flag} needs a value"))?;
            if values.insert(flag.clone(), value.clone()).is_some() {
                return Err(format!("{flag} given twice"));
            }
        }
        Ok(Self {
            values,
            switches: given,
        })
    }

    /// The value of `flag`, if it was given; taking it marks it used.
    pub fn take(&mut self, flag: &str) -> Option<String> {
        self.values.remove(flag)
    }

    /// Whether the switch `flag` was given; asking marks it used.
    pub fn switch(&mut self, flag: &str) -> bool {
        let before = self.switches.len();
        self.switches.retain(|given| given != flag);
        self.switches.len() != before
    }

    /// `Ok` when every flag given was used by `command`.
    pub fn finish(self, command: &str) -> Result<(), String> {
        match self.values.keys().chain(self.switches.iter()).next() {
            Some(flag) => Err(format!("{command} does not take {flag}")),
            None => Ok(()),
        }
    }
}

/// `value` as a whole number, or an error naming `flag`.
pub fn number<T: std::str::FromStr>(flag: &str, value: &str) -> Result<T, String> {
    value
        .parse()
        .map_err(|_| format!("{flag} {value:?} is not a whole number"))
}

#[cfg(test)]
mod tests;
