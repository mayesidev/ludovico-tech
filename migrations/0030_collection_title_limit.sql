-- Preserve existing collections; reject only membership growth beyond 1,000.
-- The indexed probe stops at the first excess member, including in legacy groups.
CREATE TRIGGER collection_title_limit_insert
AFTER INSERT ON collection_memberships
WHEN EXISTS (
  SELECT 1 FROM collection_memberships
  WHERE collection_id = NEW.collection_id LIMIT 1 OFFSET 1000
)
BEGIN
  SELECT RAISE(ABORT, 'Collection title limit exceeded');
END;

CREATE TRIGGER collection_title_limit_move
AFTER UPDATE OF collection_id ON collection_memberships
WHEN NEW.collection_id <> OLD.collection_id AND EXISTS (
  SELECT 1 FROM collection_memberships
  WHERE collection_id = NEW.collection_id LIMIT 1 OFFSET 1000
)
BEGIN
  SELECT RAISE(ABORT, 'Collection title limit exceeded');
END;
