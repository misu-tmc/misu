-- Attendance: durable record of who came to each meeting (design: check_in.md).
-- One row per person per meeting; presence only (no role reference).

CREATE TABLE attendance (
    id BIGINT NOT NULL AUTO_INCREMENT,
    meeting_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    checked_in_at VARCHAR(40) NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'self',
    PRIMARY KEY (id),
    UNIQUE KEY uq_attendance_meeting_user (meeting_id, user_id),
    CONSTRAINT fk_attendance_meeting
        FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE,
    CONSTRAINT fk_attendance_user
        FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
