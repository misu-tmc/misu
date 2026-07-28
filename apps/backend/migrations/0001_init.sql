CREATE TABLE `user` (
    id BIGINT NOT NULL AUTO_INCREMENT,
    display_name VARCHAR(255) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wechat_identity (
    openid VARCHAR(191) NOT NULL,
    user_id BIGINT NOT NULL,
    PRIMARY KEY (openid),
    CONSTRAINT fk_wechat_identity_user
        FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE web_credential (
    username VARCHAR(191) NOT NULL,
    user_id BIGINT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    PRIMARY KEY (username),
    CONSTRAINT fk_web_credential_user
        FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_session (
    token CHAR(32) NOT NULL,
    user_id BIGINT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (token),
    KEY idx_auth_session_user (user_id),
    CONSTRAINT fk_auth_session_user
        FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE venue (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_venue_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE meeting (
    id BIGINT NOT NULL AUTO_INCREMENT,
    number BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    theme VARCHAR(255) NOT NULL DEFAULT '',
    keyword VARCHAR(255) NOT NULL DEFAULT '',
    date CHAR(10) NOT NULL,
    start_time VARCHAR(8) NOT NULL,
    end_time VARCHAR(8) NOT NULL DEFAULT '',
    venue_id BIGINT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    meeting_manager BIGINT NULL,
    PRIMARY KEY (id),
    KEY idx_meeting_venue (venue_id),
    CONSTRAINT fk_meeting_venue
        FOREIGN KEY (venue_id) REFERENCES venue (id),
    CONSTRAINT fk_meeting_manager
        FOREIGN KEY (meeting_manager) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE template (
    meeting_id BIGINT NOT NULL,
    PRIMARY KEY (meeting_id),
    CONSTRAINT fk_template_meeting
        FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `role` (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    properties TEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_role_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_slot (
    id BIGINT NOT NULL AUTO_INCREMENT,
    meeting_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    label VARCHAR(255) NULL,
    is_optional TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_role_slot_meeting (meeting_id),
    CONSTRAINT fk_role_slot_meeting
        FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE,
    CONSTRAINT fk_role_slot_role
        FOREIGN KEY (role_id) REFERENCES `role` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `session` (
    id BIGINT NOT NULL AUTO_INCREMENT,
    meeting_id BIGINT NOT NULL,
    position BIGINT NOT NULL,
    group_label VARCHAR(255) NOT NULL DEFAULT '',
    name VARCHAR(255) NOT NULL,
    duration_minutes BIGINT NOT NULL DEFAULT 0,
    role_slot_id BIGINT NULL,
    PRIMARY KEY (id),
    KEY idx_session_meeting (meeting_id),
    CONSTRAINT fk_session_meeting
        FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE,
    CONSTRAINT fk_session_role_slot
        FOREIGN KEY (role_slot_id) REFERENCES role_slot (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_assignment (
    id BIGINT NOT NULL AUTO_INCREMENT,
    role_slot_id BIGINT NOT NULL,
    booker_id BIGINT NULL,
    taker_id BIGINT NULL,
    prep_data TEXT NOT NULL,
    prep_updated_at VARCHAR(40) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_role_assignment_slot (role_slot_id),
    CONSTRAINT fk_role_assignment_slot
        FOREIGN KEY (role_slot_id) REFERENCES role_slot (id) ON DELETE CASCADE,
    CONSTRAINT fk_role_assignment_booker
        FOREIGN KEY (booker_id) REFERENCES `user` (id),
    CONSTRAINT fk_role_assignment_taker
        FOREIGN KEY (taker_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;