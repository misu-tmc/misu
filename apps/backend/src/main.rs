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
            "running in DEV auth mode (no WECHAT_APPID/WECHAT_SECRET): login code is treated as a fake openid"
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
        .route("/api/meetings/upcoming", get(handlers::meetings_upcoming))
        .route("/api/meetings/:meeting_id", get(handlers::meeting_detail))
        .route("/api/book", post(handlers::book))
        .route("/api/users/:user_id", post(handlers::update_user))
        .route("/api/club-info", get(handlers::club_info))
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
