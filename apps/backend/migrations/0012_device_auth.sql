-- Device-bound web authentication.
-- A browser keeps the private key locally; the server stores only the public key.
CREATE TABLE device_credential (
    id CHAR(36) NOT NULL,
    user_id BIGINT NOT NULL,
    public_key BLOB NOT NULL,
    device_name VARCHAR(191) NOT NULL DEFAULT '',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_used_at DATETIME(6) NULL,
    revoked_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_device_credential_user (user_id),
    CONSTRAINT fk_device_credential_user
        FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time challenges prevent a captured signature from being replayed.
CREATE TABLE device_auth_challenge (
    id CHAR(36) NOT NULL,
    credential_id CHAR(36) NOT NULL,
    challenge CHAR(32) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_device_auth_challenge_expiry (expires_at),
    CONSTRAINT fk_device_auth_challenge_credential
        FOREIGN KEY (credential_id) REFERENCES device_credential (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An authenticated device can issue a short-lived, single-use code that registers a
-- separate key on another device. Only a SHA-256 hash of the displayed code is stored.
CREATE TABLE device_migration_code (
    code_hash CHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    PRIMARY KEY (code_hash),
    KEY idx_device_migration_code_user (user_id),
    KEY idx_device_migration_code_expiry (expires_at),
    CONSTRAINT fk_device_migration_code_user
        FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
