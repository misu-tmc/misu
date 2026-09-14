use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, Request, State},
    http::request::Parts,
    http::{header::SET_COOKIE, HeaderMap, Method},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::MySqlPool;

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::models::UserResponse;
use crate::AppState;

/// The authenticated caller, resolved from the `Authorization: Bearer <token>` header.
/// Every protected handler takes this extractor; the acting user is therefore always
/// taken from the session, never from the request body.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: i64,
    #[allow(dead_code)]
    pub display_name: String,
    pub club_name: Option<String>,
    pub email: Option<String>,
    pub role: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    MySqlPool: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if let Some(user) = parts.extensions.get::<AuthUser>() {
            return Ok(user.clone());
        }
        let pool = MySqlPool::from_ref(state);
        let token = session_token(parts).ok_or(AppError::Unauthorized)?;

        let row = sqlx::query_as::<_, UserResponse>(
            "SELECT u.id, u.display_name, u.club_name, u.email, u.role FROM auth_session s \
             JOIN user u ON u.id = s.user_id WHERE s.token = ?",
        )
        .bind(&token)
        .fetch_optional(&pool)
        .await?;

        match row {
            Some(user) => Ok(AuthUser {
                id: user.id,
                display_name: user.display_name,
                club_name: user.club_name,
                email: user.email,
                role: user.role,
            }),
            None => Err(AppError::Unauthorized),
        }
    }
}

impl From<AuthUser> for UserResponse {
    fn from(user: AuthUser) -> Self {
        Self {
            id: user.id,
            display_name: user.display_name,
            club_name: user.club_name,
            email: user.email,
            role: user.role,
        }
    }
}

fn requires_editor(method: &Method, path: &str) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
        && !path.starts_with("/api/auth/")
}

fn ensure_editor(role: &str) -> AppResult<()> {
    if role == "editor" {
        Ok(())
    } else {
        Err(AppError::Forbidden("guest accounts are read-only".into()))
    }
}

/// Default-deny all non-auth writes, including any future content routes.
pub async fn content_write_guard(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> AppResult<Response> {
    if !requires_editor(request.method(), request.uri().path()) {
        return Ok(next.run(request).await);
    }
    let (mut parts, body) = request.into_parts();
    let user = AuthUser::from_request_parts(&mut parts, &state).await?;
    ensure_editor(&user.role)?;
    parts.extensions.insert(user);
    Ok(next.run(Request::from_parts(parts, body)).await)
}

// ---------------------------------------------------------------------------
// Shared field normalization
// ---------------------------------------------------------------------------

/// Trim a required text field and enforce the 1..=255 Unicode-character bound shared by
/// `display_name` and similar fields. `label` names the field in the error message.
pub(crate) fn normalize_required_field(value: &str, label: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 255 {
        return Err(AppError::BadRequest(format!(
            "{label} must contain 1 to 255 characters"
        )));
    }
    Ok(trimmed.to_string())
}

/// Trim an optional text field, mapping a missing or blank value to `None`, and enforce
/// the 255-Unicode-character upper bound shared by `club_name` and similar fields.
pub(crate) fn normalize_optional_field(
    value: Option<&str>,
    label: &str,
) -> Result<Option<String>, AppError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.chars().count() > 255 {
        return Err(AppError::BadRequest(format!(
            "{label} must contain at most 255 characters"
        )));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
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
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
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

#[derive(Deserialize)]
pub struct WechatLoginReq {
    pub code: String,
}

#[derive(Serialize)]
pub struct LoginResp {
    pub token: String,
    pub user: UserResponse,
}

pub async fn auth_wechat(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Json(req): Json<WechatLoginReq>,
) -> AppResult<Response> {
    if req.code.trim().is_empty() {
        return Err(AppError::BadRequest("missing code".into()));
    }
    // callContainer's private protocol injects a gateway-authenticated OpenID. Direct
    // HTTP/local requests do not have it and retain the jscode2session fallback.
    let openid = match state
        .config
        .trust_wechat_gateway
        .then(|| cloud_openid(&headers))
        .flatten()
    {
        Some(openid) => openid,
        None => resolve_openid(&state.config, req.code.trim()).await?,
    };
    let user_id =
        sqlx::query_scalar::<_, i64>("SELECT user_id FROM wechat_identity WHERE openid = ?")
            .bind(openid)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| {
                AppError::Forbidden("register with email before linking WeChat".into())
            })?;
    login_response(&state, user_id).await
}

pub async fn auth_wechat_link(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Json(req): Json<WechatLoginReq>,
) -> AppResult<Response> {
    if user.email.is_none() {
        return Err(AppError::BadRequest(
            "link an email before linking WeChat".into(),
        ));
    }
    if req.code.trim().is_empty() {
        return Err(AppError::BadRequest("missing code".into()));
    }
    let openid = match state
        .config
        .trust_wechat_gateway
        .then(|| cloud_openid(&headers))
        .flatten()
    {
        Some(openid) => openid,
        None => resolve_openid(&state.config, req.code.trim()).await?,
    };
    let mut tx = state.pool.begin().await?;
    // Serialize links to this account; the OpenID primary key also excludes cross-account races.
    sqlx::query("SELECT id FROM user WHERE id = ? FOR UPDATE")
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
    let existing =
        sqlx::query_scalar::<_, String>("SELECT openid FROM wechat_identity WHERE user_id = ?")
            .bind(user.id)
            .fetch_optional(&mut *tx)
            .await?;
    if existing.is_some() {
        return Err(AppError::Conflict(
            "account already has a WeChat identity".into(),
        ));
    }
    sqlx::query("INSERT INTO wechat_identity(openid, user_id) VALUES (?, ?)")
        .bind(openid)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            crate::email_auth::credential_conflict(error, "WeChat identity already linked")
        })?;
    tx.commit().await?;
    login_response(&state, user.id).await
}

fn cloud_openid(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-wx-openid")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn secure_attr(secure: bool) -> &'static str {
    if secure {
        "; Secure"
    } else {
        ""
    }
}

fn session_cookie(token: &str, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000{}",
        secure_attr(secure)
    )
}

fn cleared_cookie(secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0{}",
        secure_attr(secure)
    )
}

#[cfg(test)]
mod tests {
    use super::{
        cleared_cookie, normalize_optional_field, normalize_required_field, session_cookie,
        MigrateDeviceReq,
    };

    #[test]
    fn content_write_policy_is_fail_closed() {
        use super::{ensure_editor, requires_editor};
        use axum::http::Method;

        for role in ["guest", "", "admin", "Editor", "unknown"] {
            assert!(ensure_editor(role).is_err());
        }
        assert!(ensure_editor("editor").is_ok());
        for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(requires_editor(&method, "/api/future-content"));
            assert!(requires_editor(&method, "/legacy-write"));
            assert!(!requires_editor(&method, "/api/auth/email/link"));
        }
        for method in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert!(!requires_editor(&method, "/api/meetings"));
        }
    }

    #[test]
    fn local_http_cookie_omits_secure_attribute() {
        let cookie = session_cookie("token", false);
        assert!(!cookie.contains("; Secure"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
    }

    #[test]
    fn production_cookie_requires_https() {
        assert!(session_cookie("token", true).contains("; Secure"));
        assert!(cleared_cookie(true).contains("; Secure"));
    }

    #[test]
    fn migration_request_accepts_spa_payload() {
        let request: MigrateDeviceReq = serde_json::from_value(serde_json::json!({
            "migration_code": "ABCD-EF01-2345-6789",
            "credential_id": "d23fc603-83f8-4efc-84d9-c03e3a4ad475",
            "public_key": "public-key",
            "device_name": "Safari on iPhone"
        }))
        .expect("SPA migration payload should deserialize");

        assert_eq!(request.migration_code, "ABCD-EF01-2345-6789");
    }

    #[test]
    fn optional_club_is_trimmed_or_cleared() {
        assert_eq!(
            normalize_optional_field(Some("  Other TMC  "), "club name").unwrap(),
            Some("Other TMC".into())
        );
        assert_eq!(
            normalize_optional_field(Some("   "), "club name").unwrap(),
            None
        );
        assert_eq!(normalize_optional_field(None, "club name").unwrap(), None);
        assert!(normalize_optional_field(Some(&"x".repeat(256)), "club name").is_err());
    }

    #[test]
    fn required_display_name_is_trimmed_and_bounded() {
        assert_eq!(
            normalize_required_field("  Ada Lovelace  ", "display name").unwrap(),
            "Ada Lovelace"
        );
        assert!(normalize_required_field("   ", "display name").is_err());
        assert!(normalize_required_field(&"x".repeat(256), "display name").is_err());
    }
}

pub async fn auth_logout(
    axum::extract::State(state): axum::extract::State<AppState>,
    SessionToken(token): SessionToken,
) -> AppResult<Response> {
    if let Some(token) = token {
        delete_session(&state.pool, &token).await?;
    }
    let mut resp = Json(json!({ "ok": true })).into_response();
    resp.headers_mut().insert(
        SET_COOKIE,
        cleared_cookie(state.config.secure_cookies())
            .parse()
            .unwrap(),
    );
    Ok(resp)
}

// ---------------------------------------------------------------------------
// Device-bound web provider
// ---------------------------------------------------------------------------

const DEVICE_CHALLENGE_MINUTES: i64 = 5;
const MIGRATION_CODE_MINUTES: i64 = 10;

#[derive(Serialize)]
pub struct CurrentUserResp {
    pub user: UserResponse,
}

/// Return the current web identity. The login page uses this before attempting a
/// device challenge because a valid HttpOnly session needs no additional work.
pub async fn auth_me(user: AuthUser) -> Json<CurrentUserResp> {
    Json(CurrentUserResp { user: user.into() })
}

#[derive(Deserialize)]
pub struct DeviceCredentialReq {
    pub credential_id: String,
    pub public_key: String,
    pub device_name: String,
}

#[derive(Deserialize)]
pub struct DeviceChallengeReq {
    pub credential_id: String,
}

#[derive(Serialize)]
pub struct DeviceChallengeResp {
    pub challenge_id: String,
    pub challenge: String,
    pub expires_at: String,
}

#[derive(Deserialize)]
pub struct DeviceVerifyReq {
    pub challenge_id: String,
    pub signature: String,
}

#[derive(Serialize)]
pub struct MigrationCodeResp {
    pub code: String,
    pub expires_at: String,
}

#[derive(Deserialize)]
pub struct MigrateDeviceReq {
    #[serde(alias = "code")]
    pub migration_code: String,
    #[serde(flatten)]
    pub credential: DeviceCredentialReq,
}

fn validated_credential_id(value: &str) -> Result<String, AppError> {
    uuid::Uuid::parse_str(value.trim())
        .map(|id| id.to_string())
        .map_err(|_| AppError::BadRequest("invalid credential id".into()))
}

fn validated_device_name(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 191 {
        return Err(AppError::BadRequest(
            "device name must contain 1 to 191 characters".into(),
        ));
    }
    Ok(value.to_string())
}

fn decode_public_key(value: &str) -> Result<Vec<u8>, AppError> {
    let bytes = BASE64
        .decode(value.trim())
        .map_err(|_| AppError::BadRequest("invalid device public key".into()))?;
    VerifyingKey::from_sec1_bytes(&bytes)
        .map_err(|_| AppError::BadRequest("invalid device public key".into()))?;
    Ok(bytes)
}

fn migration_code_hash(code: &str) -> String {
    format!("{:x}", Sha256::digest(code.as_bytes()))
}

fn normalize_migration_code(code: &str) -> Result<String, AppError> {
    let normalized: String = code
        .chars()
        .filter(|character| !character.is_ascii_whitespace() && *character != '-')
        .flat_map(char::to_uppercase)
        .collect();
    if normalized.len() != 16
        || !normalized
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::BadRequest("invalid migration code".into()));
    }
    Ok(normalized)
}

pub(crate) async fn login_response(state: &AppState, user_id: i64) -> AppResult<Response> {
    let user = sqlx::query_as::<_, UserResponse>(
        "SELECT id, display_name, club_name, email, role FROM user WHERE id = ?",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;
    let token = create_session(&state.pool, user_id).await?;
    let mut response = Json(LoginResp {
        token: token.clone(),
        user,
    })
    .into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        session_cookie(&token, state.config.secure_cookies())
            .parse()
            .unwrap(),
    );
    Ok(response)
}

pub async fn auth_device_register() -> AppResult<Response> {
    Err(AppError::Forbidden(
        "register with email instead of a device key".into(),
    ))
}

/// Start a one-time challenge for a known, non-revoked browser key.
pub async fn auth_device_challenge(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<DeviceChallengeReq>,
) -> AppResult<Json<DeviceChallengeResp>> {
    let credential_id = validated_credential_id(&req.credential_id)?;
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT user_id FROM device_credential WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(&credential_id)
    .fetch_optional(&state.pool)
    .await?;
    if exists.is_none() {
        return Err(AppError::Unauthorized);
    }

    sqlx::query("DELETE FROM device_auth_challenge WHERE expires_at <= UTC_TIMESTAMP(6)")
        .execute(&state.pool)
        .await?;

    let challenge_id = uuid::Uuid::new_v4().to_string();
    let challenge = uuid::Uuid::new_v4().simple().to_string();
    let expires_at = chrono::Utc::now() + chrono::Duration::minutes(DEVICE_CHALLENGE_MINUTES);
    sqlx::query(
        "INSERT INTO device_auth_challenge(id, credential_id, challenge, expires_at) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(&challenge_id)
    .bind(&credential_id)
    .bind(&challenge)
    .bind(expires_at.naive_utc())
    .execute(&state.pool)
    .await?;

    Ok(Json(DeviceChallengeResp {
        challenge_id,
        challenge,
        expires_at: expires_at.to_rfc3339(),
    }))
}

/// Verify the browser's ECDSA signature and establish the normal HttpOnly web session.
pub async fn auth_device_verify(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<DeviceVerifyReq>,
) -> AppResult<Response> {
    let challenge_id = uuid::Uuid::parse_str(req.challenge_id.trim())
        .map(|id| id.to_string())
        .map_err(|_| AppError::BadRequest("invalid challenge id".into()))?;
    let signature_bytes = BASE64
        .decode(req.signature.trim())
        .map_err(|_| AppError::Unauthorized)?;

    let mut transaction = state.pool.begin().await?;
    let row = sqlx::query_as::<_, (String, Vec<u8>, String, i64)>(
        "SELECT c.challenge, d.public_key, d.id, u.id \
         FROM device_auth_challenge c \
         JOIN device_credential d ON d.id = c.credential_id \
         JOIN user u ON u.id = d.user_id \
         WHERE c.id = ? AND c.consumed_at IS NULL AND c.expires_at > UTC_TIMESTAMP(6) \
           AND d.revoked_at IS NULL FOR UPDATE",
    )
    .bind(&challenge_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(AppError::Unauthorized)?;
    let (challenge, public_key, credential_id, user_id) = row;

    let verifying_key =
        VerifyingKey::from_sec1_bytes(&public_key).map_err(|_| AppError::Unauthorized)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| AppError::Unauthorized)?;
    verifying_key
        .verify(challenge.as_bytes(), &signature)
        .map_err(|_| AppError::Unauthorized)?;

    sqlx::query("UPDATE device_auth_challenge SET consumed_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(&challenge_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE device_credential SET last_used_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(&credential_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    login_response(&state, user_id).await
}

/// Issue a short-lived code from an authenticated device. Redeeming it adds, rather
/// than replaces, a credential so both devices can continue to sign in.
pub async fn auth_device_migration_code(
    axum::extract::State(state): axum::extract::State<AppState>,
    user: AuthUser,
) -> AppResult<Json<MigrationCodeResp>> {
    sqlx::query(
        "DELETE FROM device_migration_code \
         WHERE expires_at <= UTC_TIMESTAMP(6) OR consumed_at IS NOT NULL",
    )
    .execute(&state.pool)
    .await?;

    let normalized = uuid::Uuid::new_v4().simple().to_string()[..16].to_ascii_uppercase();
    let code = format!(
        "{}-{}-{}-{}",
        &normalized[0..4],
        &normalized[4..8],
        &normalized[8..12],
        &normalized[12..16]
    );
    let expires_at = chrono::Utc::now() + chrono::Duration::minutes(MIGRATION_CODE_MINUTES);
    sqlx::query(
        "INSERT INTO device_migration_code(code_hash, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(migration_code_hash(&normalized))
    .bind(user.id)
    .bind(expires_at.naive_utc())
    .execute(&state.pool)
    .await?;

    Ok(Json(MigrationCodeResp {
        code,
        expires_at: expires_at.to_rfc3339(),
    }))
}

/// Consume a migration code and bind a newly generated key to the code owner's account.
pub async fn auth_device_migrate(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<MigrateDeviceReq>,
) -> AppResult<Response> {
    let normalized_code = normalize_migration_code(&req.migration_code)?;
    let code_hash = migration_code_hash(&normalized_code);
    let credential_id = validated_credential_id(&req.credential.credential_id)?;
    let device_name = validated_device_name(&req.credential.device_name)?;
    let public_key = decode_public_key(&req.credential.public_key)?;

    let mut transaction = state.pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, i64>(
        "SELECT u.id FROM device_migration_code m \
         JOIN user u ON u.id = m.user_id \
         WHERE m.code_hash = ? AND m.consumed_at IS NULL \
           AND m.expires_at > UTC_TIMESTAMP(6) FOR UPDATE",
    )
    .bind(&code_hash)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::BadRequest("invalid or expired migration code".into()))?;

    sqlx::query(
        "INSERT INTO device_credential(id, user_id, public_key, device_name) VALUES (?, ?, ?, ?)",
    )
    .bind(&credential_id)
    .bind(user_id)
    .bind(public_key)
    .bind(device_name)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE device_migration_code SET consumed_at = UTC_TIMESTAMP(6) WHERE code_hash = ?",
    )
    .bind(&code_hash)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    login_response(&state, user_id).await
}

/// Delete a session by its token (logout).
pub async fn delete_session(pool: &MySqlPool, token: &str) -> Result<(), AppError> {
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
    #[derive(Deserialize)]
    struct Code2Session {
        openid: Option<String>,
        errcode: Option<i64>,
        errmsg: Option<String>,
    }

    // Build the query through reqwest and deliberately sanitize transport/decoding
    // errors: reqwest error values retain the request URL, whose query contains the
    // app secret and must never be written to logs.
    let response = reqwest::Client::new()
        .get("https://api.weixin.qq.com/sns/jscode2session")
        .query(&[
            ("appid", appid.as_str()),
            ("secret", secret.as_str()),
            ("js_code", code),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| sanitized_wechat_error("request", &error))?;
    let resp: Code2Session = response
        .json()
        .await
        .map_err(|error| sanitized_wechat_error("response decoding", &error))?;
    match resp.openid {
        Some(openid) if resp.errcode.unwrap_or(0) == 0 => Ok(openid),
        _ => Err(AppError::BadRequest(format!(
            "wechat login failed: {} ({})",
            resp.errmsg.unwrap_or_else(|| "unknown".into()),
            resp.errcode.unwrap_or(-1)
        ))),
    }
}

fn sanitized_wechat_error(operation: &str, error: &reqwest::Error) -> AppError {
    let reason = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connection error"
    } else if error.is_decode() {
        "invalid response"
    } else {
        "HTTP client error"
    };
    AppError::Internal(anyhow::anyhow!(
        "wechat jscode2session {operation} failed: {reason}"
    ))
}

/// Create a fresh opaque session token for a user.
pub async fn create_session(pool: &MySqlPool, user_id: i64) -> Result<String, AppError> {
    let token = uuid::Uuid::new_v4().simple().to_string();
    sqlx::query("INSERT INTO auth_session(token, user_id, created_at) VALUES (?, ?, ?)")
        .bind(&token)
        .bind(user_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await?;
    Ok(token)
}
