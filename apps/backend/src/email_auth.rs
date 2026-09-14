use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::State, response::Response, Json};
use rand_core::OsRng;
use serde::Deserialize;
use tokio::sync::Semaphore;

use crate::{
    auth::{login_response, normalize_optional_field, normalize_required_field, AuthUser},
    error::{AppError, AppResult},
    AppState,
};

const WINDOW: Duration = Duration::from_secs(15 * 60);
const EMAIL_ATTEMPTS: usize = 10;
const GLOBAL_ATTEMPTS: usize = 300;
// Same algorithm/work factor as stored credentials, so unknown accounts also do a password check.
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$bWlzdS1lbWFpbC1kdW1teQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

pub struct EmailAuthState {
    attempts: Mutex<Attempts>,
    workers: Arc<Semaphore>,
}

impl Default for EmailAuthState {
    fn default() -> Self {
        Self {
            attempts: Mutex::new(Attempts::default()),
            workers: Arc::new(Semaphore::new(4)),
        }
    }
}

#[derive(Default)]
struct Attempts {
    emails: HashMap<String, (Instant, usize)>,
    global: Option<(Instant, usize)>,
}

impl Attempts {
    fn record(&mut self, email: &str, now: Instant) -> AppResult<()> {
        self.emails
            .retain(|_, (start, _)| now.duration_since(*start) < WINDOW);
        let global = self.global.get_or_insert((now, 0));
        if now.duration_since(global.0) >= WINDOW {
            *global = (now, 0);
        }
        if global.1 >= GLOBAL_ATTEMPTS {
            return Err(AppError::TooManyRequests);
        }
        let attempt = self.emails.entry(email.to_owned()).or_insert((now, 0));
        if attempt.1 >= EMAIL_ATTEMPTS {
            return Err(AppError::TooManyRequests);
        }
        global.1 += 1;
        attempt.1 += 1;
        Ok(())
    }
}

impl EmailAuthState {
    fn throttle(&self, email: &str) -> AppResult<()> {
        self.attempts
            .lock()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("authentication limiter unavailable")))?
            .record(email, Instant::now())
    }

    async fn password_work<T, F>(&self, work: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        // Do not let unauthenticated callers build an unbounded queue of memory-hard jobs.
        let permit = self
            .workers
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::TooManyRequests)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            work()
        })
        .await
        .map_err(|_| AppError::Internal(anyhow::anyhow!("password worker failed")))?
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailCredentials {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailRegisterReq {
    pub email: String,
    pub password: String,
    pub display_name: String,
    pub club_name: Option<String>,
}

/// ASCII dot-atom mailboxes with a DNS-style domain; quoted/Unicode mailboxes are unsupported.
fn normalize_email(value: &str) -> AppResult<String> {
    let email = value.trim().to_ascii_lowercase();
    let valid = email.len() <= 254
        && email.is_ascii()
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && local.len() <= 64
                && !local.starts_with('.')
                && !local.ends_with('.')
                && !local.contains("..")
                && local
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&c))
                && domain.contains('.')
                && domain.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                })
        });
    if !valid {
        return Err(AppError::BadRequest("invalid email address".into()));
    }
    Ok(email)
}

fn validate_password(password: &str) -> AppResult<()> {
    if password.len() > 512 || !(12..=128).contains(&password.chars().count()) {
        return Err(AppError::BadRequest(
            "password must contain 12 to 128 characters (at most 512 bytes)".into(),
        ));
    }
    Ok(())
}

fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("password hashing failed")))
}

fn password_matches(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).ok().is_some_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}

pub(crate) fn credential_conflict(error: sqlx::Error, message: &str) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        AppError::Conflict(message.into())
    } else {
        error.into()
    }
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<EmailRegisterReq>,
) -> AppResult<Response> {
    let email = normalize_email(&req.email)?;
    validate_password(&req.password)?;
    let display_name = normalize_required_field(&req.display_name, "display name")?;
    let club_name = normalize_optional_field(req.club_name.as_deref(), "club name")?;
    state.email_auth.throttle(&email)?;
    let password_hash = state
        .email_auth
        .password_work(move || hash_password(&req.password))
        .await?;
    let user_id = sqlx::query(
        "INSERT INTO user(display_name, club_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'guest')",
    )
    .bind(display_name)
    .bind(club_name)
    .bind(email)
    .bind(password_hash)
    .execute(&state.pool)
    .await
    .map_err(|error| credential_conflict(error, "email already registered"))?
    .last_insert_id() as i64;
    login_response(&state, user_id).await
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<EmailCredentials>,
) -> AppResult<Response> {
    let email = normalize_email(&req.email)?;
    validate_password(&req.password)?;
    state.email_auth.throttle(&email)?;
    let credential = sqlx::query_as::<_, (i64, String)>(
        "SELECT id, password_hash FROM user WHERE email = ? AND password_hash IS NOT NULL",
    )
    .bind(email)
    .fetch_optional(&state.pool)
    .await?;
    let user_id = credential.as_ref().map(|(id, _)| *id);
    let hash = credential
        .map(|(_, hash)| hash)
        .unwrap_or_else(|| DUMMY_HASH.into());
    let valid = state
        .email_auth
        .password_work(move || Ok(password_matches(&req.password, &hash)))
        .await?;
    if !valid {
        return Err(AppError::Unauthorized);
    }
    login_response(&state, user_id.ok_or(AppError::Unauthorized)?).await
}

pub async fn link(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<EmailCredentials>,
) -> AppResult<Response> {
    if user.email.is_some() {
        return Err(AppError::Conflict("account already has an email".into()));
    }
    let email = normalize_email(&req.email)?;
    validate_password(&req.password)?;
    state.email_auth.throttle(&email)?;
    let password_hash = state
        .email_auth
        .password_work(move || hash_password(&req.password))
        .await?;
    let result =
        sqlx::query("UPDATE user SET email = ?, password_hash = ? WHERE id = ? AND email IS NULL")
            .bind(email)
            .bind(password_hash)
            .bind(user.id)
            .execute(&state.pool)
            .await
            .map_err(|error| credential_conflict(error, "email already registered"))?;
    if result.rows_affected() != 1 {
        return Err(AppError::Conflict("account already has an email".into()));
    }
    login_response(&state, user.id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_is_normalized_and_validated() {
        assert_eq!(
            normalize_email("  Person+tag@EXAMPLE.COM ").unwrap(),
            "person+tag@example.com"
        );
        for invalid in [
            "",
            "no-at",
            "a@@example.com",
            "a@localhost",
            ".a@example.com",
            "a..b@example.com",
            "a.@example.com",
            "a b@example.com",
            "a@-example.com",
            "a@example..com",
            "a@example.com\nBcc:other@example.com",
            "你@example.com",
        ] {
            assert!(normalize_email(invalid).is_err(), "{invalid}");
        }
        assert!(normalize_email(&format!("{}@example.com", "a".repeat(65))).is_err());
    }

    #[test]
    fn password_bounds_and_roles_cannot_be_submitted() {
        assert!(validate_password("short").is_err());
        assert!(validate_password(&"x".repeat(129)).is_err());
        assert!(validate_password(&"🦀".repeat(128)).is_ok());
        assert!(serde_json::from_value::<EmailRegisterReq>(serde_json::json!({
            "email": "person@example.com", "password": "long password", "display_name": "Person",
            "role": "editor"
        })).is_err());
    }

    #[tokio::test]
    async fn argon2_hashes_are_salted_and_verified_off_runtime() {
        let state = EmailAuthState::default();
        let first = state
            .password_work(|| hash_password("correct horse battery"))
            .await
            .unwrap();
        let second = state
            .password_work(|| hash_password("correct horse battery"))
            .await
            .unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
        assert!(!first.contains("correct horse"));
        state
            .password_work(move || {
                assert!(password_matches("correct horse battery", &first));
                assert!(!password_matches("incorrect password", &first));
                assert!(!password_matches("incorrect password", DUMMY_HASH));
                assert!(PasswordHash::new(DUMMY_HASH).is_ok());
                Ok(())
            })
            .await
            .unwrap();
    }

    #[test]
    fn rate_limiter_bounds_accounts_and_global_work_then_expires() {
        let now = Instant::now();
        let mut attempts = Attempts::default();
        for _ in 0..EMAIL_ATTEMPTS {
            attempts.record("one@example.com", now).unwrap();
        }
        assert!(matches!(
            attempts.record("one@example.com", now),
            Err(AppError::TooManyRequests)
        ));
        for i in EMAIL_ATTEMPTS..GLOBAL_ATTEMPTS {
            attempts.record(&format!("{i}@example.com"), now).unwrap();
        }
        assert!(matches!(
            attempts.record("new@example.com", now),
            Err(AppError::TooManyRequests)
        ));
        attempts.record("one@example.com", now + WINDOW).unwrap();
        assert_eq!(attempts.emails.len(), 1);
    }

    #[tokio::test]
    async fn saturated_hash_workers_reject_instead_of_queueing() {
        let state = EmailAuthState::default();
        let _permits = state.workers.acquire_many(4).await.unwrap();
        assert!(matches!(
            state.password_work(|| Ok(())).await,
            Err(AppError::TooManyRequests)
        ));
    }
}
