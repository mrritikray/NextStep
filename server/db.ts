/**
 * Local (SQLite) persistence for Manus scaffold auth records.
 *
 * The original Manus template used Drizzle + a TiDB/MySQL server. NextStep is
 * explicitly local-first, so the auth helpers now run on the same
 * SQLite + better-sqlite3 database as the rest of the product data
 * (server/data/nextstep.db). No cloud database is required.
 */
import { nowIso } from "./db/sqlite";
import { getDb } from "./db/sqlite";
import { ENV } from "./_core/env";

export type UserRole = "user" | "admin";

export interface InsertUser {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: UserRole;
  createdAt?: Date;
  updatedAt?: Date;
  lastSignedIn: Date;
}

export interface User {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}

const USERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_id TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  login_method TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_signed_in TEXT
);
`;

function db() {
  const handle = getDb();
  handle.exec(USERS_SCHEMA);
  return handle;
}

/** The scaffold's `getDb()` is async in the template; kept async for compatibility. */
export async function getDbAsync() {
  return db();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const handle = db();
  const timestamp = nowIso();
  const existing = handle
    .prepare("SELECT * FROM users WHERE open_id = ? LIMIT 1")
    .get(user.openId) as Record<string, unknown> | undefined;

  const role: UserRole = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  const lastSignedIn = (user.lastSignedIn ?? new Date()).toISOString();

  if (!existing) {
    handle
      .prepare(
        `INSERT INTO users (open_id, name, email, login_method, role, created_at, updated_at, last_signed_in)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.openId,
        user.name ?? null,
        user.email ?? null,
        user.loginMethod ?? null,
        role,
        timestamp,
        timestamp,
        lastSignedIn,
      );
    return;
  }

  handle
    .prepare(
      `UPDATE users
          SET name = COALESCE(?, name),
              email = COALESCE(?, email),
              login_method = COALESCE(?, login_method),
              role = ?,
              updated_at = ?,
              last_signed_in = ?
        WHERE open_id = ?`,
    )
    .run(
      user.name ?? null,
      user.email ?? null,
      user.loginMethod ?? null,
      role,
      timestamp,
      lastSignedIn,
      user.openId,
    );
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const row = db().prepare("SELECT * FROM users WHERE open_id = ? LIMIT 1").get(openId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;

  return {
    id: Number(row.id),
    openId: String(row.open_id),
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    loginMethod: (row.login_method as string | null) ?? null,
    role: ((row.role as string | null) ?? "user") as UserRole,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    lastSignedIn: row.last_signed_in ? new Date(String(row.last_signed_in)) : new Date(String(row.updated_at)),
  };
}
