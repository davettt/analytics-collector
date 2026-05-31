-- Add richer per-event data for sessions, journeys, referring pages, and client-type filtering.

-- Full referrer path (not just hostname) — enables "referring pages" view.
ALTER TABLE events ADD COLUMN ref_path TEXT;

-- Coarse client type derived from User-Agent at ingest (UA itself is NOT stored).
-- Values: human | headless | http_client | search_crawler | ai_crawler
ALTER TABLE events ADD COLUMN client_type TEXT DEFAULT 'human';
