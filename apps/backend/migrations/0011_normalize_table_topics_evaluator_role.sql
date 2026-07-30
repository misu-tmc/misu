-- Normalize evaluator role naming to one canonical value.
-- Canonical role name: 'table topics evaluator'
-- Handles both cases safely:
-- 1) canonical row exists -> re-point role_slot rows to canonical id, then delete variant rows.
-- 2) canonical row does not exist -> rename one variant row to canonical.

SET @canonical_name := 'table topics evaluator';

-- Ensure a canonical row exists with the desired role metadata.
INSERT INTO `role`(name, is_bookable, voting_group)
SELECT @canonical_name, 1, 'Best evaluator'
WHERE NOT EXISTS (
  SELECT 1 FROM `role` WHERE LOWER(TRIM(name)) = @canonical_name
);

-- Canonical id (existing or newly inserted).
SET @canonical_id := (
  SELECT id
  FROM `role`
  WHERE LOWER(TRIM(name)) = @canonical_name
  ORDER BY id
  LIMIT 1
);

-- Move slots from old variants onto canonical id.
UPDATE role_slot rs
JOIN `role` r ON r.id = rs.role_id
SET rs.role_id = @canonical_id
WHERE LOWER(TRIM(r.name)) IN (
  'table topic evaluator',
  'table topic evaulator',
  'table topics evaulator'
)
  AND r.id <> @canonical_id;

-- Delete now-unreferenced variant role rows.
DELETE r
FROM `role` r
WHERE LOWER(TRIM(r.name)) IN (
  'table topic evaluator',
  'table topic evaulator',
  'table topics evaulator'
)
  AND r.id <> @canonical_id;

-- Keep canonical defaults consistent.
UPDATE `role`
SET is_bookable = 1,
    voting_group = 'Best evaluator'
WHERE id = @canonical_id;
