-- Store viewport width alongside UA-based device classification.
-- Gives users additional context (what layout the visitor actually saw).

ALTER TABLE events ADD COLUMN viewport INTEGER;
