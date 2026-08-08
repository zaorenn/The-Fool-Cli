use super::*;
use std::sync::Arc;

fn answer(call_id: &str, content: &str) -> AppToolResult {
    AppToolResult {
        call_id: call_id.into(),
        ok: true,
        content: content.into(),
    }
}

/// Waits until the call has actually been registered.
///
/// Yielding once is not enough on a multi-threaded runtime: the waiting task
/// may not have been polled yet, and a test that answers too early would pass
/// or fail depending on the scheduler.
async fn once_registered(pending: &PendingCalls) {
    for _ in 0..1000 {
        if pending.outstanding() > 0 {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("the call was never registered");
}

#[tokio::test]
async fn a_resolved_call_returns_its_result() {
    let pending = Arc::new(PendingCalls::new(Duration::from_secs(5)));
    let waiter = pending.clone();
    let task = tokio::spawn(async move { waiter.issue("call-1".into()).await });

    once_registered(&pending).await;
    assert!(pending.resolve(answer("call-1", "a browser and a code editor")));

    let result = task.await.unwrap().unwrap();
    assert_eq!(result.content, "a browser and a code editor");
}

#[tokio::test]
async fn a_call_nobody_answers_times_out_rather_than_hanging() {
    let pending = PendingCalls::new(Duration::from_millis(20));
    assert_eq!(pending.issue("call-2".into()).await, Err(PendingError::TimedOut));
    // And it does not leak: a timed-out call is no longer outstanding.
    assert_eq!(pending.outstanding(), 0);
}

#[tokio::test]
async fn a_result_for_an_unknown_call_is_dropped_without_panicking() {
    let pending = PendingCalls::new(Duration::from_secs(5));
    assert!(!pending.resolve(answer("never-issued", "ignored")));
}

#[tokio::test]
async fn two_calls_are_answered_independently() {
    let pending = Arc::new(PendingCalls::new(Duration::from_secs(5)));

    let first = tokio::spawn({
        let pending = pending.clone();
        async move { pending.issue("a".into()).await }
    });
    let second = tokio::spawn({
        let pending = pending.clone();
        async move { pending.issue("b".into()).await }
    });

    for _ in 0..1000 {
        if pending.outstanding() == 2 {
            break;
        }
        tokio::task::yield_now().await;
    }

    // Answered out of order on purpose: an agent may have two calls in flight
    // and the second may be the quick one.
    assert!(pending.resolve(answer("b", "second")));
    assert!(pending.resolve(answer("a", "first")));

    assert_eq!(first.await.unwrap().unwrap().content, "first");
    assert_eq!(second.await.unwrap().unwrap().content, "second");
}
