use anyhow::Context;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlQueryResult};
use sqlx::MySqlPool;
use std::time::Duration;

use crate::config::Config;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect(config: &Config) -> anyhow::Result<MySqlPool> {
    if !config
        .db_name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        anyhow::bail!("MISU_DB_NAME may only contain ASCII letters, digits, and underscores");
    }

    let server_options = MySqlConnectOptions::new()
        .host(&config.db_host)
        .port(config.db_port)
        .username(&config.db_user)
        .password(&config.db_password);

    let server_pool = connect_with_retry(server_options).await?;
    let database_exists: Option<String> = sqlx::query_scalar(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    )
    .bind(&config.db_name)
    .fetch_optional(&server_pool)
    .await
    .context("failed to check whether the MySQL database exists")?;
    if database_exists.is_none() {
        sqlx::query(&format!(
            "CREATE DATABASE `{}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            config.db_name
        ))
        .execute(&server_pool)
        .await
        .with_context(|| format!("failed to create MySQL database '{}'; grant CREATE on `{}.*` to the application account", config.db_name, config.db_name))?;
        tracing::info!(database = %config.db_name, "created MySQL database");
    }
    server_pool.close().await;

    let database_options = MySqlConnectOptions::new()
        .host(&config.db_host)
        .port(config.db_port)
        .username(&config.db_user)
        .password(&config.db_password)
        .database(&config.db_name);
    let pool = connect_with_retry(database_options).await?;

    MIGRATOR
        .run(&pool)
        .await
        .context("failed to apply MySQL migrations")?;
    seed(&pool).await?;
    Ok(pool)
}

async fn connect_with_retry(options: MySqlConnectOptions) -> anyhow::Result<MySqlPool> {
    // Serverless MySQL can reject connections briefly while resuming. Retrying here
    // keeps a cold database from making the whole container fail its startup probe.
    let mut attempt = 0;
    loop {
        attempt += 1;
        match MySqlPoolOptions::new()
            .max_connections(5)
            // Keep at least one connection warm so requests don't pay the full
            // connect + `SET sql_mode` init round-trip (~1s on a remote DB) each time.
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(30))
            .idle_timeout(Duration::from_secs(600))
            .max_lifetime(Duration::from_secs(1800))
            // Skip the per-checkout COM_PING; it adds a full round-trip to every query.
            .test_before_acquire(false)
            .connect_with(options.clone())
            .await
        {
            Ok(pool) => return Ok(pool),
            Err(error) => {
                if attempt >= 12 {
                    return Err(error).context("failed to connect to MySQL after 12 attempts");
                }
                tracing::warn!(attempt, error = %error, "MySQL is not ready; retrying in 5 seconds");
            }
        }

        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

fn insert_id(result: MySqlQueryResult) -> anyhow::Result<i64> {
    i64::try_from(result.last_insert_id()).context("generated MySQL id exceeds i64")
}

/// Seed the role catalog and, in an empty database, a couple of sample meetings so
/// the mini program has something to show on first run.
async fn seed(pool: &MySqlPool) -> anyhow::Result<()> {
    let roles = [
        ("TOE", None),
        (
            "Speaker",
            Some(
                r#"[{"key":"title","type":"string"},{"key":"pathway","type":"string"},{"key":"level","type":"integer"},{"key":"purpose","type":"string"},{"key":"description","type":"string"}]"#,
            ),
        ),
        ("Individual Evaluator", None),
        ("Table Topics Master", None),
        ("Timer", None),
        ("Ah-Counter", None),
        ("Grammarian", None),
        ("General Evaluator", None),
    ];
    for (name, properties) in roles {
        sqlx::query("INSERT IGNORE INTO `role`(name, properties) VALUES (?, ?)")
            .bind(name)
            .bind(properties)
            .execute(pool)
            .await?;
        if let Some(properties) = properties {
            sqlx::query(
                "UPDATE `role` SET properties = ? WHERE name = ? AND TRIM(COALESCE(properties, '')) = ''",
            )
            .bind(properties)
            .bind(name)
            .execute(pool)
            .await?;
        }
    }
    sqlx::query(
        "UPDATE `role` SET properties = NULL WHERE name IN ('Grammarian', 'Table Topics Master')",
    )
    .execute(pool)
    .await?;

    let meeting_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting")
        .fetch_one(pool)
        .await?;
    if meeting_count == 0 {
        seed_sample_meetings(pool).await?;
    }

    Ok(())
}

async fn role_id(pool: &MySqlPool, name: &str) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT id FROM `role` WHERE name = ?")
            .bind(name)
            .fetch_one(pool)
            .await?,
    )
}

async fn seed_sample_meetings(pool: &MySqlPool) -> anyhow::Result<()> {
    // Two upcoming published meetings so Booking / Meeting tabs are populated.
    let today = chrono::Local::now().date_naive();
    let m1_date = (today + chrono::Duration::days(3)).to_string();
    let m2_date = (today + chrono::Duration::days(17)).to_string();

    seed_one_meeting(
        pool,
        142,
        "Regular Meeting #142",
        "Embrace Change",
        &m1_date,
    )
    .await?;
    seed_one_meeting(pool, 143, "Regular Meeting #143", "New Horizons", &m2_date).await?;
    Ok(())
}

async fn seed_one_meeting(
    pool: &MySqlPool,
    number: i64,
    title: &str,
    theme: &str,
    date: &str,
) -> anyhow::Result<()> {
    let venue_id = ensure_venue(pool, "Room A").await?;
    let meeting_id = insert_id(sqlx::query(
        "INSERT INTO meeting(number, title, theme, date, start_time, end_time, venue_id, status) \
            VALUES (?, ?, ?, ?, '19:00', '21:00', ?, 'published')",
    )
    .bind(number)
    .bind(title)
    .bind(theme)
    .bind(date)
    .bind(venue_id)
    .execute(pool)
    .await?)?;

    // Role slots for the meeting (user-agnostic bookable seats).
    let toe = insert_slot(pool, meeting_id, "TOE").await?;
    let sp1 = insert_slot(pool, meeting_id, "Speaker").await?;
    let ev1 = insert_slot(pool, meeting_id, "Individual Evaluator").await?;
    let ttm = insert_slot(pool, meeting_id, "Table Topics Master").await?;
    let timer = insert_slot(pool, meeting_id, "Timer").await?;

    // Sessions (agenda). Start times are computed by clients from durations + buffer.
    let sessions: [(i64, &str, &str, i64, Option<i64>); 5] = [
        (1, "Opening", "Opening / TOE", 6, Some(toe)),
        (2, "Prepared Speeches", "Speech 1", 7, Some(sp1)),
        (3, "Prepared Speeches", "Evaluation 1", 3, Some(ev1)),
        (4, "Table Topics", "Table Topics", 20, Some(ttm)),
        (5, "Closing", "Timer's Report & Closing", 5, Some(timer)),
    ];
    for (position, group_label, name, minutes, slot) in sessions {
        sqlx::query(
            "INSERT INTO `session`(meeting_id, position, group_label, name, duration_minutes, role_slot_id) \
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

async fn ensure_venue(pool: &MySqlPool, name: &str) -> anyhow::Result<i64> {
    sqlx::query("INSERT IGNORE INTO venue(name) VALUES (?)")
        .bind(name)
        .execute(pool)
        .await?;
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT id FROM venue WHERE name = ?")
            .bind(name)
            .fetch_one(pool)
            .await?,
    )
}

async fn insert_slot(pool: &MySqlPool, meeting_id: i64, role_name: &str) -> anyhow::Result<i64> {
    let rid = role_id(pool, role_name).await?;
    insert_id(
        sqlx::query("INSERT INTO role_slot(meeting_id, role_id) VALUES (?, ?)")
            .bind(meeting_id)
            .bind(rid)
            .execute(pool)
            .await?,
    )
}
