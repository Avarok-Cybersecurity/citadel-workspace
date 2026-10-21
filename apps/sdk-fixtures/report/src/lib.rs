//! How a fixture tells its test what it saw: one `log` line per probe, `<probe>=<answer>`, and
//! the raw ABI imports the hostile fixtures call directly (bogus ops, forged handles, pointers
//! outside memory) that the SDK never would.

use citadel_app_sdk::types::{decode, HostReply};
use citadel_app_sdk::{Pending, Refused};

/// `ok`, `ungranted`, `unavailable:<r>`, `limit:<w>`, `policy:<r>` or `remote:<status>`.
pub fn answer<T>(result: &Result<T, Refused>) -> String {
    match result {
        Ok(_) => "ok".into(),
        Err(Refused::Ungranted) => "ungranted".into(),
        Err(Refused::Unavailable(r)) => format!("unavailable:{r}"),
        Err(Refused::Limit(w)) => format!("limit:{w}"),
        Err(Refused::Policy(r)) => format!("policy:{r}"),
        Err(Refused::Remote(s)) => format!("remote:{s}"),
    }
}

/// A raw ABI result: `code:<n>`.
pub fn code(n: i32) -> String {
    format!("code:{n}")
}

pub fn report(probe: &str, answer: &str) {
    let _ = citadel_app_sdk::log::info(&format!("{probe}={answer}"));
}

/// Report `pending`'s answer now if it came back with the call, else when it arrives. `A` is the
/// fixture's app type.
pub fn probe<A: 'static, T: 'static>(name: &'static str, mut pending: Pending<T>) {
    match pending.take_ready() {
        Some(result) => report(name, &answer(&result)),
        None => pending.then(move |_: &mut A, result| report(name, &answer(&result))),
    }
}

/// What a raw call's handle held: a code, or the reply's answer.
pub fn reply_answer(handle: i32) -> String {
    match raw::read(handle) {
        Err(c) => code(c),
        Ok(bytes) => match decode::<HostReply<()>>(&bytes) {
            Ok(reply) => answer(&reply.into_result()),
            Err(_) => "malformed".into(),
        },
    }
}

/// The imports, undressed.
pub mod raw {
    #[link(wasm_import_module = "citadel_app_abi_1")]
    extern "C" {
        pub fn log(op: i32, ptr: i32, len: i32) -> i32;
        pub fn nodes(op: i32, ptr: i32, len: i32) -> i32;
        pub fn reply_len(handle: i32) -> i32;
        pub fn reply_read(handle: i32, ptr: i32, cap: i32) -> i32;
    }

    /// The whole reply behind `handle`, or the negative code.
    pub fn read(handle: i32) -> Result<Vec<u8>, i32> {
        if handle < 0 {
            return Err(handle);
        }
        // SAFETY: plain integers in; the host writes at most `len` bytes into `buf`.
        unsafe {
            let len = reply_len(handle);
            if len < 0 {
                return Err(len);
            }
            let mut buf = vec![0u8; len as usize];
            let n = reply_read(handle, buf.as_mut_ptr() as usize as i32, len);
            if n < 0 {
                return Err(n);
            }
            Ok(buf)
        }
    }
}
