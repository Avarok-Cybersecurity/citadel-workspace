use crate::{ExecutableEntryPoint, Isolation, Result, SecureCodeExecutor};
use async_trait::async_trait;
use std::marker::PhantomData;

/// Runs the code right here, in this process.
///
/// The simplest executor and the only one with no transport. It reports
/// `Isolation::None` honestly, which is what makes `execute_with` refuse to
/// hand it anything a member wrote — the executor is not the security boundary,
/// the policy in front of it is.
pub struct ClientSideExecutor<T>(PhantomData<T>);

impl<T> ClientSideExecutor<T> {
    pub const fn new() -> Self {
        Self(PhantomData)
    }
}

impl<T> Default for ClientSideExecutor<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl<T: ExecutableEntryPoint> SecureCodeExecutor<T> for ClientSideExecutor<T> {
    async fn request(&mut self, input: T) -> Result<T::Output> {
        input.execute()
    }

    fn isolation(&self) -> Isolation {
        Isolation::None
    }

    fn name(&self) -> &'static str {
        "client-side"
    }
}

/// Runs the code here, but in a sandbox with no handle to the caller's state.
///
/// In a browser build that is a worker or an `srcdoc` iframe on its own origin;
/// on a host it is a child process with a stripped environment. Which of those
/// it is belongs to the `SandboxHost` implementation, not here — the point of
/// this type is that the policy sees `Isolation::Process` and stops refusing.
pub struct SandboxedLocalExecutor<T, H> {
    host: H,
    _entry: PhantomData<T>,
}

impl<T, H> SandboxedLocalExecutor<T, H> {
    pub const fn new(host: H) -> Self {
        Self {
            host,
            _entry: PhantomData,
        }
    }
}

/// Somewhere on this machine that can run code without sharing our state.
#[async_trait]
pub trait SandboxHost<T: ExecutableEntryPoint>: Send + Sync {
    async fn run(&self, input: T) -> Result<T::Output>;
}

#[async_trait]
impl<T, H> SecureCodeExecutor<T> for SandboxedLocalExecutor<T, H>
where
    T: ExecutableEntryPoint,
    H: SandboxHost<T> + Send,
{
    async fn request(&mut self, input: T) -> Result<T::Output> {
        self.host.run(input).await
    }

    fn isolation(&self) -> Isolation {
        Isolation::Process
    }

    fn name(&self) -> &'static str {
        "sandboxed-local"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{execute_with, Trust};

    struct MemberAuthored(u8);
    impl ExecutableEntryPoint for MemberAuthored {
        type Output = u8;
        const NAME: &'static str = "member-document";
        const TRUST: Trust = Trust::Member;
        fn execute(self) -> Result<u8> {
            Ok(self.0 * 2)
        }
    }

    struct DirectHost;
    #[async_trait]
    impl SandboxHost<MemberAuthored> for DirectHost {
        async fn run(&self, input: MemberAuthored) -> Result<u8> {
            input.execute()
        }
    }

    #[tokio::test]
    async fn a_sandbox_is_enough_for_member_code() {
        // The same input the in-process executor must refuse.
        let mut executor = SandboxedLocalExecutor::new(DirectHost);
        assert_eq!(
            execute_with(&mut executor, MemberAuthored(21))
                .await
                .unwrap(),
            42
        );
    }

    #[tokio::test]
    async fn the_sandbox_still_is_not_enough_for_anonymous_code() {
        struct Anonymous;
        impl ExecutableEntryPoint for Anonymous {
            type Output = ();
            const NAME: &'static str = "anonymous-payload";
            const TRUST: Trust = Trust::Anonymous;
            fn execute(self) -> Result<()> {
                Ok(())
            }
        }
        struct AnyHost;
        #[async_trait]
        impl SandboxHost<Anonymous> for AnyHost {
            async fn run(&self, input: Anonymous) -> Result<()> {
                input.execute()
            }
        }

        let mut executor = SandboxedLocalExecutor::new(AnyHost);
        assert!(execute_with(&mut executor, Anonymous).await.is_err());
    }
}
