use crate::{ExecutableEntryPoint, ExecutionError, Isolation, Result, SecureCodeExecutor};
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::marker::PhantomData;

/// What crosses the wire on the way out.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireRequest {
    /// `ExecutableEntryPoint::NAME`, so the far side knows what it is being
    /// asked to run without guessing from the payload's shape.
    pub entry_point: &'static str,
    pub payload: Vec<u8>,
}

/// What comes back.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireResponse {
    pub payload: Vec<u8>,
}

/// A way to get a `WireRequest` to somewhere that will run it.
///
/// Everything specific to SSH, to the workspace server, or to a container host
/// lives behind this. `RemoteExecutor` therefore has no idea where the work
/// goes, which is what lets the destination change without any caller changing.
#[async_trait]
pub trait ExecutionTransport: Send + Sync {
    async fn dispatch(&self, request: WireRequest) -> Result<WireResponse>;

    /// What this transport actually guarantees. A transport that runs the work
    /// on the same machine must say `Process`, not `Machine`, however remote
    /// its API looks.
    fn isolation(&self) -> Isolation;

    fn name(&self) -> &'static str;
}

/// Runs work somewhere else by serialising it, over any transport.
///
/// The serialisation bounds sit here rather than on `ExecutableEntryPoint`, so
/// work that can only ever run locally is not forced to be serialisable to
/// satisfy a trait it will never use.
pub struct RemoteExecutor<T, X> {
    transport: X,
    _entry: PhantomData<T>,
}

impl<T, X> RemoteExecutor<T, X> {
    pub const fn new(transport: X) -> Self {
        Self {
            transport,
            _entry: PhantomData,
        }
    }
}

#[async_trait]
impl<T, X> SecureCodeExecutor<T> for RemoteExecutor<T, X>
where
    T: ExecutableEntryPoint + Serialize,
    T::Output: DeserializeOwned,
    X: ExecutionTransport + Send,
{
    async fn request(&mut self, input: T) -> Result<T::Output> {
        let payload = serde_json::to_vec(&input).map_err(|e| ExecutionError::Encoding {
            entry_point: T::NAME,
            message: e.to_string(),
        })?;

        let response = self
            .transport
            .dispatch(WireRequest {
                entry_point: T::NAME,
                payload,
            })
            .await?;

        serde_json::from_slice(&response.payload).map_err(|e| ExecutionError::Encoding {
            entry_point: T::NAME,
            message: e.to_string(),
        })
    }

    fn isolation(&self) -> Isolation {
        // Reported by the transport, not assumed from the fact that this type
        // is called "remote". A transport that turns out to run the work
        // locally must not launder itself into machine isolation by being
        // wrapped in this struct.
        self.transport.isolation()
    }

    fn name(&self) -> &'static str {
        self.transport.name()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{execute_with, Trust};

    #[derive(Serialize)]
    struct Doc(String);
    impl ExecutableEntryPoint for Doc {
        type Output = String;
        const NAME: &'static str = "render-document";
        const TRUST: Trust = Trust::Member;
        fn execute(self) -> Result<String> {
            Ok(self.0)
        }
    }

    struct Echo(Isolation);
    #[async_trait]
    impl ExecutionTransport for Echo {
        async fn dispatch(&self, request: WireRequest) -> Result<WireResponse> {
            let input: String = serde_json::from_slice(&request.payload).unwrap();
            Ok(WireResponse {
                payload: serde_json::to_vec(&format!("rendered:{input}")).unwrap(),
            })
        }
        fn isolation(&self) -> Isolation {
            self.0
        }
        fn name(&self) -> &'static str {
            "echo"
        }
    }

    #[tokio::test]
    async fn round_trips_through_a_transport() {
        let mut executor = RemoteExecutor::new(Echo(Isolation::Machine));
        let out = execute_with(&mut executor, Doc("hello".into()))
            .await
            .unwrap();
        assert_eq!(out, "rendered:hello");
    }

    #[tokio::test]
    async fn a_transport_cannot_launder_its_isolation_by_being_called_remote() {
        // The named danger: a transport that in fact runs the work in this
        // process, wrapped in a struct called RemoteExecutor. The policy must
        // still see what the transport reports.
        let mut executor = RemoteExecutor::new(Echo(Isolation::None));

        let error = execute_with(&mut executor, Doc("hello".into()))
            .await
            .expect_err("in-process transport must not satisfy member-code policy");

        assert!(error.to_string().contains("no isolation"), "{error}");
    }

    #[tokio::test]
    async fn the_wire_request_names_the_entry_point() {
        // Without it the far side has to infer the work from the payload shape,
        // which is how one entry point comes to be run as another.
        struct Naming;
        #[async_trait]
        impl ExecutionTransport for Naming {
            async fn dispatch(&self, request: WireRequest) -> Result<WireResponse> {
                assert_eq!(request.entry_point, "render-document");
                Ok(WireResponse {
                    payload: serde_json::to_vec("ok").unwrap(),
                })
            }
            fn isolation(&self) -> Isolation {
                Isolation::Machine
            }
            fn name(&self) -> &'static str {
                "naming"
            }
        }

        let mut executor = RemoteExecutor::new(Naming);
        assert_eq!(
            execute_with(&mut executor, Doc("x".into())).await.unwrap(),
            "ok"
        );
    }
}
