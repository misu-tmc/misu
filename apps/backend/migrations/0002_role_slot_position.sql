ALTER TABLE role_slot
    ADD COLUMN position BIGINT NOT NULL DEFAULT 0 AFTER meeting_id;

-- Seed existing rows so their current id order becomes their stored position.
UPDATE role_slot rs
JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY meeting_id ORDER BY id) - 1 AS pos
    FROM role_slot
) ordered ON ordered.id = rs.id
SET rs.position = ordered.pos;

CREATE INDEX idx_role_slot_meeting_position ON role_slot (meeting_id, position);
