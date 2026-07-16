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
        let token = session_token(parts).ok_or(AppError::Unauthorized)?;

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

/// The name of the web session cookie.
pub const SESSION_COOKIE: &str = "misu_session";

/// Resolve the session token from either the `Authorization: Bearer` header (mini program)
/// or the `misu_session` cookie (web surface).
fn session_token(parts: &Parts) -> Option<String> {
    bearer_token(parts).or_else(|| cookie_value(parts, SESSION_COOKIE))
}

fn cookie_value(parts: &Parts, name: &str) -> Option<String> {
    let header = parts.headers.get(axum::http::header::COOKIE)?;
    let value = header.to_str().ok()?;
    for pair in value.split(';') {
        let pair = pair.trim();
        if let Some(rest) = pair.strip_prefix(name).and_then(|r| r.strip_prefix('=')) {
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    None
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

/// Extracts the raw session token (bearer or cookie) if present — used by logout.
pub struct SessionToken(pub Option<String>);

#[async_trait]
impl<S> FromRequestParts<S> for SessionToken
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(SessionToken(session_token(parts)))
    }
}

// ---------------------------------------------------------------------------
// Web (username/password) provider
// ---------------------------------------------------------------------------

/// Hash a plaintext password for storage.
pub fn hash_password(password: &str) -> Result<String, AppError> {
    bcrypt::hash(password, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("password hash failed: {e}")))
}

/// Verify a plaintext password against a stored bcrypt hash.
fn verify_password(password: &str, hash: &str) -> bool {
    bcrypt::verify(password, hash).unwrap_or(false)
}

/// Verify a web login. Returns `(user_id, display_name)` on success, `None` on any
/// mismatch (unknown username or wrong password — indistinguishable to the caller).
pub async fn verify_web_login(
    pool: &SqlitePool,
    username: &str,
    password: &str,
) -> Result<Option<(i64, String)>, AppError> {
    let row = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT u.id, u.display_name, c.password_hash FROM web_credential c \
         JOIN user u ON u.id = c.user_id WHERE c.username = ?",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    Ok(match row {
        Some((id, name, hash)) if verify_password(password, &hash) => Some((id, name)),
        _ => None,
    })
}

/// Create a web user with a username/password credential. Returns the new `user.id`.
pub async fn create_web_user(
    pool: &SqlitePool,
    username: &str,
    password: &str,
    display_name: &str,
) -> Result<i64, AppError> {
    let hash = hash_password(password)?;
    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO user(display_name) VALUES (?) RETURNING id")
            .bind(display_name)
            .fetch_one(pool)
            .await?;
    sqlx::query("INSERT INTO web_credential(username, user_id, password_hash) VALUES (?, ?, ?)")
        .bind(username)
        .bind(user_id)
        .bind(hash)
        .execute(pool)
        .await?;
    Ok(user_id)
}

/// Update the stored password for an existing web credential. Returns the credential's
/// `user.id`. Errors if no credential exists for the username.
pub async fn set_web_password(
    pool: &SqlitePool,
    username: &str,
    password: &str,
) -> Result<i64, AppError> {
    let hash = hash_password(password)?;
    let user_id: Option<i64> = sqlx::query_scalar(
        "UPDATE web_credential SET password_hash = ? WHERE username = ? RETURNING user_id",
    )
    .bind(hash)
    .bind(username)
    .fetch_optional(pool)
    .await?;
    user_id.ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!("web credential '{username}' not found"))
    })
}

/// Whether a web credential already exists for a username.
pub async fn web_username_exists(pool: &SqlitePool, username: &str) -> Result<bool, AppError> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM web_credential WHERE username = ?")
            .bind(username)
            .fetch_one(pool)
            .await?;
    Ok(count > 0)
}

/// Delete a session by its token (logout).
pub async fn delete_session(pool: &SqlitePool, token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM auth_session WHERE token = ?")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

/// Resolve the WeChat `openid` for a login code. Uses jscode2session when credentials
/// are configured; otherwise (DEV mode) derives a stable fake openid from the code.
pub async fn resolve_openid(config: &Config, code: &str) -> Result<String, AppError> {
    // Prefer the real jscode2session exchange whenever credentials are configured —
    // even in DEV — so DevTools yields a stable test openid. Only when appid/secret are
    // absent does DEV fall back to a single pinned fake identity.
    let (appid, secret) = match (config.wechat_appid.as_ref(), config.wechat_secret.as_ref()) {
        (Some(appid), Some(secret)) => (appid, secret),
        _ if config.dev_mode() => {
            // wx.login returns a fresh single-use code on every launch, so keying the
            // openid on the code would mint a new user each time and orphan the previous
            // session's bookings. Pin DEV to one account.
            let _ = code;
            return Ok("dev-user".to_string());
        }
        (None, _) => {
            return Err(AppError::Internal(anyhow::anyhow!(
                "WECHAT_APPID is not configured"
            )))
        }
        (_, None) => {
            return Err(AppError::Internal(anyhow::anyhow!(
                "WECHAT_SECRET is not configured"
            )))
        }
    };
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

    // WeChat no longer exposes real nicknames, so a new user starts nameless; the mini
    // program requires them to set one on first login.
    let default_name = String::new();
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
