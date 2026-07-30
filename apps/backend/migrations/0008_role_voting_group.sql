-- Voting grouping for roles (used by later voting flows).
-- Empty string means no group assigned.

ALTER TABLE `role`
    ADD COLUMN voting_group VARCHAR(64) NOT NULL DEFAULT '';
