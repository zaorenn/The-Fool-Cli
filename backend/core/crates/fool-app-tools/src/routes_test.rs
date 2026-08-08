use super::*;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use std::time::Duration;
use tower::ServiceExt;

fn state() -> AppToolsState {
    AppToolsState {
        catalogue: Arc::new(Catalogue::new()),
        pending: Arc::new(PendingCalls::new(Duration::from_secs(5))),
    }
}

fn post_json(path: &str, body: serde_json::Value) -> Request<Body> {
    Request::post(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("a request")
}

#[tokio::test]
async fn registering_a_catalogue_stores_it() {
    let state = state();
    let response = router(state.clone())
        .oneshot(post_json(
            "/api/app-tools/catalogue",
            json!({"tools": [{"name": "app_theme", "description": "d", "inputSchema": {"type": "object"}}]}),
        ))
        .await
        .expect("a response");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(state.catalogue.offers("app_theme"));
}

#[tokio::test]
async fn a_result_reaches_the_call_that_is_waiting_for_it() {
    let state = state();
    let pending = state.pending.clone();
    let waiter = tokio::spawn(async move { pending.issue("call-1".into()).await });

    for _ in 0..1000 {
        if state.pending.outstanding() > 0 {
            break;
        }
        tokio::task::yield_now().await;
    }

    let response = router(state)
        .oneshot(post_json(
            "/api/app-tools/result",
            json!({"call_id": "call-1", "ok": true, "content": "done"}),
        ))
        .await
        .expect("a response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(waiter.await.unwrap().unwrap().content, "done");
}

#[tokio::test]
async fn a_result_for_nothing_pending_is_accepted_and_ignored() {
    // A late answer — one that arrives after its deadline — is not an error for
    // the renderer to handle. It has nowhere useful to go.
    let response = router(state())
        .oneshot(post_json(
            "/api/app-tools/result",
            json!({"call_id": "gone", "ok": true, "content": "late"}),
        ))
        .await
        .expect("a response");

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_malformed_result_is_rejected_rather_than_swallowed() {
    let response = router(state())
        .oneshot(post_json("/api/app-tools/result", json!({"call_id": "no-ok-field"})))
        .await
        .expect("a response");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
