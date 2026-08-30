-- Remove the legacy username/password web provider. Web authentication now uses
-- device credentials (migration 0012), so the bcrypt-hashed `web_credential` store and
-- its foreign key to `user` are no longer needed.
DROP TABLE IF EXISTS web_credential;
