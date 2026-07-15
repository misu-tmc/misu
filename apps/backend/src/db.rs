use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

use crate::config::Config;

/// Full schema. Base tables are the source of truth (see design/storage/schema.md).
/// Note: the agenda "sessions" table is named `session`; the auth session table is
/// named `auth_session` to avoid the clash.
const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL
);

-- WeChat identity attaches to a user but stays out of the thin `user` table.
CREATE TABLE IF NOT EXISTS wechat_identity (
    openid  TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES user(id)
);

-- Username/password identity for the web surface. Another pluggable provider; the
-- password is stored only as a bcrypt hash, never in cleartext.
CREATE TABLE IF NOT EXISTS web_credential (
    username      TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES user(id),
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_session (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES user(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_permission (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES user(id),
    permission TEXT NOT NULL,
    granted_by INTEGER REFERENCES user(id),
    granted_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS meeting (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    number          INTEGER NOT NULL,
    title           TEXT NOT NULL,
    theme           TEXT NOT NULL DEFAULT '',
    keyword         TEXT NOT NULL DEFAULT '',
    date            TEXT NOT NULL,
    start_time      TEXT NOT NULL,
    end_time        TEXT NOT NULL DEFAULT '',
    venue           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft',
    is_template     INTEGER NOT NULL DEFAULT 0,
    meeting_manager INTEGER REFERENCES user(id)
);

CREATE TABLE IF NOT EXISTS role (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    properties TEXT
);

-- A concrete bookable seat in a meeting. User-agnostic: bookings live in role_assignment.
CREATE TABLE IF NOT EXISTS role_slot (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id  INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
    role_id     INTEGER NOT NULL REFERENCES role(id),
    label       TEXT,
    is_optional INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id       INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
    position         INTEGER NOT NULL,
    group_label      TEXT NOT NULL DEFAULT '',
    name             TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    role_slot_id     INTEGER REFERENCES role_slot(id)
);

-- Who fills a slot. The only meeting-related table that references a user.
CREATE TABLE IF NOT EXISTS role_assignment (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    role_slot_id INTEGER NOT NULL UNIQUE REFERENCES role_slot(id) ON DELETE CASCADE,
    booker_id    INTEGER REFERENCES user(id),
    taker_id     INTEGER REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_role_slot_meeting ON role_slot(meeting_id);
CREATE INDEX IF NOT EXISTS idx_session_meeting ON session(meeting_id);
"#;

pub async fn connect(config: &Config) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(&config.db_url)
        .context("invalid database url")?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("failed to open sqlite database")?;

    sqlx::query(SCHEMA)
        .execute(&pool)
        .await
        .context("failed to apply schema")?;

    migrate(&pool).await?;
    seed(&pool, config).await?;
    Ok(pool)
}

/// Idempotent column additions for databases created before these columns existed.
async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    for stmt in [
        "ALTER TABLE role_slot ADD COLUMN label TEXT",
        "ALTER TABLE role_slot ADD COLUMN is_optional INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE meeting ADD COLUMN theme TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE meeting ADD COLUMN keyword TEXT NOT NULL DEFAULT ''",
    ] {
        if let Err(e) = sqlx::query(stmt).execute(pool).await {
            // The column already exists on an up-to-date database; anything else is fatal.
            if !e.to_string().contains("duplicate column name") {
                return Err(e).context("migration failed");
            }
        }
    }
    Ok(())
}

/// Seed the role catalog and, in an empty database, a couple of sample meetings so
/// the mini program has something to show on first run.
async fn seed(pool: &SqlitePool, config: &Config) -> anyhow::Result<()> {
    let roles = [
        "TMOD",
        "Speaker",
        "Evaluator",
        "Table Topics Master",
        "Timer",
        "Ah-Counter",
        "Grammarian",
        "General Evaluator",
    ];
    for name in roles {
        sqlx::query("INSERT OR IGNORE INTO role(name) VALUES (?)")
            .bind(name)
            .execute(pool)
            .await?;
    }

    // Grant site_admin to the configured bootstrap openid if that user already exists.
    if let Some(openid) = &config.seed_admin_openid {
        if let Some(user_id) = sqlx::query_scalar::<_, i64>(
            "SELECT user_id FROM wechat_identity WHERE openid = ?",
        )
        .bind(openid)
        .fetch_optional(pool)
        .await?
        {
            grant_site_admin(pool, user_id).await?;
        }
    }

    seed_web_admin(pool, config).await?;

    let meeting_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting")
        .fetch_one(pool)
        .await?;
    if meeting_count == 0 {
        seed_sample_meetings(pool).await?;
    }

    Ok(())
}

/// Bootstrap a `site_admin` web user (username/password) so the admin surface is
/// reachable. Uses the configured credentials, or falls back to `admin`/`admin` in DEV
/// mode. No-op if the username already has a credential.
async fn seed_web_admin(pool: &SqlitePool, config: &Config) -> anyhow::Result<()> {
    let (username, password, explicit) = match (
        &config.seed_web_admin_user,
        &config.seed_web_admin_password,
    ) {
        (Some(u), Some(p)) => (u.clone(), p.clone(), true),
        _ if config.dev_mode() => {
            tracing::warn!(
                "seeding DEV web admin admin/admin (set MISU_WEB_ADMIN_USER/PASSWORD to override)"
            );
            ("admin".to_string(), "admin".to_string(), false)
        }
        _ => return Ok(()),
    };

    if crate::auth::web_username_exists(pool, &username).await? {
        // When credentials are explicitly configured (production), keep the stored
        // password in sync with `.env` so rotating MISU_WEB_ADMIN_PASSWORD takes effect
        // on the next startup. The DEV fallback (admin/admin) stays insert-only.
        if explicit {
            crate::auth::set_web_password(pool, &username, &password).await?;
            tracing::info!("updated web admin '{username}' password from configured credentials");
        }
        return Ok(());
    }
    let user_id = crate::auth::create_web_user(pool, &username, &password, "Site Admin").await?;
    grant_site_admin(pool, user_id).await?;
    tracing::info!("created web admin user '{username}' (site_admin)");
    Ok(())
}

pub async fn grant_site_admin(pool: &SqlitePool, user_id: i64) -> anyhow::Result<()> {
    let already: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_permission \
         WHERE user_id = ? AND permission = 'site_admin' AND revoked_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    if already == 0 {
        sqlx::query(
            "INSERT INTO user_permission(user_id, permission, granted_by, granted_at) \
             VALUES (?, 'site_admin', ?, ?)",
        )
        .bind(user_id)
        .bind(user_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn role_id(pool: &SqlitePool, name: &str) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>("SELECT id FROM role WHERE name = ?")
        .bind(name)
        .fetch_one(pool)
        .await?)
}

async fn seed_sample_meetings(pool: &SqlitePool) -> anyhow::Result<()> {
    // Two upcoming published meetings so Booking / Meeting tabs are populated.
    let today = chrono::Local::now().date_naive();
    let m1_date = (today + chrono::Duration::days(3)).to_string();
    let m2_date = (today + chrono::Duration::days(17)).to_string();

    seed_one_meeting(pool, 142, "Regular Meeting #142", "Embrace Change", &m1_date).await?;
    seed_one_meeting(pool, 143, "Regular Meeting #143", "New Horizons", &m2_date).await?;
    Ok(())
}

async fn seed_one_meeting(
    pool: &SqlitePool,
    number: i64,
    title: &str,
    theme: &str,
    date: &str,
) -> anyhow::Result<()> {
    let meeting_id: i64 = sqlx::query_scalar(
        "INSERT INTO meeting(number, title, theme, date, start_time, end_time, venue, status, is_template) \
         VALUES (?, ?, ?, ?, '19:00', '21:00', 'Room A', 'published', 0) RETURNING id",
    )
    .bind(number)
    .bind(title)
    .bind(theme)
    .bind(date)
    .fetch_one(pool)
    .await?;

    // Role slots for the meeting (user-agnostic bookable seats).
    let tmod = insert_slot(pool, meeting_id, "TMOD").await?;
    let sp1 = insert_slot(pool, meeting_id, "Speaker").await?;
    let ev1 = insert_slot(pool, meeting_id, "Evaluator").await?;
    let ttm = insert_slot(pool, meeting_id, "Table Topics Master").await?;
    let timer = insert_slot(pool, meeting_id, "Timer").await?;

    // Sessions (agenda). Start times are computed by clients from durations + buffer.
    let sessions: [(i64, &str, &str, i64, Option<i64>); 5] = [
        (1, "Opening", "Opening / TMOD", 6, Some(tmod)),
        (2, "Prepared Speeches", "Speech 1", 7, Some(sp1)),
        (3, "Prepared Speeches", "Evaluation 1", 3, Some(ev1)),
        (4, "Table Topics", "Table Topics", 20, Some(ttm)),
        (5, "Closing", "Timer's Report & Closing", 5, Some(timer)),
    ];
    for (position, group_label, name, minutes, slot) in sessions {
        sqlx::query(
            "INSERT INTO session(meeting_id, position, group_label, name, duration_minutes, role_slot_id) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(position)
        .bind(group_label)
        .bind(name)
        .bind(minutes)
        .bind(slot)
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn insert_slot(
    pool: &SqlitePool,
    meeting_id: i64,
    role_name: &str,
) -> anyhow::Result<i64> {
    let rid = role_id(pool, role_name).await?;
    Ok(sqlx::query_scalar::<_, i64>(
        "INSERT INTO role_slot(meeting_id, role_id) VALUES (?, ?) RETURNING id",
    )
    .bind(meeting_id)
    .bind(rid)
    .fetch_one(pool)
    .await?)
}
