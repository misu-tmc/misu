use std::env;

/// Runtime configuration, loaded from environment variables (and `.env` if present).
#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub db_url: String,
    pub wechat_appid: Option<String>,
    pub wechat_secret: Option<String>,
    /// Bootstrap web admin credentials (username/password). When set, a web admin user is
    /// created on startup if the username does not already exist.
    pub seed_web_admin_user: Option<String>,
    pub seed_web_admin_password: Option<String>,
    /// Directory holding the static web admin pages.
    pub web_dir: String,
    /// Directory holding static assets (logos, QR codes, print images).
    pub static_dir: String,
    /// Explicit DEV auth toggle (`MISU_DEV_MODE`). When on, WeChat `code` is treated as
    /// a fake openid and the fallback web admin is seeded. Never enable in production.
    dev_mode: bool,
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

impl Config {
    pub fn from_env() -> Self {
        let db_file = non_empty("MISU_DB").unwrap_or_else(|| "misu.sqlite".to_string());
        Config {
            bind: non_empty("MISU_BIND").unwrap_or_else(|| "127.0.0.1:8080".to_string()),
            // create_if_missing is set on the connect options, so a plain path is fine.
            db_url: format!("sqlite://{db_file}"),
            wechat_appid: non_empty("WECHAT_APPID"),
            wechat_secret: non_empty("WECHAT_SECRET"),
            seed_web_admin_user: non_empty("MISU_WEB_ADMIN_USER"),
            seed_web_admin_password: non_empty("MISU_WEB_ADMIN_PASSWORD"),
            web_dir: non_empty("MISU_WEB_DIR").unwrap_or_else(|| "web".to_string()),
            static_dir: non_empty("MISU_STATIC_DIR").unwrap_or_else(|| "static".to_string()),
            dev_mode: env_bool("MISU_DEV_MODE"),
        }
    }

    /// DEV mode is on when `MISU_DEV_MODE` is set to a truthy value. In DEV mode the
    /// login `code` is treated as a stable fake openid, so the flow is testable
    /// without a real WeChat backend. It is an explicit opt-in and never inferred.
    pub fn dev_mode(&self) -> bool {
        self.dev_mode
    }
}
