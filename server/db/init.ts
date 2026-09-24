/**
 * Database initialisation / inspection CLI.
 *
 *   npm run db:init     create the SQLite file and all tables
 *   npm run db:reset    delete the database file, then recreate it
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "./sqlite";
import { seedSampleOpportunities } from "./seed";

const reset = process.argv.includes("--reset");

const configured = process.env.DATABASE_PATH?.trim();
const dbPath = configured
  ? path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured)
  : path.resolve(process.cwd(), "server", "data", "nextstep.db");

if (reset) {
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      console.log(`Removed ${target}`);
    }
  }
  try {
    fs.rmSync(path.join(path.dirname(dbPath), "samples_seeded"), { force: true });
  } catch {
    /* ignore */
  }
}

const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as Array<{ name: string }>;

console.log(`SQLite database: ${dbPath}`);
console.log(`Tables (${tables.length}): ${tables.map(row => row.name).join(", ")}`);

const counts = {
  profiles: (db.prepare("SELECT COUNT(*) AS c FROM profiles").get() as { c: number }).c,
  resumes: (db.prepare("SELECT COUNT(*) AS c FROM resumes").get() as { c: number }).c,
  opportunities: (db.prepare("SELECT COUNT(*) AS c FROM opportunities").get() as { c: number }).c,
  opportunity_analyses: (db.prepare("SELECT COUNT(*) AS c FROM opportunity_analyses").get() as { c: number }).c,
  roadmaps: (db.prepare("SELECT COUNT(*) AS c FROM roadmaps").get() as { c: number }).c,
  roadmap_items: (db.prepare("SELECT COUNT(*) AS c FROM roadmap_items").get() as { c: number }).c,
  applications: (db.prepare("SELECT COUNT(*) AS c FROM applications").get() as { c: number }).c,
  feedback: (db.prepare("SELECT COUNT(*) AS c FROM feedback").get() as { c: number }).c,
};
console.log("Row counts:", JSON.stringify(counts));

seedSampleOpportunities();
closeDb();
console.log("Done.");
