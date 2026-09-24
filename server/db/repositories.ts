/**
 * Repository layer — every database read/write for NextStep lives here.
 * SQLite (better-sqlite3) is the source of truth for all career data.
 */
import { getDb, getMeta, nowIso, parseJson, setMeta, toJson } from "../db/sqlite";
import type {
  Application,
  ApplicationStatus,
  FeedbackAnalysis,
  LearningResource,
  NotificationRecord,
  NotificationType,
  Opportunity,
  OpportunitySnapshot,
  OpportunitySnapshotState,
  Profile,
  ResumeAnalysis,
  ResumeRecord,
  Roadmap,
  RoadmapItem,
  RoadmapProgress,
  ResourceKind,
  SkillGap,
  TrustCheck,
  ExtractedProfile,
  OpportunityAnalysis,
  EligibilityCheck,
  SkillRow,
  Engine,
} from "../services/types";
import { normalizeSkill } from "../services/matching";

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function mapProfile(row: Row): Profile {
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    location: String(row.location ?? ""),
    preferredWorkLocation: String(row.preferred_work_location ?? "Remote"),
    college: String(row.college ?? ""),
    degree: String(row.degree ?? ""),
    branch: String(row.branch ?? ""),
    graduationYear: String(row.graduation_year ?? ""),
    cgpa: String(row.cgpa ?? ""),
    careerObjective: String(row.career_objective ?? ""),
    skills: parseJson<string[]>(row.skills, []),
    projects: parseJson<Profile["projects"]>(row.projects, []),
    experience: parseJson<Profile["experience"]>(row.experience, []),
    certifications: parseJson<Profile["certifications"]>(row.certifications, []),
    preferences: parseJson<Record<string, unknown>>(row.preferences, {}),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapOpportunity(row: Row): Opportunity {
  return {
    id: Number(row.id),
    company: String(row.company ?? ""),
    jobTitle: String(row.job_title ?? ""),
    description: String(row.description ?? ""),
    location: String(row.location ?? ""),
    employmentType: String(row.employment_type ?? ""),
    compensation: String(row.compensation ?? ""),
    eligibility: String(row.eligibility ?? ""),
    requiredSkills: parseJson<string[]>(row.required_skills, []),
    preferredSkills: parseJson<string[]>(row.preferred_skills, []),
    responsibilities: parseJson<string[]>(row.responsibilities, []),
    responsibilitiesRaw: String(row.responsibilities_raw ?? ""),
    experienceRequirement: String(row.experience_requirement ?? ""),
    educationRequirement: String(row.education_requirement ?? ""),
    applicationInfo: String(row.application_info ?? ""),
    source: String(row.source ?? "text"),
    sourceFilename: String(row.source_filename ?? ""),
    isSample: Number(row.is_sample ?? 0),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapAnalysis(row: Row): OpportunityAnalysis {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    matchScore: Number(row.match_percentage ?? 0),
    matchedSkills: parseJson<string[]>(row.matched_skills, []),
    partialSkills: parseJson<string[]>(row.partial_skills, []),
    missingSkills: parseJson<string[]>(row.missing_skills, []),
    notApplicableSkills: parseJson<string[]>(row.not_applicable_skills, []),
    skillRows: parseJson<SkillRow[]>(row.skill_rows ?? row.skill_gaps, []),
    eligibility: parseJson<EligibilityCheck[]>(row.eligibility_checks, []),
    factors: parseJson<OpportunityAnalysis["factors"]>(row.factors, []),
    explanation: String(row.explanation ?? ""),
    skillGaps: parseJson<SkillGap[]>(row.skill_gaps, []),
    verification: parseJson<TrustCheck>(row.trust_indicators, {
      status: "Not enough information to verify this opportunity.",
      indicators: [],
    }),
    engine: (row.engine as Engine) ?? "rules",
  };
}

function mapApplication(row: Row): Application {
  return {
    id: Number(row.id),
    opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
    company: String(row.company ?? ""),
    position: String(row.position ?? ""),
    matchPercentage: Number(row.match_percentage ?? 0),
    status: (row.status as ApplicationStatus) ?? "Saved",
    dateApplied: row.date_applied ? String(row.date_applied) : null,
    notes: String(row.notes ?? ""),
    tailoredResume: String(row.tailored_resume ?? ""),
    tailoredChanges: parseJson<Application["tailoredChanges"]>(row.tailored_changes, []),
    rejectionReason: String(row.rejection_reason ?? ""),
    outcome: String(row.outcome ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapFeedback(row: Row): FeedbackAnalysis {
  const analysis = parseJson<Record<string, unknown>>(row.analysis, {});
  return {
    id: Number(row.id),
    applicationId: row.application_id === null ? null : Number(row.application_id),
    category: String(row.rejection_category ?? "Unknown"),
    userExplanation: String(row.user_explanation ?? ""),
    area: String(analysis.area ?? ""),
    insight: String(analysis.insight ?? ""),
    action: String(analysis.action ?? ""),
    confidence: (analysis.confidence as FeedbackAnalysis["confidence"]) ?? "Low",
    skillsToPrioritize: Array.isArray(analysis.skillsToPrioritize)
      ? (analysis.skillsToPrioritize as string[])
      : [],
    recommendations: parseJson<string[]>(row.improvement_recommendations, []),
    disclaimer:
      String(analysis.disclaimer ?? "") ||
      "This analysis is based only on the feedback you recorded. It does not claim to know the company's actual reason.",
    engine: (row.engine as Engine) ?? "rules",
    createdAt: String(row.created_at ?? ""),
  };
}

function mapRoadmapItem(row: Row): RoadmapItem {
  return {
    id: Number(row.id),
    roadmapId: Number(row.roadmap_id),
    position: Number(row.position ?? 0),
    skill: String(row.skill ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    duration: String(row.duration ?? ""),
    learningObjective: String(row.learning_objective ?? ""),
    practicalTask: String(row.practical_task ?? ""),
    resources: parseJson<string[]>(row.resources, []),
    completed: Number(row.completed ?? 0) === 1,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Profiles                                                           */
/* ------------------------------------------------------------------ */

export function getProfile(): Profile | null {
  const row = getDb().prepare("SELECT * FROM profiles ORDER BY id ASC LIMIT 1").get() as Row | undefined;
  return row ? mapProfile(row) : null;
}

export function getProfileById(id: number): Profile | null {
  const row = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(id) as Row | undefined;
  return row ? mapProfile(row) : null;
}

export type ProfileInput = Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>;

export function createProfile(input: ProfileInput): Profile {
  const now = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO profiles (
        name, email, phone, location, preferred_work_location, college, degree, branch,
        graduation_year, cgpa, career_objective, skills, projects, experience, certifications,
        preferences, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.name ?? "",
      input.email ?? "",
      input.phone ?? "",
      input.location ?? "",
      input.preferredWorkLocation ?? "Remote",
      input.college ?? "",
      input.degree ?? "",
      input.branch ?? "",
      input.graduationYear ?? "",
      input.cgpa ?? "",
      input.careerObjective ?? "",
      toJson(input.skills ?? []),
      toJson(input.projects ?? []),
      toJson(input.experience ?? []),
      toJson(input.certifications ?? []),
      toJson(input.preferences ?? {}),
      now,
      now,
    );
  return getProfileById(Number(info.lastInsertRowid))!;
}

export function updateProfile(id: number, input: ProfileInput): Profile | null {
  const existing = getProfileById(id);
  if (!existing) return null;

  const merged = { ...existing, ...input };
  getDb()
    .prepare(
      `UPDATE profiles SET
        name = ?, email = ?, phone = ?, location = ?, preferred_work_location = ?,
        college = ?, degree = ?, branch = ?, graduation_year = ?, cgpa = ?,
        career_objective = ?, skills = ?, projects = ?, experience = ?, certifications = ?,
        preferences = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.email,
      merged.phone,
      merged.location,
      merged.preferredWorkLocation,
      merged.college,
      merged.degree,
      merged.branch,
      merged.graduationYear,
      merged.cgpa,
      merged.careerObjective,
      toJson(merged.skills),
      toJson(merged.projects),
      toJson(merged.experience),
      toJson(merged.certifications),
      toJson(merged.preferences),
      nowIso(),
      id,
    );

  return getProfileById(id);
}

/** Used by "restore sample data" — clears the single profile row. */
export function resetProfile(): void {
  getDb().prepare("DELETE FROM profiles").run();
}

export function deleteProfile(id: number): void {
  getDb().prepare("DELETE FROM profiles WHERE id = ?").run(id);
}

export function ensureProfile(input: ProfileInput = {}): Profile {
  return getProfile() ?? createProfile(input);
}

/* ------------------------------------------------------------------ */
/* Resumes                                                            */
/* ------------------------------------------------------------------ */

export type ResumeInput = {
  profileId?: number | null;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  extractedText: string;
  extractedProfile?: ExtractedProfile | null;
  analysis?: ResumeAnalysis | null;
  improvementSuggestions?: Array<{ category: string; detail: string }>;
  improvedResume?: string;
  improvedChanges?: Array<{ area: string; change: string }>;
  improvementKind?: string;
};

export function createResume(input: ResumeInput): ResumeRecord {
  const now = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO resumes (
        profile_id, original_filename, mime_type, file_size, extracted_text, extracted_profile,
        analysis, improvement_suggestions, improved_resume, improved_changes, improvement_kind,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.profileId ?? null,
      input.originalFilename,
      input.mimeType,
      input.fileSize,
      input.extractedText,
      toJson(input.extractedProfile ?? null),
      toJson(input.analysis ?? null),
      toJson(input.improvementSuggestions ?? []),
      input.improvedResume ?? "",
      toJson(input.improvedChanges ?? []),
      input.improvementKind ?? "",
      now,
      now,
    );
  return getResume(Number(info.lastInsertRowid))!;
}

function mapResume(row: Row): ResumeRecord {
  return {
    id: Number(row.id),
    profileId: row.profile_id === null ? null : Number(row.profile_id),
    originalFilename: String(row.original_filename ?? ""),
    mimeType: String(row.mime_type ?? ""),
    fileSize: Number(row.file_size ?? 0),
    extractedText: String(row.extracted_text ?? ""),
    extractedProfile: parseJson<ExtractedProfile | null>(row.extracted_profile, null),
    analysis: parseJson<ResumeAnalysis | null>(row.analysis, null),
    improvementSuggestions: parseJson<Array<{ category: string; detail: string }>>(
      row.improvement_suggestions,
      [],
    ),
    improvedResume: String(row.improved_resume ?? ""),
    improvedChanges: parseJson<Array<{ area: string; change: string }>>(row.improved_changes, []),
    improvementKind: String(row.improvement_kind ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function getResume(id: number): ResumeRecord | null {
  const row = getDb().prepare("SELECT * FROM resumes WHERE id = ?").get(id) as Row | undefined;
  return row ? mapResume(row) : null;
}

export function getLatestResume(): ResumeRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM resumes ORDER BY id DESC LIMIT 1")
    .get() as Row | undefined;
  return row ? mapResume(row) : null;
}

export function listResumes(limit = 20): ResumeRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM resumes ORDER BY id DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(mapResume);
}

export function updateResume(id: number, patch: Partial<ResumeInput>): ResumeRecord | null {
  const existing = getResume(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };

  getDb()
    .prepare(
      `UPDATE resumes SET
        extracted_profile = ?, analysis = ?, improvement_suggestions = ?, improved_resume = ?,
        improved_changes = ?, improvement_kind = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      toJson(merged.extractedProfile),
      toJson(merged.analysis),
      toJson(merged.improvementSuggestions),
      merged.improvedResume ?? "",
      toJson(merged.improvedChanges ?? []),
      merged.improvementKind ?? "",
      nowIso(),
      id,
    );

  return getResume(id);
}

/** Apply a validated resume extraction onto the stored profile. */
export function applyExtractionToProfile(resumeId: number): Profile | null {
  const resume = getResume(resumeId);
  if (!resume?.extractedProfile) return null;
  const extracted = resume.extractedProfile;

  const profile = getProfile();
  const pick = (extractedValue: string, existing: string): string =>
    extractedValue !== "Not found" && extractedValue.trim()
      ? extractedValue
      : existing;

  // Merge (never replace): skills are unioned so roadmap-verified skills the
  // user earned after this resume was written are kept, and resume skills are
  // added on top of what the profile already has. Duplicates are removed by
  // normalized comparison.
  const mergeNamed = <T extends { title?: string; name?: string; company?: string }>(
    extractedItems: T[],
    existingItems: T[],
    keyOf: (item: T) => string,
  ): T[] => {
    const result: T[] = [...existingItems];
    for (const item of extractedItems) {
      const key = normalizeSkill(keyOf(item) ?? "");
      if (key && result.some(existing => normalizeSkill(keyOf(existing) ?? "") === key)) continue;
      result.push(item);
    }
    return result;
  };

  const skills = (() => {
    const merged = [...(profile?.skills ?? [])];
    for (const skill of extracted.skills) {
      const key = normalizeSkill(skill ?? "");
      if (key && merged.some(existing => normalizeSkill(existing) === key)) continue;
      merged.push(skill);
    }
    return merged;
  })();

  const patch: ProfileInput = {
    name: pick(extracted.name, profile?.name ?? ""),
    email: pick(extracted.email, profile?.email ?? ""),
    phone: pick(extracted.phone, profile?.phone ?? ""),
    location: pick(extracted.location, profile?.location ?? ""),
    degree: pick(extracted.degree, profile?.degree ?? ""),
    branch: pick(extracted.branch, profile?.branch ?? ""),
    graduationYear: pick(extracted.graduationYear, profile?.graduationYear ?? ""),
    cgpa: pick(extracted.cgpa, profile?.cgpa ?? ""),
    careerObjective: pick(extracted.careerObjective, profile?.careerObjective ?? ""),
    skills,
    projects: mergeNamed(extracted.projects ?? [], profile?.projects ?? [], project => project.title),
    experience: mergeNamed(extracted.experience ?? [], profile?.experience ?? [], entry =>
      [entry.company, entry.role].filter(Boolean).join(" "),
    ),
    certifications: mergeNamed(extracted.certifications ?? [], profile?.certifications ?? [], cert => cert.name),
  };

  return profile ? updateProfile(profile.id, patch) : createProfile(patch);
}

/* ------------------------------------------------------------------ */
/* Opportunities + analyses                                           */
/* ------------------------------------------------------------------ */

export type OpportunityInput = {
  company?: string;
  jobTitle?: string;
  description?: string;
  location?: string;
  employmentType?: string;
  compensation?: string;
  eligibility?: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  responsibilities?: string[];
  responsibilitiesRaw?: string;
  experienceRequirement?: string;
  educationRequirement?: string;
  applicationInfo?: string;
  source?: string;
  sourceFilename?: string;
  isSample?: boolean;
};

export function createOpportunity(input: OpportunityInput): Opportunity {
  const info = getDb()
    .prepare(
      `INSERT INTO opportunities (
        company, job_title, description, location, employment_type, compensation, eligibility,
        required_skills, preferred_skills, responsibilities, responsibilities_raw,
        experience_requirement, education_requirement, application_info, source, source_filename,
        is_sample, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.company ?? "",
      input.jobTitle ?? "",
      input.description ?? "",
      input.location ?? "",
      input.employmentType ?? "",
      input.compensation ?? "",
      input.eligibility ?? "",
      toJson(input.requiredSkills ?? []),
      toJson(input.preferredSkills ?? []),
      toJson(input.responsibilities ?? []),
      input.responsibilitiesRaw ?? "",
      input.experienceRequirement ?? "",
      input.educationRequirement ?? "",
      input.applicationInfo ?? "",
      input.source ?? "text",
      input.sourceFilename ?? "",
      input.isSample ? 1 : 0,
      nowIso(),
    );
  return getOpportunity(Number(info.lastInsertRowid))!;
}

export function getOpportunity(id: number): Opportunity | null {
  const row = getDb().prepare("SELECT * FROM opportunities WHERE id = ?").get(id) as Row | undefined;
  return row ? mapOpportunity(row) : null;
}

export function listOpportunities(limit = 50, includeSamples = true): Opportunity[] {
  const sql = includeSamples
    ? "SELECT * FROM opportunities ORDER BY id DESC LIMIT ?"
    : "SELECT * FROM opportunities WHERE is_sample = 0 ORDER BY id DESC LIMIT ?";
  const rows = getDb().prepare(sql).all(limit) as Row[];
  return rows.map(mapOpportunity);
}

export function countOpportunities(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM opportunities").get() as Row;
  return Number(row.count ?? 0);
}

export function saveAnalysis(
  opportunityId: number,
  profileId: number | null,
  analysis: OpportunityAnalysis,
): OpportunityAnalysis {
  const info = getDb()
    .prepare(
      `INSERT INTO opportunity_analyses (
        opportunity_id, profile_id, match_percentage, eligibility_result, matched_skills,
        partial_skills, missing_skills, not_applicable_skills, skill_gaps, skill_rows,
        eligibility_checks, factors, explanation, trust_indicators, trust_status, engine, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      opportunityId,
      profileId,
      analysis.matchScore,
      analysis.eligibility.map(check => `${check.label}: ${check.status}`).join("; "),
      toJson(analysis.matchedSkills),
      toJson(analysis.partialSkills),
      toJson(analysis.missingSkills),
      toJson(analysis.notApplicableSkills),
      toJson(analysis.skillGaps),
      toJson(analysis.skillRows ?? []),
      toJson(analysis.eligibility),
      toJson(analysis.factors),
      analysis.explanation,
      toJson(analysis.verification),
      analysis.verification.status,
      analysis.engine,
      nowIso(),
    );
  return getAnalysis(Number(info.lastInsertRowid))!;
}

export function getAnalysis(id: number): OpportunityAnalysis | null {
  const row = getDb()
    .prepare("SELECT * FROM opportunity_analyses WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? mapAnalysis(row) : null;
}

export function getLatestAnalysisForOpportunity(opportunityId: number): OpportunityAnalysis | null {
  const row = getDb()
    .prepare("SELECT * FROM opportunity_analyses WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1")
    .get(opportunityId) as Row | undefined;
  return row ? mapAnalysis(row) : null;
}

export function listAnalyses(limit = 100): OpportunityAnalysis[] {
  const rows = getDb()
    .prepare("SELECT * FROM opportunity_analyses ORDER BY id DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(mapAnalysis);
}

/* ------------------------------------------------------------------ */
/* Roadmaps                                                           */
/* ------------------------------------------------------------------ */

export type RoadmapInput = {
  profileId?: number | null;
  opportunityId?: number | null;
  targetOpportunity?: string;
  targetSkills?: string[];
  estimatedDuration?: string;
  status?: string;
  engine?: Engine;
  items: Array<{
    skill: string;
    title: string;
    description: string;
    duration: string;
    learningObjective: string;
    practicalTask: string;
    resources: string[];
  }>;
};

export function createRoadmap(input: RoadmapInput): Roadmap {
  const db = getDb();
  const now = nowIso();

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO roadmaps (
          profile_id, opportunity_id, target_opportunity, target_skills, estimated_duration,
          status, engine, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.profileId ?? null,
        input.opportunityId ?? null,
        input.targetOpportunity ?? "",
        toJson(input.targetSkills ?? []),
        input.estimatedDuration ?? "",
        input.status ?? "active",
        input.engine ?? "rules",
        now,
        now,
      );

    const roadmapId = Number(info.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO roadmap_items (
        roadmap_id, position, skill, title, description, duration, learning_objective,
        practical_task, resources, completed, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
    );

    input.items.forEach((item, index) => {
      insertItem.run(
        roadmapId,
        index,
        item.skill,
        item.title,
        item.description,
        item.duration,
        item.learningObjective,
        item.practicalTask,
        toJson(item.resources),
        now,
      );
    });

    return roadmapId;
  });

  const roadmapId = tx();
  return getRoadmap(roadmapId)!;
}

export function getRoadmap(id: number): Roadmap | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM roadmaps WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;

  const itemRows = db
    .prepare("SELECT * FROM roadmap_items WHERE roadmap_id = ? ORDER BY position ASC, id ASC")
    .all(id) as Row[];

  return {
    id: Number(row.id),
    profileId: row.profile_id === null ? null : Number(row.profile_id),
    opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
    targetOpportunity: String(row.target_opportunity ?? ""),
    targetSkills: parseJson<string[]>(row.target_skills, []),
    estimatedDuration: String(row.estimated_duration ?? ""),
    status: String(row.status ?? "active"),
    engine: (row.engine as Engine) ?? "rules",
    items: itemRows.map(mapRoadmapItem),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function getLatestRoadmap(): Roadmap | null {
  const row = getDb().prepare("SELECT id FROM roadmaps ORDER BY id DESC LIMIT 1").get() as
    | Row
    | undefined;
  return row ? getRoadmap(Number(row.id)) : null;
}

export function getRoadmapForOpportunity(opportunityId: number): Roadmap | null {
  const row = getDb()
    .prepare("SELECT id FROM roadmaps WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1")
    .get(opportunityId) as Row | undefined;
  return row ? getRoadmap(Number(row.id)) : null;
}

export function setRoadmapItemCompletion(
  itemId: number,
  completed: boolean,
): { roadmapId: number; item: RoadmapItem; previousCompleted: boolean; remainingDays: number } | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(itemId) as Row | undefined;
  if (!row) return null;
  const previousCompleted = Number(row.completed ?? 0) === 1;

  db.prepare("UPDATE roadmap_items SET completed = ?, completed_at = ? WHERE id = ?").run(
    completed ? 1 : 0,
    completed ? nowIso() : null,
    itemId,
  );
  db.prepare("UPDATE roadmaps SET updated_at = ? WHERE id = ?").run(nowIso(), row.roadmap_id);

  // Recalculate the roadmap's remaining workload from the DB completion status
  // so the stored roadmap data always reflects the real progress.
  const roadmapId = Number(row.roadmap_id);
  const remainingDays = recomputeRoadmapRemainingDays(roadmapId);

  const updated = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(itemId) as Row;
  return { roadmapId, item: mapRoadmapItem(updated), previousCompleted, remainingDays };
}

/** Sum the pending (not completed) item durations of a roadmap, in days, and persist it. */
export function recomputeRoadmapRemainingDays(roadmapId: number): number {
  const db = getDb();
  const items = db
    .prepare("SELECT duration, completed FROM roadmap_items WHERE roadmap_id = ?")
    .all(roadmapId) as Row[];
  const remainingDays = items
    .filter(item => Number(item.completed ?? 0) !== 1)
    .reduce((sum, item) => sum + parseDurationDays(String(item.duration ?? "")), 0);
  db.prepare("UPDATE roadmaps SET estimated_duration = ? WHERE id = ?").run(
    `${remainingDays} days`,
    roadmapId,
  );
  return remainingDays;
}

export function countCompletedRoadmapItems(): { completed: number; total: number } {
  const row = getDb()
    .prepare(
      "SELECT SUM(completed) AS completed, COUNT(*) AS total FROM roadmap_items",
    )
    .get() as Row;
  return { completed: Number(row.completed ?? 0), total: Number(row.total ?? 0) };
}

/** Parse a roadmap duration string ("7 days", "3-4 days", "2 weeks") into days. */
export function parseDurationDays(duration: string): number {
  const text = (duration ?? "").toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (/week/.test(text)) return Math.round(value * 7);
  if (/month/.test(text)) return Math.round(value * 30);
  return Math.round(value);
}

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

function mapNotification(row: Row): NotificationRecord {
  return {
    id: Number(row.id),
    type: (row.type as NotificationType) ?? "system",
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    link: String(row.link ?? ""),
    read: Number(row.read ?? 0) === 1,
    createdAt: String(row.created_at ?? ""),
  };
}

export function createNotification(input: {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}): NotificationRecord {
  const info = getDb()
    .prepare(
      `INSERT INTO notifications (type, title, body, link, read, created_at) VALUES (?,?,?,?,0,?)`,
    )
    .run(input.type ?? "system", input.title, input.body ?? "", input.link ?? "", nowIso());
  const row = getDb()
    .prepare("SELECT * FROM notifications WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as Row;
  return mapNotification(row);
}

export function listNotifications(limit = 40): NotificationRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(mapNotification);
}

export function countUnreadNotifications(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE read = 0")
    .get() as Row;
  return Number(row.count ?? 0);
}

export function markNotificationRead(id: number): NotificationRecord | null {
  const existing = getDb().prepare("SELECT * FROM notifications WHERE id = ?").get(id) as
    | Row
    | undefined;
  if (!existing) return null;
  getDb().prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
  return mapNotification({ ...existing, read: 1 });
}

export function markAllNotificationsRead(): number {
  const info = getDb().prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
  return Number(info.changes ?? 0);
}

/**
 * Hard-delete ONE notification. Safe to call with any id: returns false when
 * nothing matched, and the router turns that into a 404 rather than pretending
 * it succeeded.
 */
export function deleteNotification(id: number): boolean {
  const info = getDb().prepare("DELETE FROM notifications WHERE id = ?").run(id);
  return Number(info.changes ?? 0) > 0;
}

/** Add a skill to the profile if it is not already present (normalized compare). */
export function addProfileSkill(skill: string): Profile | null {
  const cleaned = (skill ?? "").trim();
  if (!cleaned || cleaned.length > 60) return null;
  const profile = getProfile();
  if (!profile) return null;
  const key = normalizeSkill(cleaned);
  if (!key) return null;
  if (profile.skills.some(existing => normalizeSkill(existing) === key)) return profile;

  const nextSkills = [...profile.skills, cleaned];
  getDb()
    .prepare("UPDATE profiles SET skills = ?, updated_at = ? WHERE id = ?")
    .run(toJson(nextSkills), nowIso(), profile.id);
  return getProfileById(profile.id);
}

/** Distinct skills across ALL completed roadmap items — the verified/learned set. */
export function listCompletedRoadmapSkills(): string[] {
  const rows = getDb()
    .prepare("SELECT skill FROM roadmap_items WHERE completed = 1 AND TRIM(skill) != ''")
    .all() as Row[];
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const row of rows) {
    const key = normalizeSkill(String(row.skill ?? ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    skills.push(String(row.skill ?? "").trim());
  }
  return skills;
}

/* ------------------------------------------------------------------ */
/* Applications                                                       */
/* ------------------------------------------------------------------ */

export type ApplicationInput = {
  opportunityId?: number | null;
  company?: string;
  position?: string;
  matchPercentage?: number;
  status?: ApplicationStatus;
  dateApplied?: string | null;
  notes?: string;
  tailoredResume?: string;
  tailoredChanges?: Array<{ area: string; change: string }>;
  rejectionReason?: string;
  outcome?: string;
};

export function createApplication(input: ApplicationInput): Application {
  const now = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO applications (
        opportunity_id, company, position, match_percentage, status, date_applied, notes,
        tailored_resume, tailored_changes, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.opportunityId ?? null,
      input.company ?? "",
      input.position ?? "",
      input.matchPercentage ?? 0,
      input.status ?? "Saved",
      input.dateApplied ?? null,
      input.notes ?? "",
      input.tailoredResume ?? "",
      toJson(input.tailoredChanges ?? []),
      now,
      now,
    );
  return getApplication(Number(info.lastInsertRowid))!;
}

export function getApplication(id: number): Application | null {
  const row = getDb().prepare("SELECT * FROM applications WHERE id = ?").get(id) as Row | undefined;
  return row ? mapApplication(row) : null;
}

export function listApplications(): Application[] {
  const rows = getDb().prepare("SELECT * FROM applications ORDER BY id DESC").all() as Row[];
  return rows.map(mapApplication);
}

export function findApplicationByOpportunity(opportunityId: number): Application | null {
  const row = getDb()
    .prepare("SELECT * FROM applications WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1")
    .get(opportunityId) as Row | undefined;
  return row ? mapApplication(row) : null;
}

export function updateApplication(
  id: number,
  patch: Partial<ApplicationInput>,
): Application | null {
  const existing = getApplication(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };

  getDb()
    .prepare(
      `UPDATE applications SET
        company = ?, position = ?, match_percentage = ?, status = ?, date_applied = ?, notes = ?,
        tailored_resume = ?, tailored_changes = ?, rejection_reason = ?, outcome = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      merged.company,
      merged.position,
      merged.matchPercentage,
      merged.status,
      merged.dateApplied,
      merged.notes,
      merged.tailoredResume ?? "",
      toJson(merged.tailoredChanges ?? []),
      merged.rejectionReason ?? "",
      merged.outcome ?? "",
      nowIso(),
      id,
    );

  return getApplication(id);
}

export function deleteApplication(id: number): void {
  getDb().prepare("DELETE FROM applications WHERE id = ?").run(id);
}

export function countApplications(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM applications").get() as Row;
  return Number(row.count ?? 0);
}

/* ------------------------------------------------------------------ */
/* Feedback                                                           */
/* ------------------------------------------------------------------ */

export function createFeedback(input: {
  applicationId?: number | null;
  category: string;
  explanation: string;
  analysis: FeedbackAnalysis;
}): FeedbackAnalysis {
  const info = getDb()
    .prepare(
      `INSERT INTO feedback (
        application_id, rejection_category, user_explanation, analysis,
        improvement_recommendations, engine, created_at
      ) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      input.applicationId ?? null,
      input.category,
      input.explanation,
      toJson({
        area: input.analysis.area,
        insight: input.analysis.insight,
        action: input.analysis.action,
        confidence: input.analysis.confidence,
        skillsToPrioritize: input.analysis.skillsToPrioritize,
        disclaimer: input.analysis.disclaimer,
      }),
      toJson(input.analysis.recommendations),
      input.analysis.engine,
      nowIso(),
    );

  return getFeedback(Number(info.lastInsertRowid))!;
}

export function getFeedback(id: number): FeedbackAnalysis | null {
  const row = getDb().prepare("SELECT * FROM feedback WHERE id = ?").get(id) as Row | undefined;
  return row ? mapFeedback(row) : null;
}

export function listFeedback(limit = 50): FeedbackAnalysis[] {
  const rows = getDb()
    .prepare("SELECT * FROM feedback ORDER BY id DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(mapFeedback);
}

export function countFeedback(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM feedback").get() as Row;
  return Number(row.count ?? 0);
}

/* ------------------------------------------------------------------ */
/* Current opportunity pointer (single source of truth for the UI)     */
/* ------------------------------------------------------------------ */

const CURRENT_OPPORTUNITY_KEY = "current_opportunity_id";
const RESOURCE_LANGUAGE_KEY = "resource_language";

/** Raw stored pointer (may reference a row that no longer exists). */
function rawCurrentOpportunityId(): number | null {
  const raw = getMeta(CURRENT_OPPORTUNITY_KEY);
  const id = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function getCurrentOpportunityId(): number | null {
  const id = rawCurrentOpportunityId();
  if (id === null) return null;
  return getOpportunity(id) ? id : null;
}

export function setCurrentOpportunityId(id: number | null): void {
  if (id === null) {
    getDb().prepare("DELETE FROM app_meta WHERE key = ?").run(CURRENT_OPPORTUNITY_KEY);
    return;
  }
  setMeta(CURRENT_OPPORTUNITY_KEY, String(id));
}

export function getCurrentOpportunity(): Opportunity | null {
  const id = getCurrentOpportunityId();
  return id ? getOpportunity(id) : null;
}

export function getCurrentAnalysis(): OpportunityAnalysis | null {
  const id = getCurrentOpportunityId();
  if (id) return getLatestAnalysisForOpportunity(id);
  return listAnalyses(1)[0] ?? null;
}

/**
 * The roadmap that belongs to the CURRENT opportunity. Falls back to the newest
 * roadmap only when no opportunity is active, so switching opportunities always
 * swaps the roadmap shown in the UI.
 */
export function getCurrentRoadmap(): Roadmap | null {
  const id = getCurrentOpportunityId();
  if (id) {
    const roadmap = getRoadmapForOpportunity(id);
    if (roadmap) return roadmap;
  }
  return getLatestRoadmap();
}

/** Language preference for resource searches — shared across opportunities. */
export function getResourceLanguage(fallback = "English"): string {
  const value = getMeta(RESOURCE_LANGUAGE_KEY);
  return value && value.trim() ? value.trim() : fallback;
}

export function setResourceLanguage(language: string): string {
  const value = (language ?? "").trim() || "English";
  setMeta(RESOURCE_LANGUAGE_KEY, value);
  return value;
}

/* ------------------------------------------------------------------ */
/* Roadmap progress helpers                                            */
/* ------------------------------------------------------------------ */

export function roadmapProgress(roadmap: Roadmap | null): RoadmapProgress {
  const total = roadmap?.items.length ?? 0;
  const completed = roadmap ? roadmap.items.filter(item => item.completed).length : 0;
  const remaining = Math.max(0, total - completed);
  return {
    total,
    completed,
    remaining,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

export function getCurrentRoadmapProgress(): RoadmapProgress {
  return roadmapProgress(getCurrentRoadmap());
}

/** Direct (silent) completion write — used when restoring a saved snapshot. */
function setItemCompletionDirect(itemId: number, completed: boolean): void {
  const db = getDb();
  const row = db.prepare("SELECT roadmap_id FROM roadmap_items WHERE id = ?").get(itemId) as Row | undefined;
  if (!row) return;
  db.prepare("UPDATE roadmap_items SET completed = ?, completed_at = ? WHERE id = ?").run(
    completed ? 1 : 0,
    completed ? nowIso() : null,
    itemId,
  );
  db.prepare("UPDATE roadmaps SET updated_at = ? WHERE id = ?").run(nowIso(), row.roadmap_id);
  recomputeRoadmapRemainingDays(Number(row.roadmap_id));
}

export function findRoadmapItemById(itemId: number): RoadmapItem | null {
  const row = getDb().prepare("SELECT * FROM roadmap_items WHERE id = ?").get(itemId) as Row | undefined;
  return row ? mapRoadmapItem(row) : null;
}

/* ------------------------------------------------------------------ */
/* Saved Data / Opportunity history                                    */
/* ------------------------------------------------------------------ */

function mapSnapshot(row: Row, includeState = false): OpportunitySnapshot {
  const state = parseJson<OpportunitySnapshotState | null>(row.state, null);
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    company: String(row.company ?? ""),
    jobTitle: String(row.job_title ?? ""),
    matchPercentage: Number(row.match_percentage ?? 0),
    isCurrent: Number(row.is_current ?? 0) === 1,
    status: String(row.status ?? "archived"),
    progress: {
      total: Number(row.progress_total ?? 0),
      completed: Number(row.progress_completed ?? 0),
      remaining: Number(row.progress_remaining ?? 0),
      percent: Number(row.progress_percent ?? 0),
    },
    applicationStatus: String(row.application_status ?? ""),
    rejectionReason: String(row.rejection_reason ?? ""),
    hasRoadmap: Boolean(state?.roadmap),
    savedAt: String(row.saved_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    ...(includeState && state ? { state } : {}),
  };
}

export function listApplicationsForOpportunity(opportunityId: number): Application[] {
  const rows = getDb()
    .prepare("SELECT * FROM applications WHERE opportunity_id = ? ORDER BY id DESC")
    .all(opportunityId) as Row[];
  return rows.map(mapApplication);
}

export function listFeedbackForOpportunity(opportunityId: number): FeedbackAnalysis[] {
  const rows = getDb()
    .prepare(
      `SELECT f.* FROM feedback f
         JOIN applications a ON a.id = f.application_id
        WHERE a.opportunity_id = ?
        ORDER BY f.id DESC`,
    )
    .all(opportunityId) as Row[];
  return rows.map(mapFeedback);
}

/**
 * Build the complete per-opportunity state that gets archived.
 * IMPORTANT: the user's main profile is deliberately NOT part of a snapshot —
 * it stays shared and independent of every opportunity.
 */
export function buildSnapshotState(opportunityId: number): OpportunitySnapshotState {
  const roadmap = getRoadmapForOpportunity(opportunityId);
  return {
    opportunity: getOpportunity(opportunityId),
    analysis: getLatestAnalysisForOpportunity(opportunityId),
    roadmap,
    applications: listApplicationsForOpportunity(opportunityId),
    feedback: listFeedbackForOpportunity(opportunityId),
    progress: roadmapProgress(roadmap),
    savedAt: nowIso(),
    profileIncluded: false,
  };
}

export function saveOpportunitySnapshot(
  opportunityId: number,
  options: { current?: boolean; status?: string } = {},
): OpportunitySnapshot | null {
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) return null;

  const state = buildSnapshotState(opportunityId);
  const primaryApplication = state.applications[0] ?? null;
  const rejectionReason =
    primaryApplication?.rejectionReason ||
    state.feedback.find(item => item.userExplanation)?.userExplanation ||
    "";
  const now = nowIso();

  getDb()
    .prepare(
      `INSERT INTO opportunity_snapshots (
         opportunity_id, company, job_title, match_percentage, is_current, status,
         progress_total, progress_completed, progress_remaining, progress_percent,
         application_status, rejection_reason, state, saved_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(opportunity_id) DO UPDATE SET
         company = excluded.company,
         job_title = excluded.job_title,
         match_percentage = excluded.match_percentage,
         is_current = excluded.is_current,
         status = excluded.status,
         progress_total = excluded.progress_total,
         progress_completed = excluded.progress_completed,
         progress_remaining = excluded.progress_remaining,
         progress_percent = excluded.progress_percent,
         application_status = excluded.application_status,
         rejection_reason = excluded.rejection_reason,
         state = excluded.state,
         updated_at = excluded.updated_at`,
    )
    .run(
      opportunityId,
      opportunity.company,
      opportunity.jobTitle,
      state.analysis?.matchScore ?? 0,
      options.current ? 1 : 0,
      options.status ?? (options.current ? "current" : "saved"),
      state.progress.total,
      state.progress.completed,
      state.progress.remaining,
      state.progress.percent,
      primaryApplication?.status ?? "",
      rejectionReason,
      toJson(state),
      now,
      now,
    );

  return getOpportunitySnapshot(opportunityId);
}

export function listOpportunitySnapshots(includeState = false): OpportunitySnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM opportunity_snapshots ORDER BY updated_at DESC, id DESC")
    .all() as Row[];
  return rows.map(row => mapSnapshot(row, includeState));
}

export function getOpportunitySnapshot(opportunityId: number): OpportunitySnapshot | null {
  const row = getDb()
    .prepare("SELECT * FROM opportunity_snapshots WHERE opportunity_id = ?")
    .get(opportunityId) as Row | undefined;
  return row ? mapSnapshot(row, true) : null;
}

export function countOpportunitySnapshots(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM opportunity_snapshots").get() as Row;
  return Number(row.count ?? 0);
}

/**
 * Archive the currently active opportunity before the UI switches away from it,
 * then mark the new opportunity as current. Called on every new analysis and on
 * every manual switch in Saved Data.
 */
export function archiveCurrentOpportunity(): OpportunitySnapshot | null {
  const currentId = getCurrentOpportunityId();
  if (!currentId) return null;
  getDb().prepare("UPDATE opportunity_snapshots SET is_current = 0 WHERE is_current = 1").run();
  return saveOpportunitySnapshot(currentId, { current: false, status: "saved" });
}

/** Keep the current opportunity's saved snapshot in step with live progress. */
export function refreshCurrentSnapshot(): void {
  const currentId = getCurrentOpportunityId();
  if (!currentId) return;
  getDb().prepare("UPDATE opportunity_snapshots SET is_current = 0 WHERE is_current = 1").run();
  saveOpportunitySnapshot(currentId, { current: true, status: "current" });
}

/** Switch the active opportunity and restore its roadmap progress exactly. */
export function activateOpportunity(opportunityId: number): {
  opportunity: Opportunity;
  analysis: OpportunityAnalysis | null;
  roadmap: Roadmap | null;
  applications: Application[];
  progress: RoadmapProgress;
  restored: boolean;
} | null {
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) return null;

  const snapshot = getOpportunitySnapshot(opportunityId);
  const roadmap = getRoadmapForOpportunity(opportunityId);
  let restored = false;

  // Restore the saved completion state by STABLE POSITION — items are never
  // renamed or re-indexed, so a completed task stays completed in its slot.
  if (snapshot?.state?.roadmap && roadmap) {
    for (const item of roadmap.items) {
      const saved =
        snapshot.state.roadmap.items.find(savedItem => savedItem.position === item.position) ??
        snapshot.state.roadmap.items.find(
          savedItem =>
            normalizeSkill(savedItem.skill) === normalizeSkill(item.skill) &&
            savedItem.title === item.title,
        );
      if (!saved) continue;
      if (saved.completed !== item.completed) {
        setItemCompletionDirect(item.id, saved.completed);
        restored = true;
      }
    }
  }

  setCurrentOpportunityId(opportunityId);
  const freshRoadmap = getRoadmapForOpportunity(opportunityId);
  getDb().prepare("UPDATE opportunity_snapshots SET is_current = 0 WHERE is_current = 1").run();
  saveOpportunitySnapshot(opportunityId, { current: true, status: "current" });

  return {
    opportunity,
    analysis: getLatestAnalysisForOpportunity(opportunityId),
    roadmap: freshRoadmap ?? roadmap,
    applications: listApplicationsForOpportunity(opportunityId),
    progress: roadmapProgress(freshRoadmap ?? roadmap),
    restored,
  };
}

/**
 * Permanently delete an opportunity and everything attached to it: analyses,
 * roadmaps (+ items + resources), applications (+ feedback), saved history.
 * The shared profile and global skills are NEVER touched.
 */
export function deleteOpportunityCascade(opportunityId: number): {
  deleted: boolean;
  nextCurrentOpportunityId: number | null;
} {
  const db = getDb();
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) return { deleted: false, nextCurrentOpportunityId: getCurrentOpportunityId() };

  const wasCurrent = rawCurrentOpportunityId() === opportunityId;

  const tx = db.transaction(() => {
    const roadmapIds = (db.prepare("SELECT id FROM roadmaps WHERE opportunity_id = ?").all(opportunityId) as Row[]).map(
      row => Number(row.id),
    );
    const applicationIds = (
      db.prepare("SELECT id FROM applications WHERE opportunity_id = ?").all(opportunityId) as Row[]
    ).map(row => Number(row.id));

    for (const applicationId of applicationIds) {
      db.prepare("DELETE FROM feedback WHERE application_id = ?").run(applicationId);
    }
    db.prepare("DELETE FROM applications WHERE opportunity_id = ?").run(opportunityId);

    for (const roadmapId of roadmapIds) {
      db.prepare(
        "DELETE FROM learning_resources WHERE roadmap_item_id IN (SELECT id FROM roadmap_items WHERE roadmap_id = ?)",
      ).run(roadmapId);
      db.prepare("DELETE FROM roadmap_items WHERE roadmap_id = ?").run(roadmapId);
      db.prepare("DELETE FROM roadmaps WHERE id = ?").run(roadmapId);
    }

    db.prepare("DELETE FROM learning_resources WHERE opportunity_id = ?").run(opportunityId);
    db.prepare("DELETE FROM opportunity_analyses WHERE opportunity_id = ?").run(opportunityId);
    db.prepare("DELETE FROM opportunity_snapshots WHERE opportunity_id = ?").run(opportunityId);
    db.prepare("DELETE FROM opportunities WHERE id = ?").run(opportunityId);
  });
  tx();

  let nextCurrentOpportunityId: number | null = null;
  if (wasCurrent) {
    const next = db.prepare("SELECT id FROM opportunities ORDER BY id DESC LIMIT 1").get() as Row | undefined;
    nextCurrentOpportunityId = next ? Number(next.id) : null;
    setCurrentOpportunityId(nextCurrentOpportunityId);
    if (nextCurrentOpportunityId) {
      saveOpportunitySnapshot(nextCurrentOpportunityId, { current: true, status: "current" });
    }
  }

  return { deleted: true, nextCurrentOpportunityId };
}

/* ------------------------------------------------------------------ */
/* Learning resources                                                  */
/* ------------------------------------------------------------------ */

function mapLearningResource(row: Row): LearningResource {
  return {
    id: Number(row.id),
    roadmapItemId: Number(row.roadmap_item_id),
    opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
    skill: String(row.skill ?? ""),
    language: String(row.language ?? "English"),
    kind: (row.kind as ResourceKind) ?? "website",
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    source: String(row.source ?? ""),
    verified: Number(row.verified ?? 0) === 1,
    engine: (row.engine as Engine) ?? "rules",
    createdAt: String(row.created_at ?? ""),
  };
}

/** Replace the stored resources for one task + language (idempotent re-search). */
export function replaceLearningResources(input: {
  roadmapItemId: number;
  opportunityId: number | null;
  skill: string;
  language: string;
  resources: Array<Omit<LearningResource, "id" | "createdAt">>;
}): LearningResource[] {
  const db = getDb();
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM learning_resources WHERE roadmap_item_id = ? AND language = ?").run(
      input.roadmapItemId,
      input.language,
    );
    const insert = db.prepare(
      `INSERT OR REPLACE INTO learning_resources (
         roadmap_item_id, opportunity_id, skill, language, kind, title, url, source, verified, engine, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const resource of input.resources) {
      insert.run(
        input.roadmapItemId,
        input.opportunityId ?? null,
        input.skill,
        input.language,
        resource.kind,
        resource.title,
        resource.url,
        resource.source,
        resource.verified ? 1 : 0,
        resource.engine,
        now,
      );
    }
  });
  tx();
  return listLearningResources(input.roadmapItemId, input.language);
}

export function listLearningResources(roadmapItemId: number, language?: string): LearningResource[] {
  const db = getDb();
  const rows = language
    ? (db
        .prepare("SELECT * FROM learning_resources WHERE roadmap_item_id = ? AND language = ? ORDER BY id ASC")
        .all(roadmapItemId, language) as Row[])
    : (db
        .prepare("SELECT * FROM learning_resources WHERE roadmap_item_id = ? ORDER BY id ASC")
        .all(roadmapItemId) as Row[]);
  return rows.map(mapLearningResource);
}

export function listLearningResourcesForRoadmap(
  roadmapId: number,
  language?: string,
): LearningResource[] {
  const db = getDb();
  const sql = language
    ? `SELECT r.* FROM learning_resources r
         JOIN roadmap_items i ON i.id = r.roadmap_item_id
        WHERE i.roadmap_id = ? AND r.language = ?
        ORDER BY r.id ASC`
    : `SELECT r.* FROM learning_resources r
         JOIN roadmap_items i ON i.id = r.roadmap_item_id
        WHERE i.roadmap_id = ?
        ORDER BY r.id ASC`;
  const rows = language ? (db.prepare(sql).all(roadmapId, language) as Row[]) : (db.prepare(sql).all(roadmapId) as Row[]);
  return rows.map(mapLearningResource);
}

/**
 * Resources already generated for this exact skill + language, from ANY roadmap
 * item — the cache that stops repeated Gemini calls for the same skill.
 * Verified rows are preferred, duplicate URLs are collapsed.
 */
export function findReusableLearningResources(skill: string, language: string): LearningResource[] {
  const db = getDb();
  const key = skill.trim().toLowerCase();
  if (!key) return [];

  const rows = db
    .prepare("SELECT * FROM learning_resources WHERE language = ? ORDER BY verified DESC, id DESC")
    .all(language) as Row[];

  const seen = new Set<string>();
  const result: LearningResource[] = [];
  for (const row of rows) {
    const resource = mapLearningResource(row);
    if (resource.skill.trim().toLowerCase() !== key) continue;
    if (!resource.url || seen.has(resource.url)) continue;
    seen.add(resource.url);
    result.push(resource);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Accumulated rejection feedback (feeds future recommendations)       */
/* ------------------------------------------------------------------ */

export type RejectionSignal = {
  opportunityId: number | null;
  company: string;
  position: string;
  reason: string;
  category: string;
  skills: string[];
  createdAt: string;
};

export function listRejectionSignals(limit = 100): RejectionSignal[] {
  const rows = getDb()
    .prepare(
      `SELECT f.*, a.company AS app_company, a.position AS app_position, a.opportunity_id AS app_opportunity_id,
              a.rejection_reason AS app_rejection_reason
         FROM feedback f
         LEFT JOIN applications a ON a.id = f.application_id
        ORDER BY f.id DESC
        LIMIT ?`,
    )
    .all(limit) as Row[];

  const signals: RejectionSignal[] = rows.map(row => {
    const parsed = parseJson<{ skillsToPrioritize?: unknown }>(row.analysis, {});
    const skills = Array.isArray(parsed.skillsToPrioritize)
      ? (parsed.skillsToPrioritize as string[]).filter(skill => typeof skill === "string" && skill.trim())
      : [];
    return {
      opportunityId: row.app_opportunity_id === null || row.app_opportunity_id === undefined ? null : Number(row.app_opportunity_id),
      company: String(row.app_company ?? ""),
      position: String(row.app_position ?? ""),
      reason: String(row.user_explanation ?? "") || String(row.app_rejection_reason ?? ""),
      category: String(row.rejection_category ?? "Unknown"),
      skills,
      createdAt: String(row.created_at ?? ""),
    };
  });

  // Applications marked rejected without a feedback row still count as signals.
  const applicationRows = getDb()
    .prepare(
      `SELECT * FROM applications
        WHERE status = 'Rejected'
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(limit) as Row[];
  for (const row of applicationRows) {
    const app = mapApplication(row);
    signals.push({
      opportunityId: app.opportunityId,
      company: app.company,
      position: app.position,
      reason: app.rejectionReason,
      category: "Application outcome",
      skills: [],
      createdAt: app.updatedAt ?? app.createdAt,
    });
  }

  return signals;
}

export function accumulateRejectionSkillCounts(): Array<{ skill: string; count: number }> {
  const counts = new Map<string, { skill: string; count: number }>();
  for (const signal of listRejectionSignals(200)) {
    for (const skill of signal.skills) {
      const key = normalizeSkill(skill);
      if (!key) continue;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { skill: skill.trim(), count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export function listApplicationOutcomeCounts(): { selected: number; rejected: number } {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'Selected' THEN 1 ELSE 0 END) AS selected,
         SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected
       FROM applications`,
    )
    .get() as Row;
  return { selected: Number(row.selected ?? 0), rejected: Number(row.rejected ?? 0) };
}

export function findLatestOpportunityId(): number | null {
  const row = getDb().prepare("SELECT id FROM opportunities ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  return row ? Number(row.id) : null;
}
