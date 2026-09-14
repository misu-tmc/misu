use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use rand_core::OsRng;
use serde_json::{json, Value};
use sqlx::{mysql::MySqlConnectOptions, MySqlPool};
use tower::ServiceExt;

use crate::{app_router, auth, config::Config, AppState};

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
    cookie: bool,
    openid: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    builder = builder.header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        builder = if cookie {
            builder.header(header::COOKIE, format!("misu_session={token}"))
        } else {
            builder.header(header::AUTHORIZATION, format!("Bearer {token}"))
        };
    }
    if let Some(openid) = openid {
        builder = builder.header("x-wx-openid", openid);
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, headers, body)
}

async fn post(app: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let (status, _, body) = request(app, "POST", path, token, body, false, None).await;
    (status, body)
}

/// Uses an isolated random schema, never migrates/seeds the configured application database.
#[tokio::test]
#[ignore = "requires local MySQL and MISU_DB_* credentials with CREATE/DROP DATABASE privileges"]
async fn email_identity_and_read_only_guests_mysql() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::ERROR)
        .with_test_writer()
        .try_init();
    let _ = dotenvy::dotenv();
    let mut config = Config::from_env();
    config.trust_wechat_gateway = true;
    config.wechat_appid = None;
    config.wechat_secret = None;
    let options = MySqlConnectOptions::new()
        .host(&config.db_host)
        .port(config.db_port)
        .username(&config.db_user)
        .password(&config.db_password);
    let admin = MySqlPool::connect_with(options.clone())
        .await
        .expect("test MySQL connection");
    let database = format!("misu_auth_test_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE `{database}`"))
        .execute(&admin)
        .await
        .unwrap();
    let pool = MySqlPool::connect_with(options.database(&database))
        .await
        .unwrap();
    let test_pool = pool.clone();
    let result = tokio::spawn(async move { exercise_api(test_pool, config).await }).await;
    pool.close().await;
    sqlx::query(&format!("DROP DATABASE `{database}`"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
    if let Err(error) = result {
        std::panic::resume_unwind(error.into_panic());
    }
}

async fn exercise_api(pool: MySqlPool, config: Config) {
    // Insert legacy accounts immediately before the new migration to prove its backfill.
    for migration in sqlx::migrate!("./migrations").iter() {
        if migration.version == 15 {
            sqlx::query("INSERT INTO user(id, display_name) VALUES (1, 'Legacy'), (2, 'Legacy device'), (3, 'Other legacy')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO wechat_identity(openid, user_id) VALUES ('legacy-openid', 1)")
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
    }
    let legacy_roles: Vec<String> = sqlx::query_scalar("SELECT role FROM user ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(legacy_roles, ["editor", "editor", "editor"]);
    let bare_id = sqlx::query("INSERT INTO user(display_name) VALUES ('Bare new user')")
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_id() as i64;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT role FROM user WHERE id = ?")
            .bind(bare_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "guest"
    );

    let state = AppState {
        pool: pool.clone(),
        config: Arc::new(config),
        email_auth: Arc::default(),
    };
    let app = app_router(state.clone());
    let legacy_token = auth::create_session(&pool, 1).await.unwrap();
    let device_token = auth::create_session(&pool, 2).await.unwrap();
    let other_token = auth::create_session(&pool, 3).await.unwrap();
    let password = "a long test password";
    let signup = json!({"email":" New.User@Example.COM ", "password":password,
        "display_name":" New User ", "club_name":" Test Club "});
    let (status, headers, registered) = request(
        &app,
        "POST",
        "/api/auth/email/register",
        None,
        signup.clone(),
        false,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{registered}");
    assert!(headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .contains("HttpOnly"));
    assert!(headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .contains("SameSite=Lax"));
    assert_eq!(registered["user"]["email"], "new.user@example.com");
    assert_eq!(registered["user"]["role"], "guest");
    assert_eq!(registered["user"]["display_name"], "New User");
    assert_eq!(registered["user"]["club_name"], "Test Club");
    let guest = registered["token"].as_str().unwrap();
    let guest_id = registered["user"]["id"].as_i64().unwrap();
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM user WHERE id = ?")
        .bind(guest_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(hash.starts_with("$argon2id$"));
    assert!(!hash.contains(password));
    assert_eq!(
        post(&app, "/api/auth/email/register", None, signup).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(post(&app, "/api/auth/email/register", None,
        json!({"email":"role@example.com","password":password,"display_name":"Role","role":"editor"})).await.0,
        StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        post(
            &app,
            "/api/auth/email/register",
            None,
            json!({"email":"invalid","password":password,"display_name":"Invalid"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &app,
            "/api/auth/email/register",
            None,
            json!({"email":"short@example.com","password":"short","display_name":"Short"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    for (email, password) in [
        ("new.user@example.com", "wrong long password"),
        ("missing@example.com", password),
    ] {
        assert_eq!(
            post(
                &app,
                "/api/auth/email/login",
                None,
                json!({"email":email,"password":password})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    let (status, logged_in) = post(
        &app,
        "/api/auth/email/login",
        None,
        json!({"email":" NEW.USER@EXAMPLE.COM ","password":password}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(logged_in["user"], registered["user"]);
    assert_ne!(logged_in["token"], guest);
    for cookie in [false, true] {
        let (status, _, me) = request(
            &app,
            "GET",
            "/api/auth/me",
            Some(guest),
            Value::Null,
            cookie,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(me["user"], registered["user"]);
    }

    sqlx::query("INSERT INTO meeting(id, number, title, date, start_time, status) VALUES (1, 1, 'Test', '2099-01-01', '19:00', 'published')")
        .execute(&pool).await.unwrap();
    let writes = [
        ("POST", "/api/meetings"),
        ("PUT", "/api/meetings/1/info"),
        ("PUT", "/api/meetings/1/slots"),
        ("PUT", "/api/meetings/1/sessions"),
        ("PUT", "/api/meetings/1/status"),
        ("PUT", "/api/meetings/1/table-topics"),
        ("PUT", "/api/meetings/1/speech"),
        ("POST", "/api/meetings/1/checkin"),
        ("POST", "/api/meetings/1/attendees"),
        ("POST", "/api/meetings/1/vote"),
        ("POST", "/api/book"),
        ("POST", "/api/users/1"),
        ("POST", "/api/users"),
        ("POST", "/api/roles"),
        ("POST", "/api/venues"),
    ];
    for cookie in [false, true] {
        for (method, path) in writes {
            let (status, _, _) =
                request(&app, method, path, Some(guest), json!({}), cookie, None).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}");
            let (status, _, _) = request(&app, method, path, None, json!({}), cookie, None).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {path}");
        }
    }
    assert_eq!(
        post(
            &app,
            &format!("/api/users/{guest_id}"),
            Some(guest),
            json!({"display_name":"Changed","club_name":"Other"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post(
            &app,
            "/api/book",
            Some(guest),
            json!({"meeting_id":1,"role_slot_id":1,"cancel":true,"user_id":1})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for path in [
        "/api/meetings",
        "/api/meetings/upcoming",
        "/api/meetings/1",
        "/api/users",
        "/api/roles",
        "/api/venues",
        "/api/templates",
        "/api/meetings/1/checkin",
        "/api/meetings/1/attendees",
        "/api/meetings/1/vote",
        "/api/meetings/1/vote/result",
    ] {
        let (status, _, body) =
            request(&app, "GET", path, Some(guest), Value::Null, false, None).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    for table in [
        "role_assignment",
        "speech",
        "attendance",
        "meeting_vote",
        "venue",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM `{table}`"))
                .fetch_one(&pool)
                .await
                .unwrap(),
            0,
            "{table} changed"
        );
    }
    for (method, path) in writes {
        let (status, _, _) = request(
            &app,
            method,
            path,
            Some(&legacy_token),
            json!({}),
            false,
            None,
        )
        .await;
        assert_ne!(
            status,
            StatusCode::FORBIDDEN,
            "legacy blocked: {method} {path}"
        );
        assert_ne!(
            status,
            StatusCode::UNAUTHORIZED,
            "legacy blocked: {method} {path}"
        );
    }
    assert_eq!(
        post(
            &app,
            "/api/venues",
            Some(&legacy_token),
            json!({"name":"Editor venue"})
        )
        .await
        .0,
        StatusCode::OK
    );

    // Only session ownership can attach email, never a submitted identity/name.
    let link = json!({"email":"legacy@example.com","password":password});
    assert_eq!(
        post(&app, "/api/auth/email/link", None, link.clone())
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, linked) = post(
        &app,
        "/api/auth/email/link",
        Some(&legacy_token),
        link.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(linked["user"]["id"], 1);
    assert_eq!(linked["user"]["role"], "editor");
    assert_eq!(
        post(&app, "/api/auth/email/link", Some(&other_token), link)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        post(
            &app,
            "/api/auth/email/link",
            Some(&legacy_token),
            json!({"email":"replacement@example.com","password":password})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (status, legacy_login) = post(
        &app,
        "/api/auth/email/login",
        None,
        json!({"email":"legacy@example.com","password":password}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(legacy_login["user"]["id"], 1);

    // An existing device can link email without creating a new numeric identity.
    let key = SigningKey::random(&mut OsRng);
    let credential_id = uuid::Uuid::new_v4().to_string();
    let public_key = key
        .verifying_key()
        .to_encoded_point(false)
        .as_bytes()
        .to_vec();
    sqlx::query("INSERT INTO device_credential(id, user_id, public_key, device_name) VALUES (?, 2, ?, 'Test')")
        .bind(&credential_id).bind(&public_key).execute(&pool).await.unwrap();
    let (_, challenge) = post(
        &app,
        "/api/auth/device/challenge",
        None,
        json!({"credential_id":credential_id}),
    )
    .await;
    let signature: Signature = key.sign(challenge["challenge"].as_str().unwrap().as_bytes());
    let verification = json!({"challenge_id":challenge["challenge_id"],"signature":BASE64.encode(signature.to_bytes())});
    let (status, device_login) =
        post(&app, "/api/auth/device/verify", None, verification.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(device_login["user"]["id"], 2);
    assert_eq!(device_login["user"]["role"], "editor");
    assert!(device_login["user"]["email"].is_null());
    assert_eq!(
        post(&app, "/api/auth/device/verify", None, verification)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, linked_device) = post(
        &app,
        "/api/auth/email/link",
        Some(&device_token),
        json!({"email":"device@example.com","password":password}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(linked_device["user"]["id"], 2);
    assert_eq!(linked_device["user"]["role"], "editor");

    // Guests may manage secondary credentials but retain guest permissions.
    let (status, code) = post(
        &app,
        "/api/auth/device/migration-code",
        Some(guest),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let migration = json!({"migration_code":code["code"],"credential_id":uuid::Uuid::new_v4().to_string(),
        "public_key":BASE64.encode(public_key),"device_name":"Second browser"});
    let (status, migrated) = post(&app, "/api/auth/device/migrate", None, migration.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(migrated["user"]["id"], guest_id);
    assert_eq!(migrated["user"]["role"], "guest");
    assert_eq!(
        post(&app, "/api/auth/device/migrate", None, migration)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &app,
            "/api/auth/device/register",
            None,
            json!({"display_name":"No email"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );

    let (status, _, wechat) = request(
        &app,
        "POST",
        "/api/auth/wechat",
        None,
        json!({"code":"gateway-code"}),
        false,
        Some("legacy-openid"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(wechat["user"]["id"], 1);
    assert_eq!(wechat["user"]["email"], "legacy@example.com");
    let (status, _, _) = request(
        &app,
        "POST",
        "/api/auth/wechat",
        None,
        json!({"code":"gateway-code"}),
        false,
        Some("new-openid"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = request(
        &app,
        "POST",
        "/api/auth/wechat/link",
        None,
        json!({"code":"gateway-code"}),
        false,
        Some("new-openid"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = request(
        &app,
        "POST",
        "/api/auth/wechat/link",
        Some(guest),
        json!({"code":"gateway-code"}),
        false,
        Some("legacy-openid"),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _, linked_wechat) = request(
        &app,
        "POST",
        "/api/auth/wechat/link",
        Some(guest),
        json!({"code":"gateway-code"}),
        false,
        Some("new-openid"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(linked_wechat["user"]["id"], guest_id);
    assert_eq!(linked_wechat["user"]["role"], "guest");
    let (status, _, wechat_guest) = request(
        &app,
        "POST",
        "/api/auth/wechat",
        None,
        json!({"code":"gateway-code"}),
        false,
        Some("new-openid"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(wechat_guest["user"]["id"], guest_id);
    assert_eq!(wechat_guest["user"]["role"], "guest");
    let mut untrusted_config = (*state.config).clone();
    untrusted_config.trust_wechat_gateway = false;
    let untrusted_app = app_router(AppState {
        config: Arc::new(untrusted_config),
        ..state.clone()
    });
    let (status, _, _) = request(
        &untrusted_app,
        "POST",
        "/api/auth/wechat",
        None,
        json!({"code":"untrusted"}),
        false,
        Some("legacy-openid"),
    )
    .await;
    assert!(
        !status.is_success(),
        "untrusted OpenID header must not sign in"
    );

    // Existing sessions re-read roles: trusted SQL promotion and revocation are immediate.
    sqlx::query("UPDATE user SET role = 'editor' WHERE email = 'new.user@example.com'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        post(
            &app,
            "/api/venues",
            Some(guest),
            json!({"name":"Promoted venue"})
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE user SET role = 'unknown' WHERE id = ?")
        .bind(guest_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        post(
            &app,
            "/api/venues",
            Some(guest),
            json!({"name":"Must not create"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE user SET role = 'guest' WHERE id = ?")
        .bind(guest_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        post(&app, "/api/auth/logout", Some(guest), json!({}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/auth/me",
            Some(guest),
            Value::Null,
            true,
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    // Real endpoint throttling, including syntactically valid nonexistent addresses.
    for _ in 0..10 {
        assert_eq!(
            post(
                &app,
                "/api/auth/email/login",
                None,
                json!({"email":"bruteforce@example.com","password":password})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        post(
            &app,
            "/api/auth/email/login",
            None,
            json!({"email":"bruteforce@example.com","password":password})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
}
