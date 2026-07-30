CREATE TABLE speech (
    id BIGINT NOT NULL AUTO_INCREMENT,
    role_slot_id BIGINT NOT NULL,
    meeting_id BIGINT NOT NULL,
    speaker_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL DEFAULT '',
    pathway VARCHAR(255) NOT NULL DEFAULT '',
    level INT NULL,
    purpose VARCHAR(500) NOT NULL DEFAULT '',
    description VARCHAR(500) NOT NULL DEFAULT '',
    updated_at VARCHAR(40) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_speech_slot (role_slot_id),
    KEY idx_speech_meeting (meeting_id),
    KEY idx_speech_speaker (speaker_id),
    CONSTRAINT fk_speech_slot
        FOREIGN KEY (role_slot_id) REFERENCES role_slot (id) ON DELETE CASCADE,
    CONSTRAINT fk_speech_meeting
        FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE,
    CONSTRAINT fk_speech_speaker
        FOREIGN KEY (speaker_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill from the old role_assignment.prep_data JSON. Only prepared-speech slots that
-- already have a booker (the speaker) qualify, matching the "a speech must be performed
-- by someone" rule. prep_data is left in place so nothing is lost.
INSERT INTO speech
    (role_slot_id, meeting_id, speaker_id, title, pathway, level, purpose, description, updated_at)
SELECT
    rs.id,
    rs.meeting_id,
    ra.booker_id,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ra.prep_data, '$.title')), ''),
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ra.prep_data, '$.pathway')), ''),
    CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ra.prep_data, '$.level')), 'null') AS SIGNED),
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ra.prep_data, '$.purpose')), ''),
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ra.prep_data, '$.description')), ''),
    ra.prep_updated_at
FROM role_slot rs
JOIN `role` r ON r.id = rs.role_id
JOIN role_assignment ra ON ra.role_slot_id = rs.id
WHERE ra.booker_id IS NOT NULL
  AND (LOWER(r.name) LIKE '%speaker%' OR LOWER(r.name) LIKE '%prepared speech%');
