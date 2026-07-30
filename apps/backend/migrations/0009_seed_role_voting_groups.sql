-- Seed default voting groups for common role names.
-- Only fills empty voting_group values so manual overrides are preserved.

UPDATE `role`
SET voting_group = CASE LOWER(TRIM(name))
  WHEN 'saa' THEN 'Best meeting role'
  WHEN 'ah-counter' THEN 'Best meeting role'
  WHEN 'timer' THEN 'Best meeting role'
  WHEN 'grammarian' THEN 'Best meeting role'
  WHEN 'photographer' THEN 'Best meeting role'
  WHEN 'individual evaluator' THEN 'Best evaluator'
  WHEN 'table topic evaluator' THEN 'Best evaluator'
  WHEN 'table topics evaluator' THEN 'Best evaluator'
  WHEN 'table topic evaulator' THEN 'Best evaluator'
  WHEN 'table topics evaulator' THEN 'Best evaluator'
    WHEN 'prepared speech' THEN 'Best speaker'
    WHEN 'table topics speaker' THEN 'Best table topic speaker'
    ELSE voting_group
END
WHERE COALESCE(voting_group, '') = ''
  AND LOWER(TRIM(name)) IN (
    'saa',
    'ah-counter',
    'timer',
    'grammarian',
    'photographer',
    'individual evaluator',
    'table topic evaluator',
    'table topics evaluator',
    'table topic evaulator',
    'table topics evaulator',
    'prepared speech',
    'table topics speaker'
  );
