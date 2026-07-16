-- Vibe: Virtual Attendance & Business Efficiency
-- Cloudflare D1 schema

PRAGMA foreign_keys = ON;

-- One row per tenant/business. Supports single-company or multi-company use.
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admins and employees. role = 'admin' | 'employee'
CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_code           TEXT NOT NULL,
  name                    TEXT NOT NULL,
  email                   TEXT NOT NULL,
  password_hash           TEXT NOT NULL,
  password_salt           TEXT NOT NULL,
  role                    TEXT NOT NULL DEFAULT 'employee', -- admin | employee
  department              TEXT,
  position                TEXT,
  status                  TEXT NOT NULL DEFAULT 'active', -- active | suspended | archived
  rotation_shift_ids      TEXT,      -- JSON array of shift ids, e.g. ["s1","s2","s3"]
  rotation_start_date     TEXT,      -- ISO date the rotation began
  rotation_interval_days  INTEGER DEFAULT 7, -- length of each leg of the rotation
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Approved work locations for GPS-verified clock-in/out. A company can have many.
CREATE TABLE IF NOT EXISTS locations (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  latitude        REAL NOT NULL,
  longitude       REAL NOT NULL,
  radius_meters   INTEGER NOT NULL DEFAULT 150,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_locations_company ON locations(company_id);

-- Shift definitions, e.g. Morning 08:00-16:00. Rotation is computed from
-- a user's rotation_shift_ids / rotation_start_date / rotation_interval_days.
CREATE TABLE IF NOT EXISTS shifts (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_time    TEXT NOT NULL, -- 'HH:MM'
  end_time      TEXT NOT NULL, -- 'HH:MM'
  grace_minutes INTEGER NOT NULL DEFAULT 10,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shifts_company ON shifts(company_id);

-- Materialized daily shift assignment (written on demand) so reporting
-- never has to recompute rotation math for history.
CREATE TABLE IF NOT EXISTS shift_assignments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id    TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  date        TEXT NOT NULL, -- 'YYYY-MM-DD'
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_assign_user_date ON shift_assignments(user_id, date);

CREATE TABLE IF NOT EXISTS attendance (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                    TEXT NOT NULL, -- 'YYYY-MM-DD'
  shift_id                TEXT REFERENCES shifts(id),
  clock_in_at             TEXT,
  clock_in_lat            REAL,
  clock_in_lng            REAL,
  clock_in_location_id    TEXT REFERENCES locations(id),
  clock_out_at            TEXT,
  clock_out_lat           REAL,
  clock_out_lng           REAL,
  clock_out_location_id   TEXT REFERENCES locations(id),
  status                  TEXT NOT NULL DEFAULT 'present', -- present | late | absent | leave
  notes                   TEXT,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_company_date ON attendance(company_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);

CREATE TABLE IF NOT EXISTS leave_requests (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type    TEXT NOT NULL, -- annual | sick | unpaid | other
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by   TEXT REFERENCES users(id),
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leave_company ON leave_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);
