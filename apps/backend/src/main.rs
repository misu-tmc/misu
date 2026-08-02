mod admin;
mod auth;
mod config;
mod db;
mod error;
mod handlers;
mod meetings;
mod models;

use axum::{
    extract::FromRef,
    routing::{get, post, put},
    Router,
};
use sqlx::MySqlPool;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub config: Arc<Config>,
}

impl FromRef<AppState> for MySqlPool {
    fn from_ref(state: &AppState) -> MySqlPool {
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
        .route("/api/auth/wechat", post(auth::auth_wechat))
        .route("/api/auth/login", post(auth::auth_login))
        .route("/api/auth/logout", post(auth::auth_logout))
        .route("/api/auth/me", get(auth::auth_me))
        .route(
            "/api/auth/device/register",
            post(auth::auth_device_register),
        )
        .route(
            "/api/auth/device/challenge",
            post(auth::auth_device_challenge),
        )
        .route("/api/auth/device/verify", post(auth::auth_device_verify))
        .route(
            "/api/auth/device/migration-code",
            post(auth::auth_device_migration_code),
        )
        .route("/api/auth/device/migrate", post(auth::auth_device_migrate))
        .route("/api/meetings/upcoming", get(handlers::meetings_upcoming))
        .route("/api/meetings/:meeting_id", get(handlers::meeting_detail))
        // Mini program editor: per-section batch saves.
        .route(
            "/api/meetings/:meeting_id/info",
            put(admin::update_meeting_info),
        )
        .route("/api/meetings/:meeting_id/slots", put(admin::put_slots))
        .route(
            "/api/meetings/:meeting_id/sessions",
            put(admin::put_sessions),
        )
        .route(
            "/api/meetings/:meeting_id/status",
            put(admin::update_status),
        )
        .route(
            "/api/meetings/:meeting_id/table-topics",
            put(admin::put_table_topics),
        )
        .route(
            "/api/meetings/:meeting_id/speech",
            put(handlers::update_speech),
        )
        .route(
            "/api/meetings/:meeting_id/checkin",
            get(handlers::checkin_status).post(handlers::checkin),
        )
        .route(
            "/api/meetings/:meeting_id/attendees",
            get(admin::list_attendees).post(admin::create_walk_in),
        )
        .route(
            "/api/meetings/:meeting_id/vote",
            get(handlers::vote_state).post(handlers::submit_votes),
        )
        .route(
            "/api/meetings/:meeting_id/vote/result",
            get(handlers::vote_result),
        )
        .route("/api/book", post(handlers::book))
        .route("/api/users/:user_id", post(handlers::update_user))
        .route("/api/club-info", get(handlers::club_info))
        .route("/static/*path", get(admin::static_asset))
        .route("/sw.js", get(admin::spa_service_worker))
        .route("/manifest.webmanifest", get(admin::spa_manifest))
        // SPA: serve index.html for all /app/* navigation paths, and raw files for assets.
        .route("/app", get(admin::spa_index))
        .route("/app/", get(admin::spa_index))
        .route("/app/*path", get(admin::spa_asset))
        .route(
            "/",
            get(|| async { axum::response::Redirect::to("/app/booking") }),
        )
        // Login is part of the SPA. Legacy management URLs redirect to SPA equivalents.
        .route("/login", get(admin::page_login))
        .route(
            "/meetings",
            get(|| async { axum::response::Redirect::to("/app/meeting") }),
        )
        .route(
            "/meetings/new",
            get(|| async { axum::response::Redirect::to("/app/meetings/new") }),
        )
        .route("/meetings/:meeting_id/edit", get(admin::redirect_editor))
        .route(
            "/meetings/:meeting_id/agenda",
            get(admin::page_agenda_print),
        )
        .route(
            "/users",
            get(|| async { axum::response::Redirect::to("/app/misu/users") }),
        )
        // Management JSON APIs (require an authenticated session).
        .route(
            "/api/meetings",
            get(admin::list_meetings).post(admin::upsert_meeting),
        )
        .route(
            "/api/roles",
            get(admin::list_roles).post(admin::create_role),
        )
        .route(
            "/api/venues",
            get(admin::list_venues).post(admin::create_venue),
        )
        .route("/api/templates", get(admin::list_templates))
        .route(
            "/api/users",
            get(admin::list_users).post(admin::create_user),
        )
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
