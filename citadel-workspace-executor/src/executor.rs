use crate::{ExecutableEntryPoint, ExecutionError, Result};
use async_trait::async_trait;

/// How far the running code is from the caller's address space.
///
/// Ordered from weakest to strongest, and compared as such — a policy asks for
/// "at least this much", so a new, stronger variant added in the middle would
/// change existing decisions. Add stronger variants at the end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Isolation {
    /// Same process, same heap. The code can reach everything the caller can:
    /// the session, the keys, the DOM, the socket. This is what `eval` gives.
    None,
    /// A separate sandbox on this machine with no handle to the caller's state
    /// — an OS process, a worker, an iframe with its own origin.
    Process,
    /// A different machine entirely. Compromising it does not compromise the
    /// caller's device.
    Machine,
}

impl Isolation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Isolation::None => "no isolation",
            Isolation::Process => "process isolation",
            Isolation::Machine => "machine isolation",
        }
    }
}

/// Somewhere code can be sent to run.
///
/// The type parameter is deliberate rather than a `dyn Any` payload: an
/// executor that can run one kind of work says so in its type, and a transport
/// that cannot encode a given entry point fails to compile instead of failing
/// at the first user who tries it.
#[async_trait]
pub trait SecureCodeExecutor<T: ExecutableEntryPoint>: Send {
    /// Run `data` wherever this executor runs things, and return what it
    /// produced.
    async fn request(&mut self, data: T) -> Result<T::Output>;

    /// What this executor guarantees. Reported by the executor rather than
    /// asserted by the caller, because the caller is the party with an
    /// incentive to be optimistic about it.
    fn isolation(&self) -> Isolation;

    /// For logs and error messages.
    fn name(&self) -> &'static str;
}

/// Run `data` on `executor`, refusing if the executor is too close to home.
///
/// This is the whole point of the abstraction, and the reason it is a free
/// function rather than a default method: a `SecureCodeExecutor` implementation
/// cannot override it, so no executor can quietly declare itself exempt.
///
/// The check is `TRUST` against `isolation()`, both stated by types rather than
/// by the call site. The MDX renderer is what this exists to make impossible:
/// member-authored code, executed with no isolation, in the viewer's own
/// session — a decision nobody made explicitly, because nothing ever asked.
pub async fn execute_with<T, E>(executor: &mut E, data: T) -> Result<T::Output>
where
    T: ExecutableEntryPoint,
    E: SecureCodeExecutor<T> + ?Sized,
{
    let required = T::TRUST.minimum_isolation();
    let provided = executor.isolation();

    if provided < required {
        return Err(ExecutionError::Refused {
            entry_point: T::NAME,
            trust: T::TRUST.as_str(),
            isolation: provided.as_str(),
            reason: "this code may not share an address space with the caller",
        });
    }

    executor.request(data).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientSideExecutor, Trust};

    struct Trusted;
    impl ExecutableEntryPoint for Trusted {
        type Output = u8;
        const NAME: &'static str = "trusted-work";
        const TRUST: Trust = Trust::FirstParty;
        fn execute(self) -> Result<u8> {
            Ok(7)
        }
    }

    struct MemberAuthored;
    impl ExecutableEntryPoint for MemberAuthored {
        type Output = u8;
        const NAME: &'static str = "member-document";
        const TRUST: Trust = Trust::Member;
        fn execute(self) -> Result<u8> {
            Ok(7)
        }
    }

    #[tokio::test]
    async fn first_party_code_may_run_in_process() {
        let mut executor = ClientSideExecutor::new();
        assert_eq!(execute_with(&mut executor, Trusted).await.unwrap(), 7);
    }

    #[tokio::test]
    async fn member_code_may_not_run_in_process() {
        // The MDX decision, expressed as a compile-time property of the work
        // rather than as a review comment nobody was going to write.
        let mut executor = ClientSideExecutor::new();

        let error = execute_with(&mut executor, MemberAuthored)
            .await
            .expect_err("member-authored code must not run in the caller's address space");

        let message = error.to_string();
        assert!(message.contains("member-document"), "{message}");
        assert!(message.contains("no isolation"), "{message}");
    }

    #[tokio::test]
    async fn the_refusal_names_what_was_wanted_and_what_was_offered() {
        // "Not allowed" sends the reader to the source. This has to say which
        // work, whose code, and what the executor actually provides.
        let mut executor = ClientSideExecutor::new();
        let message = execute_with(&mut executor, MemberAuthored)
            .await
            .unwrap_err()
            .to_string();

        assert!(message.contains("member-authored code"), "{message}");
        assert!(message.contains("no isolation"), "{message}");
    }

    #[test]
    fn isolation_orders_from_weakest_to_strongest() {
        // `execute_with` compares with `<`. If this ordering is ever reversed
        // or reshuffled, every policy decision silently inverts.
        assert!(Isolation::None < Isolation::Process);
        assert!(Isolation::Process < Isolation::Machine);
    }
}
