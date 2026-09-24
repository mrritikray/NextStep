/**
 * Local persistent storage for NextStep.
 *
 * SQLite + better-sqlite3 only. No Firebase / Supabase / Mongo / MySQL server.
 * The database file lives on disk (default: server/data/nextstep.db) and every
 * table is created automatically when the backend starts, so a fresh clone
 * works with zero setup.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let _db: Database.Database | null = null;

function resolveDbPath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "server", "data", "nextstep.db");
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  location TEXT DEFAULT '',
  preferred_work_location TEXT DEFAULT 'Remote',
  college TEXT DEFAULT '',
  degree TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  graduation_year TEXT DEFAULT '',
  cgpa TEXT DEFAULT '',
  career_objective TEXT DEFAULT '',
  skills TEXT DEFAULT '[]',
  projects TEXT DEFAULT '[]',
  experience TEXT DEFAULT '[]',
  certifications TEXT DEFAULT '[]',
  preferences TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  extracted_text TEXT DEFAULT '',
  extracted_profile TEXT DEFAULT '{}',
  analysis TEXT DEFAULT '{}',
  improvement_suggestions TEXT DEFAULT '[]',
  improved_resume TEXT DEFAULT '',
  improved_changes TEXT DEFAULT '[]',
  improvement_kind TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  employment_type TEXT DEFAULT '',
  compensation TEXT DEFAULT '',
  eligibility TEXT DEFAULT '',
  required_skills TEXT DEFAULT '[]',
  preferred_skills TEXT DEFAULT '[]',
  responsibilities TEXT DEFAULT '[]',
  responsibilities_raw TEXT DEFAULT '',
  experience_requirement TEXT DEFAULT '',
  education_requirement TEXT DEFAULT '',
  application_info TEXT DEFAULT '',
  source TEXT DEFAULT 'text',
  source_filename TEXT DEFAULT '',
  is_sample INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunity_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  match_percentage INTEGER DEFAULT 0,
  eligibility_result TEXT DEFAULT '',
  matched_skills TEXT DEFAULT '[]',
  partial_skills TEXT DEFAULT '[]',
  missing_skills TEXT DEFAULT '[]',
  not_applicable_skills TEXT DEFAULT '[]',
  skill_gaps TEXT DEFAULT '[]',
  skill_rows TEXT DEFAULT '[]',
  eligibility_checks TEXT DEFAULT '[]',
  factors TEXT DEFAULT '[]',
  explanation TEXT DEFAULT '',
  trust_indicators TEXT DEFAULT '[]',
  trust_status TEXT DEFAULT '',
  engine TEXT DEFAULT 'rules',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  target_opportunity TEXT DEFAULT '',
  target_skills TEXT DEFAULT '[]',
  estimated_duration TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  engine TEXT DEFAULT 'rules',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  skill TEXT DEFAULT '',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  learning_objective TEXT DEFAULT '',
  practical_task TEXT DEFAULT '',
  resources TEXT DEFAULT '[]',
  completed INTEGER DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  company TEXT DEFAULT '',
  position TEXT DEFAULT '',
  match_percentage INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Saved',
  date_applied TEXT,
  notes TEXT DEFAULT '',
  tailored_resume TEXT DEFAULT '',
  tailored_changes TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  rejection_category TEXT DEFAULT 'Unknown',
  user_explanation TEXT DEFAULT '',
  analysis TEXT DEFAULT '{}',
  improvement_recommendations TEXT DEFAULT '[]',
  engine TEXT DEFAULT 'rules',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

/*
 * Saved Data / Opportunity History.
 * One archived snapshot per opportunity. The whole per-opportunity state is
 * stored as JSON (job details, match, skill gaps, roadmap, progress, completed
 * tasks, applications, rejection feedback) so a previous opportunity can be
 * restored exactly where it was left. The user's main profile is NEVER part of
 * a snapshot — it stays shared and independent.
 */
CREATE TABLE IF NOT EXISTS opportunity_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  company TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  match_percentage INTEGER DEFAULT 0,
  is_current INTEGER DEFAULT 0,
  status TEXT DEFAULT 'archived',
  progress_total INTEGER DEFAULT 0,
  progress_completed INTEGER DEFAULT 0,
  progress_remaining INTEGER DEFAULT 0,
  progress_percent INTEGER DEFAULT 0,
  application_status TEXT DEFAULT '',
  rejection_reason TEXT DEFAULT '',
  state TEXT DEFAULT '{}',
  saved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/*
 * Learning resources suggested for a specific roadmap task, in the language the
 * user picked. Rows are generated on demand ("Find Learning Resources") and
 * persisted so they survive a refresh/restart without re-asking.
 */
CREATE TABLE IF NOT EXISTS learning_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_item_id INTEGER NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE CASCADE,
  skill TEXT DEFAULT '',
  language TEXT DEFAULT 'English',
  kind TEXT DEFAULT 'website',
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT DEFAULT '',
  verified INTEGER DEFAULT 0,
  engine TEXT DEFAULT 'rules',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resumes_profile ON resumes(profile_id);
CREATE INDEX IF NOT EXISTS idx_analyses_opportunity ON opportunity_analyses(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_roadmap ON roadmap_items(roadmap_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_feedback_application ON feedback(application_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
`;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // Lightweight forward migration: columns added after the first release.
  const columns = new Set(
    (db.prepare("PRAGMA table_info(opportunity_analyses)").all() as { name: string }[]).map(c => c.name),
  );
  if (!columns.has("skill_rows")) {
    db.exec("ALTER TABLE opportunity_analyses ADD COLUMN skill_rows TEXT DEFAULT '[]'");
  }
  const applicationColumns = new Set(
    (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map(c => c.name),
  );
  if (!applicationColumns.has("rejection_reason")) {
    db.exec("ALTER TABLE applications ADD COLUMN rejection_reason TEXT DEFAULT ''");
  }
  if (!applicationColumns.has("outcome")) {
    db.exec("ALTER TABLE applications ADD COLUMN outcome TEXT DEFAULT ''");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_resources_unique ON learning_resources(roadmap_item_id, language, url)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_learning_resources_item ON learning_resources(roadmap_item_id, language)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_snapshots_current ON opportunity_snapshots(is_current)",
  );

  _db = db;

  console.log(`[Database] SQLite ready at ${dbPath}`);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* already closed */
    }
    _db = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}
