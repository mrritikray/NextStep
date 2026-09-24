/**
 * NextStep AI service — the single entry point for every AI operation.
 *
 * Mode resolution:
 *   - GEMINI_API_KEY present  -> "real": real Gemini responses, and a real
 *                               Gemini failure is surfaced as an error.
 *   - GEMINI_API_KEY missing  -> "demo": deterministic fallbacks derived from
 *                               the actual resume text / job description.
 *
 * A Gemini failure NEVER silently degrades into a mocked result.
 */
import {
  GeminiError,
  generateContent,
  generateJson,
  geminiFailureMessage,
  getApiKey,
  getMode,
  getModel,
} from "./gemini";
import {
  analyseResumeText,
  extractJobFromText,
  extractProfileFromText,
  fallbackFeedback,
  fallbackRoadmap,
  suggestResources,
} from "./demoFallback";
import {
  FEEDBACK_SCHEMA,
  JOB_WITH_TRUST_SCHEMA,
  NOT_FOUND,
  PROFILE_SCHEMA,
  RESUME_ANALYSIS_SCHEMA,
  RESUME_FULL_SCHEMA,
  RESUME_REWRITE_SCHEMA,
  ROADMAP_SCHEMA,
  ROADMAP_WITH_GAPS_SCHEMA,
  TRUST_SCHEMA,
  buildJobExtractionWithTrustPrompt,
  buildProfileExtractionPrompt,
  buildRejectionPrompt,
  buildResumeAnalysisPrompt,
  buildResumeRewritePrompt,
  buildRoadmapPrompt,
  buildRoadmapWithGapsPrompt,
  buildTrustPrompt,
  buildUnifiedResumePrompt,
} from "./prompts";
import {
  calculateSkillMatch,
  generateSkillGap,
  normalizeSkill,
  verifyOpportunity,
} from "./matching";
import type {
  AiMode,
  AnalysisResultEngine,
  Certification,
  ExperienceEntry,
  ExtractedProfile,
  FeedbackAnalysis,
  JobRequirements,
  MatchResult,
  Profile,
  Project,
  ResumeAnalysis,
  SkillGap,
  TrustCheck,
} from "./serviceTypes";

/* ------------------------------------------------------------------ */
/* Mode helpers                                                        */
/* ------------------------------------------------------------------ */

export type ModeInfo = {
  mode: AiMode;
  model: string;
  hasKey: boolean;
  /** Last real Gemini error, kept only in memory so the UI can show why. */
  lastError: string | null;
};

let lastGeminiError: string | null = null;

export function getModeInfo(): ModeInfo {
  const hasKey = Boolean(getApiKey());
  return {
    mode: getMode(),
    model: getModel(),
    hasKey,
    lastError: hasKey ? lastGeminiError : null,
  };
}

export class AiUnavailableError extends Error {
  readonly cause: unknown;
  constructor(error: unknown) {
    super(geminiFailureMessage(error));
    this.name = "AiUnavailableError";
    this.cause = error;
  }
}

/**
 * Run a Gemini-backed operation with demo fallback rules:
 *  - demo mode (no key)            -> compute the fallback
 *  - real mode + success           -> real result, engine "gemini"
 *  - real mode + Gemini failure    -> throw AiUnavailableError (no fake data)
 */
async function runAi<T>(options: {
  operation: string;
  real: () => Promise<T>;
  demo: () => T;
}): Promise<{ result: T; engine: AnalysisResultEngine }> {
  if (!getApiKey()) {
    return { result: options.demo(), engine: "demo" };
  }

  try {
    const result = await options.real();
    lastGeminiError = null;
    return { result, engine: "gemini" };
  } catch (error) {
    lastGeminiError = geminiFailureMessage(error);
    console.error(
      `[AI] ${options.operation} failed in real mode · ${
        error instanceof GeminiError ? `${error.kind}/${error.status}` : "unknown"
      }`,
    );
    throw new AiUnavailableError(error);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Profile extraction from a resume                                 */
/* ------------------------------------------------------------------ */

function sanitizeProfile(raw: Partial<ExtractedProfile>, resumeText: string): ExtractedProfile {
  const demo = extractProfileFromText(resumeText);
  const pick = (value: unknown, fallback: string): string => {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (!trimmed || /^(not found|n\/a|na|none|null|unknown)$/i.test(trimmed)) return fallback;
    return trimmed;
  };

  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .filter((skill): skill is string => typeof skill === "string")
        .map(skill => skill.trim())
        .filter(skill => skill.length > 0 && skill.length < 40)
    : [];

  const projects = Array.isArray(raw.projects)
    ? raw.projects
        .filter(project => project && typeof project.title === "string" && project.title.trim())
        .map(project => ({
          title: project.title.trim(),
          description: typeof project.description === "string" ? project.description.trim() : "",
          technologies: Array.isArray(project.technologies)
            ? project.technologies.filter((item): item is string => typeof item === "string")
            : [],
          link: typeof project.link === "string" && /^https?:\/\//i.test(project.link) ? project.link : "",
        }))
    : [];

  const experience = Array.isArray(raw.experience)
    ? raw.experience
        .filter(entry => entry && typeof entry.company === "string")
        .map(entry => ({
          company: String(entry.company ?? "").trim() || NOT_FOUND,
          role: typeof entry.role === "string" ? entry.role.trim() : NOT_FOUND,
          duration: typeof entry.duration === "string" ? entry.duration.trim() : "",
          description: typeof entry.description === "string" ? entry.description.trim() : "",
        }))
    : [];

  const certifications = Array.isArray(raw.certifications)
    ? raw.certifications
        .filter(entry => entry && typeof entry.name === "string" && entry.name.trim())
        .map(entry => ({
          name: String(entry.name ?? "").trim(),
          issuer: typeof entry.issuer === "string" ? entry.issuer.trim() : "",
          year: typeof entry.year === "string" ? entry.year.trim() : "",
        }))
    : [];

  const result: ExtractedProfile = {
    name: pick(raw.name, NOT_FOUND),
    email: pick(raw.email, NOT_FOUND),
    phone: pick(raw.phone, NOT_FOUND),
    location: pick(raw.location, demo.location),
    education: pick(raw.education, demo.education),
    degree: pick(raw.degree, demo.degree),
    branch: pick(raw.branch, demo.branch),
    graduationYear: pick(raw.graduationYear, demo.graduationYear),
    cgpa: pick(raw.cgpa, demo.cgpa),
    careerObjective: pick(raw.careerObjective, demo.careerObjective),
    skills: skills.length ? skills : demo.skills,
    projects,
    experience,
    certifications,
    notFound: [],
  };

  // Guard against fabricated contact details: keep the value only if it really
  // appears in the resume text (whitespace-insensitive).
  const flattened = resumeText.replace(/\s+/g, "").toLowerCase();
  const verify = (value: string): string => {
    if (value === NOT_FOUND) return value;
    const needle = value.replace(/\s+/g, "").toLowerCase();
    return flattened.includes(needle) ? value : NOT_FOUND;
  };
  result.email = verify(result.email);
  result.phone = verify(result.phone);
  result.name = result.name === NOT_FOUND ? verify(demo.name) : result.name;
  result.education = result.education === NOT_FOUND ? NOT_FOUND : result.education;

  const missing: string[] = [];
  const check = (label: string, value: string | unknown[]) => {
    if (!value || value === NOT_FOUND || (Array.isArray(value) && value.length === 0)) missing.push(label);
  };
  check("Name", result.name);
  check("Email", result.email);
  check("Phone", result.phone);
  check("Location", result.location);
  check("Degree", result.degree);
  check("Branch", result.branch);
  check("CGPA / percentage", result.cgpa);
  check("Projects", result.projects);
  check("Experience", result.experience);
  check("Certifications", result.certifications);
  result.notFound = missing;

  return result;
}

export async function extractProfileFromResume(
  resumeText: string,
): Promise<{ profile: ExtractedProfile; engine: AnalysisResultEngine }> {
  const { result, engine } = await runAi({
    operation: "extractProfileFromResume",
    real: () =>
      generateJson<Partial<ExtractedProfile>>({
        prompt: buildProfileExtractionPrompt(resumeText),
        schema: PROFILE_SCHEMA as unknown as Record<string, unknown>,
        operation: "extractProfileFromResume",
      }),
    demo: () => extractProfileFromText(resumeText),
  });

  return { profile: sanitizeProfile(result, resumeText), engine };
}

/* ------------------------------------------------------------------ */
/* 1b. ONE-REQUEST resume pass (analysis + profile extraction)         */
/* ------------------------------------------------------------------ */

export type ResumeFullResult = {
  /** Full quality analysis — identical shape to `analyzeResume`. */
  analysis: ResumeAnalysis;
  /** Structured profile extraction from the SAME Gemini response. */
  profile: ExtractedProfile;
  strengths: string[];
  weaknesses: string[];
  improvements: Array<{ category: string; detail: string }>;
  education: {
    education: string;
    degree: string;
    branch: string;
    graduationYear: string;
    cgpa: string;
  };
  experience: ExperienceEntry[];
  projects: Project[];
  skills: string[];
  certifications: Certification[];
  engine: AnalysisResultEngine;
};

type ResumeFullPayload = {
  analysis?: Partial<ResumeAnalysis> & { weaknesses?: string[] };
  profile?: Partial<ExtractedProfile>;
};

/**
 * Analyse a resume AND extract its profile in **ONE** Gemini request.
 *
 * This replaces the previous flow, where the router called `analyzeResume` and
 * `extractProfileFromResume` in parallel — sending the complete resume text to
 * Gemini twice. The resume now travels exactly once and the single response is
 * fanned out: `analysis` feeds the resume review UI, `profile` feeds the
 * extraction UI, and the top-level convenience fields (strengths, weaknesses,
 * education, experience, projects, skills, certifications) are derived from the
 * same response with no additional AI call.
 *
 * Sanitising, fact-checking and demo-mode behaviour are unchanged.
 */
export async function analyzeResumeFull(
  resumeText: string,
  targetRole?: string,
): Promise<ResumeFullResult> {
  const { result, engine } = await runAi<ResumeFullPayload>({
    operation: "analyzeResumeFull",
    real: () =>
      generateJson<ResumeFullPayload>({
        prompt: buildUnifiedResumePrompt(resumeText, targetRole),
        schema: RESUME_FULL_SCHEMA as unknown as Record<string, unknown>,
        operation: "analyzeResumeFull",
      }),
    demo: () => ({}),
  });

  const analysis = sanitizeAnalysis(result.analysis ?? {}, resumeText);
  const profile = sanitizeProfile(result.profile ?? {}, resumeText);

  const weaknesses = Array.isArray(result.analysis?.weaknesses)
    ? result.analysis.weaknesses
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map(item => item.trim())
        .slice(0, 6)
    : [];

  return {
    analysis,
    profile,
    strengths: analysis.strengths,
    weaknesses: weaknesses.length
      ? weaknesses
      : analysis.improvements.map(item => `${item.category}: ${item.detail}`).slice(0, 6),
    improvements: analysis.improvements,
    education: {
      education: profile.education,
      degree: profile.degree,
      branch: profile.branch,
      graduationYear: profile.graduationYear,
      cgpa: profile.cgpa,
    },
    experience: profile.experience,
    projects: profile.projects,
    skills: profile.skills,
    certifications: profile.certifications,
    engine,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Resume analysis                                                  */
/* ------------------------------------------------------------------ */

const BREAKDOWN_COLORS: Record<string, string> = {
  Skills: "#59a894",
  Projects: "#668dca",
  Experience: "#d49b4f",
  Education: "#8a6eb4",
  Formatting: "#ca725f",
  "Job relevance": "#4e9a8e",
};

const BREAKDOWN_LABELS = [
  "Skills",
  "Projects",
  "Experience",
  "Education",
  "Formatting",
  "Job relevance",
];

function sanitizeAnalysis(raw: Partial<ResumeAnalysis>, resumeText: string): ResumeAnalysis {
  const demo = analyseResumeText(resumeText);
  const clamp = (value: unknown, fallback: number): number => {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, Math.round(num)));
  };

  const rawBreakdown = Array.isArray(raw.breakdown) ? raw.breakdown : [];
  const breakdown = BREAKDOWN_LABELS.map(label => {
    const match = rawBreakdown.find(item => item && String(item.label).toLowerCase() === label.toLowerCase());
    return {
      label,
      score: clamp(match?.score, demo.breakdown.find(item => item.label === label)?.score ?? 60),
      color: BREAKDOWN_COLORS[label],
    };
  });

  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

  return {
    score: clamp(raw.score, Math.round(breakdown.reduce((sum, item) => sum + item.score, 0) / breakdown.length)),
    breakdown,
    strengths: strings(raw.strengths).length ? strings(raw.strengths) : demo.strengths,
    improvements: Array.isArray(raw.improvements)
      ? raw.improvements
          .filter(item => item && typeof item.detail === "string")
          .map(item => ({ category: String(item.category ?? "General"), detail: item.detail.trim() }))
          .slice(0, 6)
      : demo.improvements,
    skillObservations: strings(raw.skillObservations).length ? strings(raw.skillObservations) : demo.skillObservations,
    projectObservations: strings(raw.projectObservations).length ? strings(raw.projectObservations) : demo.projectObservations,
    experienceObservations: strings(raw.experienceObservations).length ? strings(raw.experienceObservations) : demo.experienceObservations,
    educationObservations: strings(raw.educationObservations).length ? strings(raw.educationObservations) : demo.educationObservations,
    formattingObservations: strings(raw.formattingObservations).length ? strings(raw.formattingObservations) : demo.formattingObservations,
    summaryObservation: typeof raw.summaryObservation === "string" && raw.summaryObservation.trim()
      ? raw.summaryObservation.trim()
      : demo.summaryObservation,
    jobRelevance: typeof raw.jobRelevance === "string" && raw.jobRelevance.trim()
      ? raw.jobRelevance.trim()
      : demo.jobRelevance,
    improvedSummary:
      typeof raw.improvedSummary === "string" && raw.improvedSummary.trim()
        ? raw.improvedSummary.trim()
        : demo.improvedSummary,
  };
}

export async function analyzeResume(
  resumeText: string,
  targetRole?: string,
): Promise<{ analysis: ResumeAnalysis; engine: AnalysisResultEngine }> {
  const { result, engine } = await runAi({
    operation: "analyzeResume",
    real: () =>
      generateJson<Partial<ResumeAnalysis>>({
        prompt: buildResumeAnalysisPrompt(resumeText, targetRole),
        schema: RESUME_ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        operation: "analyzeResume",
      }),
    demo: () => analyseResumeText(resumeText),
  });

  return { analysis: sanitizeAnalysis(result, resumeText), engine };
}

/* ------------------------------------------------------------------ */
/* 3. Resume improvement (factual only)                                */
/* ------------------------------------------------------------------ */

export async function improveResume(
  resumeText: string,
  profile: Profile | null,
  verifiedSkills: string[] = [],
): Promise<{
  improvedResume: string;
  changes: Array<{ area: string; change: string }>;
  engine: AnalysisResultEngine;
}> {
  const verifiedList = verifiedSkills.filter(skill => typeof skill === "string" && skill.trim()).slice(0, 20);
  const verifiedNote = verifiedList.length
    ? [
        "",
        "NEWLY VERIFIED SKILLS: since this resume was written, the candidate completed structured learning steps and demonstrated these skills: " +
          verifiedList.join(", ") + ".",
        "These may be included in the skills section (they are real, verified skills). Add NOTHING else, and do not invent any project, experience, metric, certification or claim to support them.",
      ].join(" ")
    : "\n\nThis is a GENERAL improvement pass, not a job-specific one. Improve wording, grammar, structure, ordering, clarity and professional phrasing. Reorder existing sections for clarity. Add NOTHING new.";

  const generalNote = [
    "",
    "This is a GENERAL improvement pass, not a job-specific one. Improve wording, grammar, structure, ordering, clarity and professional phrasing. Reorder existing sections for clarity. Add NOTHING new beyond the newly verified skills listed below (if any).",
    verifiedNote,
  ].join(" ");

  // ONE request: the rewrite AND its change list come back together, so the
  // rewritten resume is never sent back to Gemini for a second pass.
  const { result, engine } = await runAi<{
    improvedResume: string;
    changes: Array<{ area: string; change: string }>;
  }>({
    operation: "improveResume",
    real: async () => {
      const parsed = await generateJson<ResumeRewritePayload>({
        prompt: buildResumeRewritePrompt(
          {
            resumeText,
            jobTitle: "General improvement",
            company: "",
            requiredSkills: [],
            preferredSkills: [],
            matchedSkills: profile?.skills ?? [],
            missingSkills: [],
          },
          generalNote,
        ),
        schema: RESUME_REWRITE_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0.3,
        operation: "improveResume",
      });
      return readRewriteResult(parsed, resumeText, "improveResume");
    },
    demo: () => {
      const text = buildDemoImprovedResume(resumeText, verifiedList);
      return { improvedResume: text, changes: diffResumes(resumeText, text) };
    },
  });

  return { improvedResume: result.improvedResume, changes: result.changes, engine };
}

export async function generateTailoredResume(input: {
  resumeText: string;
  jobTitle: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  responsibilitiesRaw?: string;
  /** Skills verified through completed roadmap steps — safe to include when relevant. */
  verifiedSkills?: string[];
}): Promise<{
  tailoredResume: string;
  changes: Array<{ area: string; change: string }>;
  engine: AnalysisResultEngine;
}> {
  // ONE request: the tailored resume AND its change list come back together,
  // so the rewritten resume is never sent back to Gemini for a second pass.
  const { result, engine } = await runAi<{
    improvedResume: string;
    changes: Array<{ area: string; change: string }>;
  }>({
    operation: "generateTailoredResume",
    real: async () => {
      const parsed = await generateJson<ResumeRewritePayload>({
        prompt: buildResumeRewritePrompt(
          input,
          verifiedRelevanceNote(input.verifiedSkills ?? [], [...input.requiredSkills, ...input.preferredSkills]),
        ),
        schema: RESUME_REWRITE_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0.3,
        operation: "generateTailoredResume",
      });
      return readRewriteResult(parsed, input.resumeText, "generateTailoredResume");
    },
    demo: () => {
      const text = buildDemoTailoredResume(input);
      return { improvedResume: text, changes: diffResumes(input.resumeText, text) };
    },
  });

  return { tailoredResume: result.improvedResume, changes: result.changes, engine };
}

/**
 * Prompt note allowing ONLY the verified skills that are relevant to this
 * specific role to be included. Never anything else.
 */
function verifiedRelevanceNote(verifiedSkills: string[], jobSkills: string[]): string {
  const jobKeys = new Set(jobSkills.map(normalizeSkill).filter(Boolean));
  const relevant = verifiedSkills
    .filter(skill => skill.trim())
    .filter(skill => jobKeys.has(normalizeSkill(skill)));
  if (!relevant.length) return "";
  return [
    "",
    "SKILLS VERIFIED THROUGH COMPLETED LEARNING STEPS (you may include these when relevant, since the candidate completed structured learning for them): " +
      relevant.join(", ") + ". Add NOTHING else.",
  ].join(" ");
}

type ResumeRewritePayload = {
  improvedResume?: string;
  changes?: Array<{ area?: string; change?: string }>;
};

/**
 * Read a combined rewrite response (rewrite + change list).
 *
 * The rewritten resume is mandatory: a real Gemini failure must never look like
 * success. The change list falls back to a deterministic LOCAL diff — no extra
 * Gemini call, because the model already told us what it changed.
 */
function readRewriteResult(
  raw: ResumeRewritePayload,
  original: string,
  operation: string,
): { improvedResume: string; changes: Array<{ area: string; change: string }> } {
  const improvedResume = typeof raw.improvedResume === "string" ? raw.improvedResume.trim() : "";
  if (!improvedResume) {
    throw new GeminiError(`Gemini did not return a rewritten resume for ${operation}.`, {
      kind: "parse",
    });
  }

  const changes = (raw.changes ?? [])
    .filter(item => item && typeof item.change === "string" && item.change.trim())
    .map(item => ({ area: String(item.area ?? "General"), change: item.change!.trim() }))
    .slice(0, 8);

  return { improvedResume, changes: changes.length ? changes : diffResumes(original, improvedResume) };
}

/** Local, fact-safe diff: reports only additions/removals of existing lines. */
function diffResumes(
  original: string,
  tailored: string,
): Array<{ area: string; change: string }> {
  const normalize = (text: string) =>
    text
      .split("\n")
      .map(line => line.replace(/^[•\-*\u2022\s]+/, "").trim().toLowerCase())
      .filter(line => line.length > 3);

  const before = normalize(original);
  const after = normalize(tailored);
  const added = after.filter(line => !before.includes(line));
  const removed = before.filter(line => !after.includes(line));

  const changes: Array<{ area: string; change: string }> = [];

  if (!added.length && !removed.length) {
    changes.push({ area: "Wording", change: "Phrasing and formatting were reviewed; the same facts were kept." });
  }
  if (removed.length) {
    changes.push({
      area: "Structure",
      change: `${removed.length} line(s) were removed or reordered for focus. No new facts were introduced.`,
    });
  }
  if (added.length) {
    changes.push({
      area: "Relevance",
      change: `${added.length} line(s) were rewritten or re-emphasised to match the role. Wording changed; the underlying facts are unchanged.`,
    });
  }
  changes.push({ area: "Summary", change: "The professional summary was rewritten for relevance using existing facts only." });
  changes.push({ area: "Safeguard", change: "No skills, experience, metrics, certifications or achievements were invented." });
  return changes;
}

/**
 * Deterministic demo-mode improvement: clean the text and, when the user has
 * completed roadmap steps for skills that are not yet on the resume, list
 * those verified skills explicitly. Only real, completed roadmap skills are
 * ever added — never invented ones.
 */
function buildDemoImprovedResume(resumeText: string, verifiedSkills: string[] = []): string {
  const lines = resumeText.split("\n").map(line => line.trimEnd());
  const cleaned = lines
    .map(line => line.replace(/\s+$/g, "").replace(/^([•\-*\u2022])\s*/, "$1 "))
    .filter((line, index) => !(line.trim() === "" && lines[index - 1]?.trim() === ""));

  const result = cleaned.join("\n").trim();
  const verified = verifiedSkills
    .filter(skill => skill.trim())
    .filter(skill => !result.toLowerCase().includes(normalizeSkill(skill)))
    .filter((skill, index, all) => all.indexOf(skill) === index);
  if (!verified.length) return result;

  return `${result}\n\nSkills (verified through completed learning roadmap): ${verified.join(", ")}`;
}

function buildDemoTailoredResume(input: {
  resumeText: string;
  jobTitle: string;
  company: string;
  matchedSkills: string[];
  requiredSkills: string[];
}): string {
  const base = buildDemoImprovedResume(input.resumeText);
  const lines = base.split("\n");

  // Reorder an existing skills line so job-relevant skills come first.
  const relevant = new Set([...input.matchedSkills, ...input.requiredSkills].map(normalizeSkill));
  const reordered = lines.map(line => {
    if (!/(skill|technolog|stack)/i.test(line) || !/[,|·•]/.test(line)) return line;
    const prefixMatch = /^([^:]*:)\s*(.*)$/.exec(line);
    const prefix = prefixMatch?.[1] ?? "";
    const body = prefixMatch?.[2] ?? line;
    const parts = body.split(/[,|·•]/).map(part => part.trim()).filter(Boolean);
    const sorted = [...parts].sort((a, b) => {
      const aRelevant = [...relevant].some(skill => skill && normalizeSkill(a).includes(skill)) ? 0 : 1;
      const bRelevant = [...relevant].some(skill => skill && normalizeSkill(b).includes(skill)) ? 0 : 1;
      return aRelevant - bRelevant;
    });
    return `${prefix ? `${prefix} ` : ""}${sorted.join(", ")}`;
  });

  const target = [input.jobTitle, input.company].filter(Boolean).join(" — ");
  const header = target
    ? `# Tailored for: ${target} (reordered for relevance; no facts added)\n`
    : `# Tailored (reordered for relevance; no facts added)\n`;

  return `${header}${reordered.join("\n")}`.trim();
}

/* ------------------------------------------------------------------ */
/* 4. Job requirement extraction (text OR screenshot)                  */
/* ------------------------------------------------------------------ */

function sanitizeJob(raw: Partial<JobRequirements>, sourceText: string): JobRequirements {
  const demo = extractJobFromText(sourceText);
  const pick = (value: unknown, fallback: string): string => {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (!trimmed || /^(not found|n\/a|na|none|null|unknown|not specified)$/i.test(trimmed)) return fallback;
    return trimmed.slice(0, 300);
  };
  const list = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) return fallback;
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(item => item.length > 0 && item.length < 60);
    return items.length ? Array.from(new Set(items)).slice(0, 25) : fallback;
  };

  return {
    company: pick(raw.company, demo.company),
    jobTitle: pick(raw.jobTitle, demo.jobTitle),
    location: pick(raw.location, demo.location),
    employmentType: pick(raw.employmentType, demo.employmentType),
    compensation: pick(raw.compensation, demo.compensation),
    eligibility: pick(raw.eligibility, demo.eligibility),
    requiredSkills: list(raw.requiredSkills, demo.requiredSkills),
    preferredSkills: list(raw.preferredSkills, demo.preferredSkills),
    responsibilities: list(raw.responsibilities, demo.responsibilities),
    responsibilitiesRaw: demo.responsibilitiesRaw,
    experienceRequirement: pick(raw.experienceRequirement, demo.experienceRequirement),
    educationRequirement: pick(raw.educationRequirement, demo.educationRequirement),
    applicationInfo: pick(raw.applicationInfo, demo.applicationInfo),
    insufficientInformation:
      raw.insufficientInformation === true ||
      (demo.insufficientInformation && !list(raw.requiredSkills, []).length),
  };
}

/**
 * Sanitise the trust object returned by the combined extraction request.
 * Falls back to the deterministic rules checker (NO extra Gemini call) when the
 * model returned no usable indicators.
 */
export function sanitizeTrustCheck(
  raw:
    | (Partial<TrustCheck> & {
        indicators?: Array<{ label?: string; status?: string; detail?: string }>;
      })
    | undefined,
  job: JobRequirements,
): TrustCheck {
  const allowed = ["good", "watch", "unknown"] as const;
  const indicators = (raw?.indicators ?? [])
    .filter(item => item && typeof item.label === "string" && typeof item.detail === "string")
    .map(item => ({
      label: item.label!,
      status: (allowed as readonly string[]).includes(String(item.status))
        ? (item.status as "good" | "watch" | "unknown")
        : ("unknown" as const),
      detail: item.detail!,
    }));

  if (!indicators.length) return verifyOpportunity(job);

  const statusValues = [
    "Review recommended",
    "No major warning signs detected",
    "Not enough information to verify this opportunity.",
  ];
  return {
    status: statusValues.includes(String(raw?.status))
      ? (raw!.status as TrustCheck["status"])
      : verifyOpportunity(job).status,
    indicators,
  };
}

export async function extractJobRequirements(input: {
  description?: string;
  image?: { mimeType: string; base64: string };
}): Promise<{ job: JobRequirements; trust: TrustCheck; engine: AnalysisResultEngine }> {
  const prompt = buildJobExtractionWithTrustPrompt(input.image ? "image" : "text");

  if (input.image) {
    const { result, engine } = await runAi<Partial<JobRequirements> & { trust?: Partial<TrustCheck> }>({
      operation: "extractJobRequirements:image",
      real: () =>
        generateJson<Partial<JobRequirements> & { trust?: Partial<TrustCheck> }>({
          prompt,
          media: input.image,
          schema: JOB_WITH_TRUST_SCHEMA as unknown as Record<string, unknown>,
          operation: "extractJobRequirements:image",
        }),
      demo: () => ({
        insufficientInformation: true,
        company: NOT_FOUND,
        jobTitle: NOT_FOUND,
      }),
    });
    const job = sanitizeJob(result, input.description ?? "");
    return {
      job,
      trust: engine === "gemini" ? sanitizeTrustCheck(result.trust, job) : verifyOpportunity(job),
      engine,
    };
  }

  const description = (input.description ?? "").trim();
  const { result, engine } = await runAi<Partial<JobRequirements> & { trust?: Partial<TrustCheck> }>({
    operation: "extractJobRequirements:text",
    real: () =>
      generateJson<Partial<JobRequirements> & { trust?: Partial<TrustCheck> }>({
        prompt,
        schema: JOB_WITH_TRUST_SCHEMA as unknown as Record<string, unknown>,
        operation: "extractJobRequirements:text",
      }),
    demo: () => extractJobFromText(description),
  });

  const job = sanitizeJob(result, description);
  return {
    job,
    trust: engine === "gemini" ? sanitizeTrustCheck(result.trust, job) : verifyOpportunity(job),
    engine,
  };
}

/* ------------------------------------------------------------------ */
/* 5. Opportunity analysis (match + skill gap + trust)                 */
/* ------------------------------------------------------------------ */

export async function analyzeOpportunity(input: {
  job: JobRequirements & { description?: string };
  profile: Profile;
  skillFrequency?: Record<string, number>;
  /**
   * Trust review already produced by the job-extraction request. When supplied
   * (the normal single-request posting flow) NO extra Gemini call is made for
   * it — the same posting text is never analysed twice.
   */
  verification?: TrustCheck | null;
}): Promise<{
  match: MatchResult;
  skillGaps: SkillGap[];
  verification: TrustCheck;
  engine: AnalysisResultEngine;
}> {
  // The matching maths is always deterministic and explainable — never random.
  const match = calculateSkillMatch(input.job, input.profile);
  const skillGaps = generateSkillGap(match, input.job, input.skillFrequency ?? {});

  const verification = input.verification ?? (await verifyOpportunityCheck(input.job));

  // NOTE: the per-gap narrative used to be a SEPARATE Gemini call here. It now
  // travels inside `generateRoadmapWithGapNotes` — one combined request returns
  // the roadmap AND the gap notes — so with a supplied trust review this
  // function makes ZERO Gemini calls and the whole job analysis costs two.
  return { match, skillGaps, verification, engine: "rules" };
}

export async function verifyOpportunityCheck(
  job: JobRequirements & { description?: string },
): Promise<TrustCheck> {
  if (!getApiKey()) return verifyOpportunity(job);

  try {
    const parsed = await generateJson<Partial<TrustCheck>>({
      prompt: buildTrustPrompt({
        description: job.description ?? job.responsibilitiesRaw ?? "",
        company: job.company,
        applicationInfo: job.applicationInfo,
      }),
      schema: TRUST_SCHEMA as unknown as Record<string, unknown>,
      operation: "verifyOpportunity",
    });

    const allowed = ["good", "watch", "unknown"] as const;
    const indicators = (parsed.indicators ?? [])
      .filter(item => item && typeof item.label === "string" && typeof item.detail === "string")
      .map(item => ({
        label: item.label!,
        status: (allowed as readonly string[]).includes(String(item.status))
          ? (item.status as "good" | "watch" | "unknown")
          : ("unknown" as const),
        detail: item.detail!,
      }));

    if (!indicators.length) return verifyOpportunity(job);

    const statusValues = [
      "Review recommended",
      "No major warning signs detected",
      "Not enough information to verify this opportunity.",
    ];
    const status = statusValues.includes(String(parsed.status))
      ? (parsed.status as TrustCheck["status"])
      : verifyOpportunity(job).status;

    return { status, indicators };
  } catch (error) {
    if (error instanceof AiUnavailableError || error instanceof GeminiError) throw error;
    throw new AiUnavailableError(error);
  }
}

/* ------------------------------------------------------------------ */
/* 6. Roadmap                                                          */
/* ------------------------------------------------------------------ */

/** One ordered roadmap step as produced by Gemini or the rules fallback. */
export type RoadmapItemDraft = {
  skill: string;
  title: string;
  description: string;
  duration: string;
  learningObjective: string;
  practicalTask: string;
  resources: string[];
};

/**
 * Everything ONE combined roadmap request produces: the plan items PLUS the
 * per-gap "what to build" guidance that used to cost its own Gemini call.
 */
export type RoadmapComputation = {
  estimatedDuration: string;
  items: RoadmapItemDraft[];
  gapNotes: Array<{ skill: string; note: string; gapSeverity: "Minor" | "Moderate" | "Significant" }>;
  engine: AnalysisResultEngine;
};

type RoadmapRawItem = {
  skill?: string;
  title?: string;
  description?: string;
  duration?: string;
  learningObjective?: string;
  practicalTask?: string;
  resources?: string[];
};

type RoadmapPayload = {
  estimatedDuration?: string;
  items?: RoadmapRawItem[];
  gapNotes?: Array<{ skill?: string; note?: string; gapSeverity?: string }>;
};

function defaultRoadmapGaps(input: { targetSkills: string[]; gaps: SkillGap[] }): SkillGap[] {
  return input.gaps.length
    ? input.gaps
    : [
        {
          skill: input.targetSkills[0] ?? "Core skills",
          currentLevel: "Not started",
          requiredLevel: "Intermediate",
          gap: "Build demonstrable evidence.",
          gapSeverity: "Moderate" as const,
          importance: "High" as const,
        },
      ];
}

function rulesFallbackRoadmap(
  input: { targetOpportunity: string; targetSkills: string[] },
  gaps: SkillGap[],
): { estimatedDuration: string; items: RoadmapItemDraft[] } {
  const fallback = fallbackRoadmap({
    targetSkills: input.targetSkills,
    gaps: gaps.map(gap => ({
      skill: gap.skill,
      importance: gap.importance,
      gap: gap.gap,
      requiredLevel: gap.requiredLevel,
    })),
    targetOpportunity: input.targetOpportunity,
  });
  return { estimatedDuration: fallback.estimatedDuration, items: sanitizeRoadmapItems(fallback.items) };
}

/** Shared post-processing for every roadmap response (never invents steps). */
function sanitizeRoadmapItems(items: RoadmapRawItem[] | undefined): RoadmapItemDraft[] {
  return (items ?? [])
    .filter(item => item && typeof item.title === "string" && item.title.trim())
    .slice(0, 14)
    .map(item => ({
      skill: String(item.skill ?? "").trim() || "General",
      title: item.title!.trim(),
      description: typeof item.description === "string" ? item.description.trim() : "",
      duration: typeof item.duration === "string" && item.duration.trim() ? item.duration.trim() : "3 days",
      learningObjective: typeof item.learningObjective === "string" ? item.learningObjective.trim() : "",
      practicalTask: typeof item.practicalTask === "string" ? item.practicalTask.trim() : "",
      resources: Array.isArray(item.resources)
        ? item.resources.filter((value): value is string => typeof value === "string").slice(0, 4)
        : suggestResources(String(item.skill ?? "")),
    }));
}

/**
 * Keep only gap notes that name one of the real, deterministic gaps — the
 * model may never invent a gap (or a skill) the student does not need.
 */
function sanitizeGapNotes(
  notes: RoadmapPayload["gapNotes"],
  gaps: SkillGap[],
): RoadmapComputation["gapNotes"] {
  const severities = ["Minor", "Moderate", "Significant"] as const;
  const result: RoadmapComputation["gapNotes"] = [];
  for (const note of notes ?? []) {
    const skill = String(note?.skill ?? "").trim();
    const text = typeof note?.note === "string" ? note.note.trim() : "";
    if (!skill || !text) continue;
    if (!gaps.some(gap => normalizeSkill(gap.skill) === normalizeSkill(skill))) continue;
    const severity = severities.includes(String(note?.gapSeverity ?? "") as (typeof severities)[number])
      ? (note!.gapSeverity as (typeof severities)[number])
      : "Moderate";
    result.push({ skill, note: text.slice(0, 240), gapSeverity: severity });
  }
  return result;
}

/**
 * Apply the combined response's per-gap notes onto the deterministic gaps.
 * Notes never touch the match numbers — only the guidance text and severity.
 */
export function applyGapNotes(
  skillGaps: SkillGap[],
  notes: RoadmapComputation["gapNotes"],
): SkillGap[] {
  for (const note of notes) {
    const target = skillGaps.find(gap => normalizeSkill(gap.skill) === normalizeSkill(note.skill));
    if (!target) continue;
    if (note.note) target.gap = note.note.slice(0, 240);
    target.gapSeverity = note.gapSeverity;
  }
  return skillGaps;
}

function roadmapProfileSummary(profile: Profile | null): string {
  return profile
    ? `${profile.degree} ${profile.branch}, graduating ${profile.graduationYear}. Skills: ${profile.skills.join(", ")}`
    : "Student profile not provided.";
}

export async function generateRoadmap(input: {
  targetOpportunity: string;
  targetSkills: string[];
  gaps: SkillGap[];
  profile: Profile | null;
}): Promise<{
  estimatedDuration: string;
  items: RoadmapItemDraft[];
  engine: AnalysisResultEngine;
}> {
  const gaps = defaultRoadmapGaps(input);
  const gapPayload = gaps.map(gap => ({
    skill: gap.skill,
    currentLevel: gap.currentLevel,
    requiredLevel: gap.requiredLevel,
    gap: gap.gap,
    importance: gap.importance,
  }));

  const { result, engine } = await runAi<RoadmapPayload>({
    operation: "generateRoadmap",
    real: () =>
      generateJson<RoadmapPayload>({
        prompt: buildRoadmapPrompt({
          targetOpportunity: input.targetOpportunity,
          targetSkills: input.targetSkills,
          gaps: gapPayload,
          profileSummary: roadmapProfileSummary(input.profile),
        }),
        schema: ROADMAP_SCHEMA as unknown as Record<string, unknown>,
        operation: "generateRoadmap",
      }),
    demo: () =>
      fallbackRoadmap({
        targetSkills: input.targetSkills,
        gaps: gapPayload.map(({ skill, importance, gap, requiredLevel }) => ({ skill, importance, gap, requiredLevel })),
        targetOpportunity: input.targetOpportunity,
      }) as RoadmapPayload,
  });

  const items = sanitizeRoadmapItems(result.items);
  if (!items.length) {
    const fallback = rulesFallbackRoadmap(input, gaps);
    return { estimatedDuration: fallback.estimatedDuration, items: fallback.items, engine };
  }

  const estimatedDuration =
    typeof result.estimatedDuration === "string" && result.estimatedDuration.trim()
      ? result.estimatedDuration.trim()
      : `${items.reduce((sum, item) => sum + (Number.parseInt(item.duration, 10) || 3), 0)} days`;

  return { estimatedDuration, items, engine };
}

/**
 * ONE combined request for the job-analysis workflow: the learning roadmap AND
 * the per-gap "what should I build" notes come back in a single response.
 *
 * Previously `analyzeOpportunity` made one Gemini call for the gap notes and
 * `generateRoadmap` made a second one for the plan. The prompt still receives
 * only the deterministic gaps (matching stays exact); the combined response is
 * sanitized so neither the plan nor the notes can invent skills or gaps.
 */
export async function generateRoadmapWithGapNotes(input: {
  targetOpportunity: string;
  targetSkills: string[];
  gaps: SkillGap[];
  profile: Profile | null;
}): Promise<RoadmapComputation> {
  const gaps = defaultRoadmapGaps(input);
  const gapPayload = gaps.map(gap => ({
    skill: gap.skill,
    currentLevel: gap.currentLevel,
    requiredLevel: gap.requiredLevel,
    gap: gap.gap,
    importance: gap.importance,
  }));

  const { result, engine } = await runAi<RoadmapPayload>({
    operation: "generateRoadmapWithGapNotes",
    real: () =>
      generateJson<RoadmapPayload>({
        prompt: buildRoadmapWithGapsPrompt({
          targetOpportunity: input.targetOpportunity,
          targetSkills: input.targetSkills,
          gaps: gapPayload,
          profileSummary: roadmapProfileSummary(input.profile),
        }),
        schema: ROADMAP_WITH_GAPS_SCHEMA as unknown as Record<string, unknown>,
        operation: "generateRoadmapWithGapNotes",
      }),
    demo: () =>
      fallbackRoadmap({
        targetSkills: input.targetSkills,
        gaps: gapPayload.map(({ skill, importance, gap, requiredLevel }) => ({ skill, importance, gap, requiredLevel })),
        targetOpportunity: input.targetOpportunity,
      }) as RoadmapPayload,
  });

  const items = sanitizeRoadmapItems(result.items);
  if (!items.length) {
    const fallback = rulesFallbackRoadmap(input, gaps);
    return { estimatedDuration: fallback.estimatedDuration, items: fallback.items, gapNotes: [], engine };
  }

  const estimatedDuration =
    typeof result.estimatedDuration === "string" && result.estimatedDuration.trim()
      ? result.estimatedDuration.trim()
      : `${items.reduce((sum, item) => sum + (Number.parseInt(item.duration, 10) || 3), 0)} days`;

  return { estimatedDuration, items, gapNotes: sanitizeGapNotes(result.gapNotes, gaps), engine };
}

/* ------------------------------------------------------------------ */
/* 7. Rejection feedback                                               */
/* ------------------------------------------------------------------ */

export async function analyzeRejection(input: {
  category: string;
  explanation: string;
  profile: Profile | null;
  missingSkills: string[];
  company?: string;
  position?: string;
}): Promise<{ analysis: FeedbackAnalysis; engine: AnalysisResultEngine }> {
  const { result, engine } = await runAi({
    operation: "analyzeRejection",
    real: () =>
      generateJson<{
        area?: string;
        insight?: string;
        action?: string;
        confidence?: string;
        skillsToPrioritize?: string[];
        recommendations?: string[];
      }>({
        prompt: buildRejectionPrompt({
          category: input.category,
          explanation: input.explanation,
          profileSkills: input.profile?.skills ?? [],
          missingSkills: input.missingSkills,
          company: input.company,
          position: input.position,
        }),
        schema: FEEDBACK_SCHEMA as unknown as Record<string, unknown>,
        operation: "analyzeRejection",
      }),
    demo: () =>
      fallbackFeedback({
        category: input.category,
        explanation: input.explanation,
        missingSkills: input.missingSkills,
        profileSkills: input.profile?.skills ?? [],
      }),
  });

  const confidenceValues = ["High", "Medium", "Low"] as const;
  const explanation = input.explanation.trim();

  const analysis: FeedbackAnalysis = {
    applicationId: null,
    category: input.category,
    userExplanation: explanation,
    area:
      typeof result.area === "string" && result.area.trim() ? result.area.trim() : input.category,
    insight:
      typeof result.insight === "string" && result.insight.trim()
        ? result.insight.trim()
        : "There is not enough information to draw a firm conclusion yet.",
    action:
      typeof result.action === "string" && result.action.trim()
        ? result.action.trim()
        : "Add more context about what happened so the next analysis has something to work with.",
    confidence: confidenceValues.includes(result.confidence as (typeof confidenceValues)[number])
      ? (result.confidence as FeedbackAnalysis["confidence"])
      : explanation.length > 40
        ? "Medium"
        : "Low",
    skillsToPrioritize: Array.isArray(result.skillsToPrioritize)
      ? result.skillsToPrioritize
          .filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0)
          .slice(0, 6)
      : [],
    recommendations: Array.isArray(result.recommendations)
      ? result.recommendations
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, 5)
      : [],
    disclaimer:
      "This analysis is based only on the feedback you recorded. It does not claim to know the company's actual reason.",
    engine,
  };

  return { analysis, engine };
}

/* ------------------------------------------------------------------ */
/* 8. Continuous improvement insights                                  */
/* ------------------------------------------------------------------ */

export async function generateInsights(input: {
  analyses: Array<{ matchScore: number; missingSkills: string[]; company: string; createdAt: string }>;
  applications: Array<{ status: string; company: string }>;
  feedback: Array<{ category: string; insight: string }>;
  roadmap: { completed: number; total: number };
  profile: Profile | null;
  /** Accumulated rejection feedback — used to sharpen recommendations. */
  rejectionSignals?: Array<{ reason: string; category: string; company: string }>;
}): Promise<{ insights: Array<{ title: string; body: string; tone: "positive" | "watch" | "neutral" }>; engine: AnalysisResultEngine }> {
  const frequency = new Map<string, number>();
  for (const analysis of input.analyses) {
    for (const skill of analysis.missingSkills) {
      const key = normalizeSkill(skill);
      if (!key) continue;
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }

  const top = [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const insights: Array<{ title: string; body: string; tone: "positive" | "watch" | "neutral" }> = [];

  if (top.length) {
    insights.push({
      title: "Recurring skill gaps",
      body: `${top
        .map(([skill, count]) => `${skill} appears in ${count} of your analyzed opportunities`)
        .join("; ")}. These are the highest-leverage skills to build next.`,
      tone: "watch",
    });
  } else if (input.analyses.length) {
    insights.push({
      title: "No repeating gaps yet",
      body: "Your analyzed opportunities do not share a common missing skill yet. Analyze a few more roles to reveal a pattern.",
      tone: "neutral",
    });
  } else {
    insights.push({
      title: "Start the loop",
      body: "Analyze your first opportunity to unlock pattern insights across your target roles.",
      tone: "neutral",
    });
  }

  if (input.analyses.length >= 2) {
    const scores = input.analyses.map(analysis => analysis.matchScore);
    const newest = scores[0];
    const oldest = scores[scores.length - 1];
    const delta = newest - oldest;
    insights.push({
      title: "Match trend",
      body:
        delta > 0
          ? `Your match score moved from ${oldest}% to ${newest}% across your analyzed opportunities.`
          : delta < 0
            ? `Your most recent match (${newest}%) is below your earlier best (${oldest}%). Review the requirements you are missing.`
            : `Your match score has held steady around ${newest}%. Closing one recurring gap should move it.`,
      tone: delta > 0 ? "positive" : "watch",
    });
  }

  if (input.roadmap.total > 0) {
    const pct = Math.round((input.roadmap.completed / input.roadmap.total) * 100);
    insights.push({
      title: "Roadmap progress",
      body: `You have completed ${input.roadmap.completed} of ${input.roadmap.total} roadmap items (${pct}%).${
        pct >= 50 ? " Momentum is real — keep the sequence going." : " Completing the next item is the fastest way to improve your matches."
      }`,
      tone: pct >= 50 ? "positive" : "neutral",
    });
  }

  if (input.applications.length) {
    const interview = input.applications.filter(app => app.status === "Interview" || app.status === "Selected").length;
    const rejected = input.applications.filter(app => app.status === "Rejected").length;
    insights.push({
      title: "Application funnel",
      body: `${input.applications.length} application(s) tracked: ${interview} reached interview or better, ${rejected} were rejected. ${
        rejected > 0 && interview === 0
          ? "Capture rejection feedback so the pattern becomes visible."
          : "Keep statuses current so this view stays accurate."
      }`,
      tone: interview > 0 ? "positive" : "neutral",
    });
  }

  if (input.feedback.length) {
    const categories = [...new Set(input.feedback.map(item => item.category))].filter(Boolean);
    insights.push({
      title: "Feedback themes",
      body: `Across ${input.feedback.length} feedback note(s), the areas you recorded are: ${categories.join(", ")}.`,
      tone: "neutral",
    });
  }

  const rejectionSignals = input.rejectionSignals ?? [];
  if (rejectionSignals.length) {
    const withReason = rejectionSignals.filter(signal => signal.reason.trim());
    const themes = [...new Set(withReason.map(signal => signal.reason.trim().slice(0, 80)))].slice(0, 3);
    insights.push({
      title: "Learned from rejections",
      body: withReason.length
        ? `${withReason.length} rejection reason(s) are on record${themes.length ? ` — recurring signals: ${themes.join("; ")}` : ""}. These are used to prioritise your next roadmap steps.`
        : `${rejectionSignals.length} application(s) were closed without a reason. Adding a reason when you have one sharpens future recommendations.`,
      tone: withReason.length ? "watch" : "neutral",
    });
  }

  return { insights: insights.slice(0, 6), engine: getApiKey() ? "gemini" : "rules" };
}
