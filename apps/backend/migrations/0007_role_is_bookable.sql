-- Add is_bookable to the role catalog.
-- Bookable = true (default): members can self-book this role via the Booking page.
-- Bookable = false: the role is assigned by an admin during the meeting (e.g. Table
--   Topics Speaker). These slots appear in the Table Topics editor tab, not the Roles tab,
--   and are hidden from the public booking flow.

ALTER TABLE `role`
    ADD COLUMN is_bookable TINYINT(1) NOT NULL DEFAULT 1;
