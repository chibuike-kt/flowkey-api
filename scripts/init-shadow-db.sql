-- =============================================================================
-- FLOWKEY — SHADOW DATABASE INIT SCRIPT
-- =============================================================================
-- Prisma requires a shadow database for `prisma migrate dev`.
-- This script runs once when the Docker Postgres container is first created.
-- It creates the shadow DB alongside the main flowkey_db.
-- =============================================================================

CREATE DATABASE flowkey_shadow_db
  WITH OWNER flowkey
  ENCODING 'UTF8'
  LC_COLLATE = 'en_US.utf8'
  LC_CTYPE = 'en_US.utf8'
  TEMPLATE template0;

GRANT ALL PRIVILEGES ON DATABASE flowkey_shadow_db TO flowkey;
