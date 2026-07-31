#![allow(clippy::disallowed_types)]

use axum::extract::rejection::JsonRejection;
use axum::extract::{Json, Path, State};
use axum::routing::{get, patch, post};
use axum::{Extension, Router};
use fool_api_types::{
    ApiResponse, CreateKanbanCardRequest, CreateKanbanColumnRequest, KanbanBoardResponse, KanbanCardResponse,
    KanbanColumnResponse, UpdateKanbanCardRequest, UpdateKanbanColumnRequest,
};
use fool_auth::CurrentUser;
use fool_common::ApiError;

use crate::error::KanbanError;
use crate::state::KanbanRouterState;

pub fn kanban_routes(state: KanbanRouterState) -> Router {
    Router::new()
        .route("/api/projects/{project_id}/kanban", get(get_board))
        .route("/api/projects/{project_id}/kanban/columns", post(create_column))
        .route(
            "/api/projects/{project_id}/kanban/columns/{column_id}",
            patch(update_column).delete(delete_column),
        )
        .route("/api/projects/{project_id}/kanban/cards", post(create_card))
        .route(
            "/api/projects/{project_id}/kanban/cards/{card_id}",
            patch(update_card).delete(delete_card),
        )
        .with_state(state)
}

impl From<KanbanError> for ApiError {
    fn from(error: KanbanError) -> Self {
        match error {
            KanbanError::NotFound(what) => ApiError::NotFound(what),
            KanbanError::ColumnNotEmpty => {
                ApiError::Conflict("column still has cards; move or delete them first".into())
            }
            KanbanError::Internal(message) => ApiError::Internal(message),
        }
    }
}

async fn get_board(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<KanbanBoardResponse>>, ApiError> {
    let board = state.service.get_board(&user.id, &project_id).await?;
    Ok(Json(ApiResponse::ok(board)))
}

async fn create_column(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<CreateKanbanColumnRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<KanbanColumnResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let column = state.service.create_column(&user.id, &project_id, req).await?;
    Ok(Json(ApiResponse::ok(column)))
}

async fn update_column(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((_project_id, column_id)): Path<(String, String)>,
    body: Result<Json<UpdateKanbanColumnRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<KanbanColumnResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let column = state.service.update_column(&user.id, &column_id, req).await?;
    Ok(Json(ApiResponse::ok(column)))
}

async fn delete_column(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((_project_id, column_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<()>>, ApiError> {
    state.service.delete_column(&user.id, &column_id).await?;
    Ok(Json(ApiResponse::success()))
}

async fn create_card(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<CreateKanbanCardRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<KanbanCardResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let card = state.service.create_card(&user.id, &project_id, req).await?;
    Ok(Json(ApiResponse::ok(card)))
}

async fn update_card(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((_project_id, card_id)): Path<(String, String)>,
    body: Result<Json<UpdateKanbanCardRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<KanbanCardResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let card = state.service.update_card(&user.id, &card_id, req).await?;
    Ok(Json(ApiResponse::ok(card)))
}

async fn delete_card(
    State(state): State<KanbanRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((_project_id, card_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<()>>, ApiError> {
    state.service.delete_card(&user.id, &card_id).await?;
    Ok(Json(ApiResponse::success()))
}
