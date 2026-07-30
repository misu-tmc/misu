-- Per-user voting choices per meeting and voting group.
-- A user can submit/update at most one choice per group in a meeting.

CREATE TABLE meeting_vote (
    id BIGINT NOT NULL AUTO_INCREMENT,
    meeting_id BIGINT NOT NULL,
    voter_id BIGINT NOT NULL,
    voting_group VARCHAR(64) NOT NULL,
    role_slot_id BIGINT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_vote_meeting_voter_group (meeting_id, voter_id, voting_group),
    KEY idx_vote_meeting_group (meeting_id, voting_group),
    CONSTRAINT fk_vote_meeting
        FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE,
    CONSTRAINT fk_vote_voter
        FOREIGN KEY (voter_id) REFERENCES `user` (id),
    CONSTRAINT fk_vote_role_slot
        FOREIGN KEY (role_slot_id) REFERENCES role_slot (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
