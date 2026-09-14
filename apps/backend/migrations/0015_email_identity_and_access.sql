ALTER TABLE `user`
    ADD COLUMN email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
    ADD COLUMN password_hash VARCHAR(255) NULL,
    ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'editor',
    ADD UNIQUE KEY uq_user_email (email);

-- Preserve everyone present at migration time, including legacy and identity-less users.
-- All subsequent inserts, including staff-created walk-ins, default to read-only.
ALTER TABLE `user` ALTER COLUMN role SET DEFAULT 'guest';
