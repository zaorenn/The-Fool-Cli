//! E2E tests for the project Kanban board routes.

mod common;

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use common::{body_json, build_app, delete_with_token, get_request, get_with_token, json_with_token, setup_and_login};

const PROJECT: &str = "project-e2e-1";

#[tokio::test]
async fn get_board_creates_the_default_columns_on_first_read() {
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "kanban-user-1", "password123").await;

    let resp = app
        .clone()
        .oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let columns = body["data"]["columns"].as_array().unwrap();
    assert_eq!(
        columns.iter().map(|c| c["name"].as_str().unwrap()).collect::<Vec<_>>(),
        vec!["To do", "Doing", "Done"]
    );
}

#[tokio::test]
async fn a_card_can_be_created_and_then_moved_between_columns() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "kanban-user-2", "password123").await;

    let board_resp = app
        .clone()
        .oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token))
        .await
        .unwrap();
    let board = body_json(board_resp).await;
    let todo_id = board["data"]["columns"][0]["column_id"].as_str().unwrap().to_owned();
    let doing_id = board["data"]["columns"][1]["column_id"].as_str().unwrap().to_owned();

    let create_resp = app
        .clone()
        .oneshot(json_with_token(
            "POST",
            &format!("/api/projects/{PROJECT}/kanban/cards"),
            json!({ "column_id": todo_id, "title": "Ship the installer", "body": "" }),
            &token,
            &csrf,
        ))
        .await
        .unwrap();
    assert_eq!(create_resp.status(), StatusCode::OK);
    let created = body_json(create_resp).await;
    let card_id = created["data"]["card_id"].as_str().unwrap().to_owned();
    assert_eq!(created["data"]["column_id"], todo_id);

    let move_resp = app
        .clone()
        .oneshot(json_with_token(
            "PATCH",
            &format!("/api/projects/{PROJECT}/kanban/cards/{card_id}"),
            json!({ "column_id": doing_id }),
            &token,
            &csrf,
        ))
        .await
        .unwrap();
    assert_eq!(move_resp.status(), StatusCode::OK);
    let moved = body_json(move_resp).await;
    assert_eq!(moved["data"]["column_id"], doing_id);

    let board_after = body_json(
        app.clone()
            .oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token))
            .await
            .unwrap(),
    )
    .await;
    let doing_cards = board_after["data"]["columns"][1]["cards"].as_array().unwrap();
    assert_eq!(doing_cards.len(), 1);
    assert_eq!(doing_cards[0]["card_id"], card_id);
}

#[tokio::test]
async fn deleting_a_column_that_still_has_cards_is_refused() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "kanban-user-3", "password123").await;

    let board = body_json(
        app.clone()
            .oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token))
            .await
            .unwrap(),
    )
    .await;
    let todo_id = board["data"]["columns"][0]["column_id"].as_str().unwrap().to_owned();

    app.clone()
        .oneshot(json_with_token(
            "POST",
            &format!("/api/projects/{PROJECT}/kanban/cards"),
            json!({ "column_id": todo_id, "title": "Blocking card", "body": "" }),
            &token,
            &csrf,
        ))
        .await
        .unwrap();

    let delete_resp = app
        .clone()
        .oneshot(delete_with_token(
            &format!("/api/projects/{PROJECT}/kanban/columns/{todo_id}"),
            &token,
            &csrf,
        ))
        .await
        .unwrap();
    assert_eq!(delete_resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn unauthenticated_request_is_rejected() {
    let (app, _services) = build_app().await;

    let resp = app
        .oneshot(get_request(&format!("/api/projects/{PROJECT}/kanban")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_write_without_the_csrf_header_is_rejected() {
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "kanban-user-4", "password123").await;

    // A bearer token alone, no `x-csrf-token` — the double-submit check must
    // still reject a state-changing request.
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/projects/{PROJECT}/kanban/columns"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(axum::body::Body::from(json!({ "name": "Blocked" }).to_string()))
        .unwrap();

    let resp = app.oneshot(request).await.unwrap();
    assert_ne!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn one_users_board_is_invisible_and_unwritable_to_another() {
    let (mut app, services) = build_app().await;
    let (token_a, csrf_a) = setup_and_login(&mut app, &services, "kanban-owner", "password123").await;
    let (token_b, csrf_b) = setup_and_login(&mut app, &services, "kanban-intruder", "password123").await;

    let board_a = body_json(
        app.clone()
            .oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token_a))
            .await
            .unwrap(),
    )
    .await;
    let todo_a = board_a["data"]["columns"][0]["column_id"].as_str().unwrap().to_owned();
    let card_a = body_json(
        app.clone()
            .oneshot(json_with_token(
                "POST",
                &format!("/api/projects/{PROJECT}/kanban/cards"),
                json!({ "column_id": todo_a, "title": "Owner's card", "body": "" }),
                &token_a,
                &csrf_a,
            ))
            .await
            .unwrap(),
    )
    .await;
    let card_id = card_a["data"]["card_id"].as_str().unwrap().to_owned();

    // User B's board for the "same" project id is its own, separately seeded
    // board — never Owner's — because kanban rows are scoped by `user_id`.
    let board_b = body_json(
        app.clone()
            .oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token_b))
            .await
            .unwrap(),
    )
    .await;
    let all_cards_b: Vec<_> = board_b["data"]["columns"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["cards"].as_array().unwrap().clone())
        .collect();
    assert!(
        all_cards_b.is_empty(),
        "user B must not see user A's cards: {all_cards_b:?}"
    );

    // Nor can user B act on user A's card by id.
    let forbidden_move = app
        .clone()
        .oneshot(json_with_token(
            "PATCH",
            &format!("/api/projects/{PROJECT}/kanban/cards/{card_id}"),
            json!({ "title": "Hijacked" }),
            &token_b,
            &csrf_b,
        ))
        .await
        .unwrap();
    assert_eq!(forbidden_move.status(), StatusCode::NOT_FOUND);

    // Owner's card is untouched.
    let board_a_after = body_json(
        app.oneshot(get_with_token(&format!("/api/projects/{PROJECT}/kanban"), &token_a))
            .await
            .unwrap(),
    )
    .await;
    let title = board_a_after["data"]["columns"][0]["cards"][0]["title"]
        .as_str()
        .unwrap();
    assert_eq!(title, "Owner's card");
}
