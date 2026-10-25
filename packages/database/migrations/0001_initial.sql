PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  library_revision INTEGER NOT NULL DEFAULT 0 CHECK (library_revision >= 0),
  last_full_scan_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO library_state (id, library_revision, updated_at)
VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('photo','motion_photo','video','unknown')),
  asset_state TEXT NOT NULL DEFAULT 'resolving' CHECK (asset_state IN ('ready','resolving','missing','deleted')),
  game TEXT NOT NULL DEFAULT 'infinity_nikki' CHECK (game = 'infinity_nikki'),
  uid TEXT,
  captured_at TEXT,
  discovered_at TEXT NOT NULL,
  metadata_schema_version INTEGER,
  metadata_json TEXT,
  motion_presentation_timestamp_us INTEGER,
  motion_resolver_method TEXT CHECK (motion_resolver_method IS NULL OR motion_resolver_method IN ('embedded_id','filename','timestamp','heuristic','manual')),
  motion_resolver_confidence REAL CHECK (motion_resolver_confidence IS NULL OR (motion_resolver_confidence >= 0 AND motion_resolver_confidence <= 1)),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_captured_at ON assets(captured_at DESC, asset_id);
CREATE INDEX IF NOT EXISTS idx_assets_gallery_order ON assets(COALESCE(captured_at, discovered_at) DESC, asset_id ASC);
CREATE INDEX IF NOT EXISTS idx_assets_uid_captured_at ON assets(uid, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_type_captured_at ON assets(asset_type, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_revision ON assets(revision);
CREATE INDEX IF NOT EXISTS idx_assets_state ON assets(asset_state);

CREATE TABLE IF NOT EXISTS resources (
  resource_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'source_primary',
    'source_high_quality',
    'source_low_quality',
    'source_motion',
    'derived_thumbnail',
    'derived_preview'
  )),
  file_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  path_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_ext TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  modified_at TEXT,
  birth_time TEXT,
  stable_state TEXT NOT NULL DEFAULT 'stable' CHECK (stable_state IN ('discovered','writing','stable','missing')),
  is_derived INTEGER NOT NULL DEFAULT 0 CHECK (is_derived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resources_asset_role ON resources(asset_id, role);
CREATE INDEX IF NOT EXISTS idx_resources_sha256 ON resources(sha256);
CREATE INDEX IF NOT EXISTS idx_resources_stable_state ON resources(stable_state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resources_asset_role_source
  ON resources(asset_id, role, path_key);

CREATE TABLE IF NOT EXISTS resolver_candidates (
  candidate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  still_resource_id TEXT NOT NULL REFERENCES resources(resource_id) ON DELETE CASCADE,
  motion_resource_id TEXT NOT NULL REFERENCES resources(resource_id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(still_resource_id, motion_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_resolver_candidates_still_score
  ON resolver_candidates(still_resource_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_resolver_candidates_status
  ON resolver_candidates(status);

CREATE TABLE IF NOT EXISTS change_journal (
  revision INTEGER PRIMARY KEY CHECK (revision > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('asset.created','asset.updated','asset.deleted')),
  asset_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_change_journal_asset ON change_journal(asset_id, revision);

CREATE TABLE IF NOT EXISTS paired_devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  public_key TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  app_version TEXT,
  paired_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_paired_devices_active
  ON paired_devices(revoked_at, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS device_sync_state (
  device_id TEXT PRIMARY KEY REFERENCES paired_devices(device_id) ON DELETE CASCADE,
  last_ack_revision INTEGER NOT NULL DEFAULT 0 CHECK (last_ack_revision >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_sessions (
  pairing_token_hash TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pairing_sessions_expires_at ON pairing_sessions(expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata_dictionary_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  provider TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  game_version TEXT,
  generated_at TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata_dictionary_entries (
  kind TEXT NOT NULL CHECK (kind IN ('clothing','filter','lighting','pose','location')),
  entity_id TEXT NOT NULL,
  name TEXT,
  category TEXT,
  rarity REAL,
  thumbnail TEXT,
  raw_json TEXT,
  PRIMARY KEY(kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_dictionary_entries_kind_name
  ON metadata_dictionary_entries(kind, name);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (1, 'initial_asset_resource_sync_schema', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
