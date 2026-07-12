use std::env;

/// Runtime configuration, loaded from environment variables (and `.env` if present).
#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub db_url: String,
    pub wechat_appid: Option<String>,
    pub wechat_secret: Option<String>,
    pub seed_admin_openid: Option<String>,
    /// Bootstrap web admin credentials (username/password). When set, a `site_admin`
    /// web user is created on startup if the username does not already exist.
    pub seed_web_admin_user: Option<String>,
    pub seed_web_admin_password: Option<String>,
    /// Directory holding the static web admin pages.
    pub web_dir: String,
}

fn non_empty(key: &str) -> Option<String> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
        _ => None,
    }
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
            seed_admin_openid: non_empty("MISU_SEED_ADMIN_OPENID"),
            seed_web_admin_user: non_empty("MISU_WEB_ADMIN_USER"),
            seed_web_admin_password: non_empty("MISU_WEB_ADMIN_PASSWORD"),
            web_dir: non_empty("MISU_WEB_DIR").unwrap_or_else(|| "web".to_string()),
        }
    }

    /// DEV mode is on when WeChat credentials are not configured. In DEV mode the
    /// login `code` is treated as a stable fake openid, so the flow is testable
    /// without a real WeChat backend.
    pub fn dev_mode(&self) -> bool {
        self.wechat_appid.is_none() || self.wechat_secret.is_none()
    }
}
