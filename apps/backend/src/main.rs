mod admin;
mod auth;
mod config;
mod db;
mod error;
mod handlers;

use axum::{
    extract::FromRef,
    routing::{get, post},
    Router,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
}

impl FromRef<AppState> for SqlitePool {
    fn from_ref(state: &AppState) -> SqlitePool {
        state.pool.clone()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,misu_backend=debug".into()),
        )
        .init();

    let config = Config::from_env();
    if config.dev_mode() {
        tracing::warn!(
            "running in DEV auth mode (MISU_DEV_MODE): login code is treated as a fake openid — never enable in production"
        );
    }

    let pool = db::connect(&config).await?;
    let bind = config.bind.clone();
    let state = AppState {
        pool,
        config: Arc::new(config),
    };

    let app = Router::new()
        .route("/healthz", get(handlers::healthz))
        .route("/api/auth/wechat", post(handlers::auth_wechat))
        .route("/api/auth/login", post(handlers::auth_login))
        .route("/api/auth/logout", post(handlers::auth_logout))
        .route("/api/meetings/upcoming", get(handlers::meetings_upcoming))
        .route("/api/meetings/:meeting_id", get(handlers::meeting_detail))
        .route("/api/book", post(handlers::book))
        .route("/api/users/:user_id", post(handlers::update_user))
        .route("/api/club-info", get(handlers::club_info))
        // Web admin pages (require a web session; redirect to /login otherwise).
        .route("/login", get(admin::page_login))
        .route("/meetings", get(admin::page_meetings))
        .route("/meetings/new", get(admin::page_editor))
        .route("/meetings/:meeting_id/edit", get(admin::page_editor))
        .route("/users", get(admin::page_users))
        // Admin-scoped JSON APIs (require `site_admin`).
        .route("/api/meetings", get(admin::list_meetings).post(admin::upsert_meeting))
        .route("/api/roles", get(admin::list_roles).post(admin::create_role))
        .route("/api/users", get(admin::list_users).post(admin::create_user))
        .route("/api/users/:user_id/permissions", post(admin::set_permission))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("MISU backend listening on http://{bind}");
    axum::serve(listener, app).await?;
    Ok(())
}
