use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_local_mode_skips_auth() {
    let db = fool_db::init_database_memory().await.unwrap();
    let config = fool_app::AppConfig {
        local: true,
        ..Default::default()
    };
    let services = fool_app::AppServices::from_config(db, &config).await.unwrap();

    let router = fool_app::create_router(&services).await.expect("build router");

    // Health check should work
    let response = router
        .clone()
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // An authenticated endpoint should work WITHOUT a token in local mode
    let response = router
        .oneshot(Request::builder().uri("/api/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_ne!(response.status(), StatusCode::FORBIDDEN);

    services.database.close().await;
}

#[tokio::test]
async fn test_non_local_mode_requires_auth() {
    let db = fool_db::init_database_memory().await.unwrap();
    let services = fool_app::AppServices::from_config(db, &fool_app::AppConfig::default())
        .await
        .unwrap();

    let router = fool_app::create_router(&services).await.expect("build router");

    let response = router
        .oneshot(Request::builder().uri("/api/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "UNAUTHORIZED");

    services.database.close().await;
}

#[tokio::test]
async fn test_local_mode_pro_requires_session_and_allows_bootstrap_provision_without_csrf() {
    let db = fool_db::init_database_memory().await.unwrap();
    let config = fool_app::AppConfig {
        identity_mode: fool_app::IdentityMode::Pro,
        bootstrap_secret: Some("bootstrap-secret".to_string()),
        ..Default::default()
    };
    let services = fool_app::AppServices::from_config(db, &config).await.unwrap();
    let router = fool_app::create_router(&services).await.expect("build router");

    let business_response = router
        .clone()
        .oneshot(Request::builder().uri("/api/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(business_response.status(), StatusCode::UNAUTHORIZED);

    let provision_response = router
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/auth/internal/external-users/pro-app")
                .header("content-type", "application/json")
                .header("x-foolcore-bootstrap-secret", "bootstrap-secret")
                .body(Body::from(r#"{"user_type":"pro","username":"Pro App User"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(provision_response.status(), StatusCode::OK);
    let body = to_bytes(provision_response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["user_type"], "pro");
    assert_ne!(json["data"]["user_id"], "system_default_user");

    services.database.close().await;
}
