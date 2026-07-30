-- Collapse role_assignment to a single `taker_id` assignee (design: check_in.md,
-- storage/schema.md). The old `booker_id` (advance booking) folds into `taker_id`, which
-- admins later reconcile to whoever actually took the role.

-- Preserve existing bookings: move booker into taker where taker is not already set.
UPDATE role_assignment
   SET taker_id = booker_id
 WHERE taker_id IS NULL
   AND booker_id IS NOT NULL;

-- Drop the now-redundant booker column and its foreign key.
ALTER TABLE role_assignment DROP FOREIGN KEY fk_role_assignment_booker;
ALTER TABLE role_assignment DROP COLUMN booker_id;
