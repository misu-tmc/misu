-- Prepared-speech details now live in the `speech` table (migration 0003), so the legacy
-- role_assignment.prep_data / prep_updated_at columns are no longer used.
ALTER TABLE role_assignment
    DROP COLUMN prep_data,
    DROP COLUMN prep_updated_at;
