ALTER TABLE movies
ADD COLUMN version TEXT
CHECK (
  version IS NULL OR (
    tmdb_id IS NOT NULL AND
    length(trim(version)) BETWEEN 1 AND 120
  )
);

ALTER TABLE movies
ADD COLUMN version_runtime INTEGER
CHECK (
  version_runtime IS NULL OR (
    version IS NOT NULL AND
    version_runtime > 0
  )
);

ALTER TABLE movies
ADD COLUMN version_reference_url TEXT
CHECK (
  version_reference_url IS NULL OR (
    version IS NOT NULL AND
    length(trim(version_reference_url)) BETWEEN 1 AND 2048 AND
    (
      lower(version_reference_url) LIKE 'http://%' OR
      lower(version_reference_url) LIKE 'https://%'
    )
  )
);
