use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use fool_api_types::AppToolResult;
use tokio::sync::oneshot;

/// Why a call did not come back.
#[derive(Debug, PartialEq, Eq)]
pub enum PendingError {
    /// Nobody answered inside the deadline. The application may be busy, or
    /// closing, or the window that owns the handler may be gone.
    TimedOut,
}

/// Calls that have been sent to the application and not yet answered.
///
/// The deadline is the whole point. Without one, a renderer that never replies
/// leaves an agent waiting forever and a user listening to silence — which is
/// indistinguishable from the application having crashed, and is the failure
/// this project has spent releases removing.
pub struct PendingCalls {
    waiting: Mutex<HashMap<String, oneshot::Sender<AppToolResult>>>,
    timeout: Duration,
}

impl PendingCalls {
    pub fn new(timeout: Duration) -> Self {
        Self {
            waiting: Mutex::new(HashMap::new()),
            timeout,
        }
    }

    /// Registers a call and waits for its answer.
    ///
    /// Registration happens before this returns to the caller's `await`, so a
    /// renderer that answers immediately cannot answer before anyone is
    /// listening.
    pub async fn issue(&self, call_id: String) -> Result<AppToolResult, PendingError> {
        let (tx, rx) = oneshot::channel();
        self.register(call_id.clone(), tx);

        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(result)) => Ok(result),
            // The deadline passed, or the sender was dropped. To the caller
            // these are the same thing: no answer arrived.
            _ => {
                self.forget(&call_id);
                Err(PendingError::TimedOut)
            }
        }
    }

    /// Hands a result to whoever is waiting for it.
    ///
    /// Returns whether anybody was. A late answer — one that arrives after its
    /// deadline — has nowhere to go, and saying so is more useful than failing.
    pub fn resolve(&self, result: AppToolResult) -> bool {
        let sender = self.take(&result.call_id);
        match sender {
            Some(tx) => tx.send(result).is_ok(),
            None => false,
        }
    }

    /// How many calls are outstanding, for diagnostics.
    pub fn outstanding(&self) -> usize {
        self.waiting.lock().expect("pending calls lock").len()
    }

    fn register(&self, call_id: String, tx: oneshot::Sender<AppToolResult>) {
        self.waiting.lock().expect("pending calls lock").insert(call_id, tx);
    }

    fn forget(&self, call_id: &str) {
        self.waiting.lock().expect("pending calls lock").remove(call_id);
    }

    fn take(&self, call_id: &str) -> Option<oneshot::Sender<AppToolResult>> {
        self.waiting.lock().expect("pending calls lock").remove(call_id)
    }
}

#[cfg(test)]
#[path = "pending_test.rs"]
mod pending_test;
