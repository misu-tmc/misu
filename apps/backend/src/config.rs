use std::env;

/// Runtime configuration, loaded from environment variables (and `.env` if present).
#[derive(Clone)]
pub struct Config {
    pub bind: String,
    pub db_host: String,
    pub db_port: u16,
    pub db_user: String,
    pub db_password: String,
    pub db_name: String,
    pub wechat_appid: Option<String>,
    pub wechat_secret: Option<String>,
    /// Directory holding static assets (logos, QR codes, print images).
    pub static_dir: String,
    /// Directory holding the standalone SPA files served under `/app`.
    pub spa_dir: String,
    /// Explicit DEV auth toggle (`MISU_DEV_MODE`). When on, WeChat `code` is treated as
    /// a fake openid. Never enable in production.
    dev_mode: bool,
    /// Whether web session cookies include the `Secure` attribute.
    secure_cookies: bool,
}

fn non_empty(key: &str) -> Option<String> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
        _ => None,
    }
}

/// Parse a boolean env var: `1`, `true`, `yes`, `on` (case-insensitive) are truthy.
fn env_bool(key: &str) -> bool {
    matches!(
        non_empty(key).map(|v| v.to_ascii_lowercase()).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn optional_env_bool(key: &str) -> Option<bool> {
    match non_empty(key)?.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

impl Config {
    pub fn from_env() -> Self {
        let dev_mode = env_bool("MISU_DEV_MODE");
        Config {
            bind: non_empty("MISU_BIND").unwrap_or_else(|| "0.0.0.0:8080".to_string()),
            db_host: non_empty("MISU_DB_HOST").unwrap_or_else(|| "127.0.0.1".to_string()),
            db_port: non_empty("MISU_DB_PORT")
                .and_then(|value| value.parse().ok())
                .unwrap_or(3306),
            db_user: non_empty("MISU_DB_USER").unwrap_or_else(|| "misu".to_string()),
            db_password: env::var("MISU_DB_PASSWORD").unwrap_or_default(),
            db_name: non_empty("MISU_DB_NAME").unwrap_or_else(|| "misu".to_string()),
            wechat_appid: non_empty("WECHAT_APPID"),
            wechat_secret: non_empty("WECHAT_SECRET"),
            static_dir: non_empty("MISU_STATIC_DIR").unwrap_or_else(|| "static".to_string()),
            spa_dir: non_empty("MISU_SPA_DIR").unwrap_or_else(|| "../spa/dist".to_string()),
            secure_cookies: optional_env_bool("MISU_COOKIE_SECURE").unwrap_or(!dev_mode),
            dev_mode,
        }
    }

    /// DEV mode is on when `MISU_DEV_MODE` is set to a truthy value. In DEV mode the
    /// login `code` is treated as a stable fake openid, so the flow is testable
    /// without a real WeChat backend. It is an explicit opt-in and never inferred.
    pub fn dev_mode(&self) -> bool {
        self.dev_mode
    }

    /// Production deployments must use secure cookies. Local plain-HTTP development can
    /// explicitly set `MISU_COOKIE_SECURE=0` without changing the authentication provider.
    pub fn secure_cookies(&self) -> bool {
        self.secure_cookies
    }
}
