-- J Michael's Manager Dashboard — D1 Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL UNIQUE,
  manager_name TEXT NOT NULL,
  data TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cashflow (
  id TEXT PRIMARY KEY,
  week TEXT,
  week_data TEXT NOT NULL DEFAULT '{}',
  days_data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mca_data (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors_data (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- admin / jmichaels2025
INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at)
VALUES ('admin001', 'admin', '9e9867e7d94d0101e5b9d47af28dcb99405862064a87f8b840b45c98d23c94bb', 'admin', datetime('now'));

-- manager / manager2025
INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at)
VALUES ('mgr001', 'manager', '16c0e87266ba3ed39afcd2f4e1db07bc543685503610143f6e23de8a79e51dfa', 'manager', datetime('now'));
