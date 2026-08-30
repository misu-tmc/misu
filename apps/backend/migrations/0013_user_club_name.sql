-- Optional club affiliation for user profiles. Nullable: most rows have no
-- club on file until the user supplies one during registration or profile
-- editing.
ALTER TABLE `user`
    ADD COLUMN club_name VARCHAR(255) NULL AFTER display_name;
