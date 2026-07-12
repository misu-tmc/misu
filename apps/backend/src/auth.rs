use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::error::AppError;

/// The authenticated caller, resolved from the `Authorization: Bearer <token>` header.
/// Every protected handler takes this extractor; the acting user is therefore always
/// taken from the session, never from the request body.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: i64,
    #[allow(dead_code)]
    pub display_name: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    SqlitePool: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let pool = SqlitePool::from_ref(state);
        let token = bearer_token(parts).ok_or(AppError::Unauthorized)?;

        let row = sqlx::query_as::<_, (i64, String)>(
            "SELECT u.id, u.display_name FROM auth_session s \
             JOIN user u ON u.id = s.user_id WHERE s.token = ?",
        )
        .bind(&token)
        .fetch_optional(&pool)
        .await?;

        match row {
            Some((id, display_name)) => Ok(AuthUser { id, display_name }),
            None => Err(AppError::Unauthorized),
        }
    }
}

fn bearer_token(parts: &Parts) -> Option<String> {
    let header = parts.headers.get(axum::http::header::AUTHORIZATION)?;
    let value = header.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// Optional variant of [`AuthUser`]: resolves the caller if a valid session is present,
/// otherwise yields `None` instead of rejecting. Used where the web admin surface (still
/// unauthenticated for now) and the authenticated mini program share one endpoint.
pub struct MaybeAuthUser(pub Option<AuthUser>);

#[async_trait]
impl<S> FromRequestParts<S> for MaybeAuthUser
where
    SqlitePool: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(MaybeAuthUser(
            AuthUser::from_request_parts(parts, state).await.ok(),
        ))
    }
}

/// Resolve the WeChat `openid` for a login code. Uses jscode2session when credentials
/// are configured; otherwise (DEV mode) derives a stable fake openid from the code.
pub async fn resolve_openid(config: &Config, code: &str) -> Result<String, AppError> {
    if config.dev_mode() {
        return Ok(format!("dev-{code}"));
    }
    let appid = config.wechat_appid.as_ref().unwrap();
    let secret = config.wechat_secret.as_ref().unwrap();
    let url = format!(
        "https://api.weixin.qq.com/sns/jscode2session?appid={appid}&secret={secret}&js_code={code}&grant_type=authorization_code"
    );

    #[derive(Deserialize)]
    struct Code2Session {
        openid: Option<String>,
        errcode: Option<i64>,
        errmsg: Option<String>,
    }

    let resp: Code2Session = reqwest::get(&url).await?.json().await?;
    match resp.openid {
        Some(openid) if resp.errcode.unwrap_or(0) == 0 => Ok(openid),
        _ => Err(AppError::BadRequest(format!(
            "wechat login failed: {} ({})",
            resp.errmsg.unwrap_or_else(|| "unknown".into()),
            resp.errcode.unwrap_or(-1)
        ))),
    }
}

/// Look up the user for an openid, creating a thin user + identity row on first login.
/// Returns (user_id, display_name).
pub async fn upsert_wechat_user(
    pool: &SqlitePool,
    openid: &str,
) -> Result<(i64, String, bool), AppError> {
    if let Some((user_id, display_name)) = sqlx::query_as::<_, (i64, String)>(
        "SELECT u.id, u.display_name FROM wechat_identity w \
         JOIN user u ON u.id = w.user_id WHERE w.openid = ?",
    )
    .bind(openid)
    .fetch_optional(pool)
    .await?
    {
        return Ok((user_id, display_name, false));
    }

    let default_name = "微信用户".to_string();
    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO user(display_name) VALUES (?) RETURNING id")
            .bind(&default_name)
            .fetch_one(pool)
            .await?;
    sqlx::query("INSERT INTO wechat_identity(openid, user_id) VALUES (?, ?)")
        .bind(openid)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok((user_id, default_name, true))
}

/// Create a fresh opaque session token for a user.
pub async fn create_session(pool: &SqlitePool, user_id: i64) -> Result<String, AppError> {
    let token = uuid::Uuid::new_v4().simple().to_string();
    sqlx::query("INSERT INTO auth_session(token, user_id, created_at) VALUES (?, ?, ?)")
        .bind(&token)
        .bind(user_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await?;
    Ok(token)
}

/// Whether a user currently holds an active `site_admin` grant.
pub async fn is_site_admin(pool: &SqlitePool, user_id: i64) -> Result<bool, AppError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_permission \
         WHERE user_id = ? AND permission = 'site_admin' AND revoked_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(count > 0)
}
