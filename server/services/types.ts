/**
 * Shared domain types for the NextStep backend.
 * These are the real, persisted shapes (SQLite-backed) — not view models.
 */

export type Engine = "gemini" | "rules" | "demo";
export type AiMode = "real" | "demo";

export type Project = {
  title: string;
  description?: string;
  technologies?: string[];
  link?: string;
};

export type ExperienceEntry = {
  company?: string;
  role?: string;
  duration?: string;
  description?: string;
};

export type Certification = {
  name: string;
  issuer?: string;
  year?: string;
};

export type Profile = {
  id: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  preferredWorkLocation: string;
  college: string;
  degree: string;
  branch: string;
  graduationYear: string;
  cgpa: string;
  careerObjective: string;
  skills: string[];
  projects: Project[];
  experience: ExperienceEntry[];
  certifications: Certification[];
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExtractedProfile = {
  name: string;
  email: string;
  phone: string;
  location: string;
  education: string;
  degree: string;
  branch: string;
  graduationYear: string;
  cgpa: string;
  careerObjective: string;
  skills: string[];
  projects: Project[];
  experience: ExperienceEntry[];
  certifications: Certification[];
  /** Fields the extractor could not find. Rendered as "Not found" in the UI. */
  notFound: string[];
};

export type ResumeAnalysis = {
  score: number;
  breakdown: Array<{ label: string; score: number; color: string }>;
  strengths: string[];
  improvements: Array<{ category: string; detail: string }>;
  skillObservations: string[];
  projectObservations: string[];
  experienceObservations: string[];
  educationObservations: string[];
  formattingObservations: string[];
  summaryObservation: string;
  jobRelevance: string;
  improvedSummary: string;
};

export type ResumeRecord = {
  id: number;
  profileId: number | null;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  extractedText: string;
  extractedProfile: ExtractedProfile | null;
  analysis: ResumeAnalysis | null;
  improvementSuggestions: Array<{ category: string; detail: string }>;
  improvedResume: string;
  improvedChanges: Array<{ area: string; change: string }>;
  improvementKind: string;
  createdAt: string;
  updatedAt: string;
};

export type JobRequirements = {
  company: string;
  jobTitle: string;
  location: string;
  employmentType: string;
  compensation: string;
  eligibility: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  responsibilitiesRaw: string;
  experienceRequirement: string;
  educationRequirement: string;
  applicationInfo: string;
  /** True when the source did not contain enough information. */
  insufficientInformation?: boolean;
};

export type Opportunity = JobRequirements & {
  id: number;
  description: string;
  source: string;
  sourceFilename: string;
  isSample: number;
  createdAt: string;
};

export type SkillClassification = "Matched" | "Partially Matched" | "Missing" | "Not Applicable";
export type SkillRowStatus = "Matched" | "Partial" | "Gap";

export type SkillRow = {
  skill: string;
  status: SkillRowStatus;
  classification: SkillClassification;
  note: string;
};

export type EligibilityCheck = {
  label: string;
  status: "met" | "gap" | "unknown";
  detail: string;
};

export type SkillGap = {
  skill: string;
  currentLevel: string;
  requiredLevel: string;
  gap: string;
  gapSeverity: "Minor" | "Moderate" | "Significant";
  importance: "High" | "Medium" | "Low";
};

export type TrustIndicator = {
  label: string;
  status: "good" | "watch" | "unknown";
  detail: string;
};

export type TrustCheck = {
  status:
    | "Review recommended"
    | "No major warning signs detected"
    | "Not enough information to verify this opportunity.";
  indicators: TrustIndicator[];
};

export type OpportunityAnalysis = {
  id?: number;
  opportunityId?: number;
  matchScore: number;
  matchedSkills: string[];
  partialSkills: string[];
  missingSkills: string[];
  notApplicableSkills: string[];
  skillRows: SkillRow[];
  eligibility: EligibilityCheck[];
  factors: Array<{ label: string; value: string; score: number }>;
  explanation: string;
  skillGaps: SkillGap[];
  verification: TrustCheck;
  engine: Engine;
};

export type RoadmapItem = {
  id: number;
  roadmapId: number;
  position: number;
  skill: string;
  title: string;
  description: string;
  duration: string;
  learningObjective: string;
  practicalTask: string;
  resources: string[];
  completed: boolean;
  completedAt: string | null;
};

export type Roadmap = {
  id: number;
  profileId: number | null;
  opportunityId: number | null;
  targetOpportunity: string;
  targetSkills: string[];
  estimatedDuration: string;
  status: string;
  engine: Engine;
  items: RoadmapItem[];
  createdAt: string;
  updatedAt: string;
};

export type ApplicationStatus =
  | "Saved"
  | "Applied"
  | "Assessment"
  | "Interview"
  | "Rejected"
  | "Selected";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "Saved",
  "Applied",
  "Assessment",
  "Interview",
  "Rejected",
  "Selected",
];

export type Application = {
  id: number;
  opportunityId: number | null;
  company: string;
  position: string;
  matchPercentage: number;
  status: ApplicationStatus;
  dateApplied: string | null;
  notes: string;
  tailoredResume: string;
  tailoredChanges: Array<{ area: string; change: string }>;
  /** Free-text reason captured when an application is marked as rejected. */
  rejectionReason: string;
  /** "rejected" | "selected" once the after-interview outcome is recorded. */
  outcome: string;
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Learning resources (per roadmap task, per language)                 */
/* ------------------------------------------------------------------ */

export type ResourceKind = "youtube_video" | "youtube_playlist" | "course" | "website";

export const RESOURCE_KINDS: ResourceKind[] = [
  "youtube_video",
  "youtube_playlist",
  "course",
  "website",
];

export type LearningResource = {
  id?: number;
  roadmapItemId: number;
  opportunityId: number | null;
  skill: string;
  language: string;
  kind: ResourceKind;
  title: string;
  url: string;
  source: string;
  verified: boolean;
  engine: Engine;
  createdAt?: string;
};

export type ResourceBundle = {
  itemId: number;
  skill: string;
  language: string;
  engine: Engine;
  resources: LearningResource[];
  generatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Roadmap progress + saved opportunity history                        */
/* ------------------------------------------------------------------ */

export type RoadmapProgress = {
  total: number;
  completed: number;
  remaining: number;
  percent: number;
};

export type OpportunitySnapshotState = {
  opportunity: Opportunity | null;
  analysis: OpportunityAnalysis | null;
  roadmap: Roadmap | null;
  applications: Application[];
  feedback: FeedbackAnalysis[];
  progress: RoadmapProgress;
  savedAt: string;
  /** Explicit note: the shared profile is intentionally never snapshotted. */
  profileIncluded: false;
};

export type OpportunitySnapshot = {
  id: number;
  opportunityId: number;
  company: string;
  jobTitle: string;
  matchPercentage: number;
  isCurrent: boolean;
  status: string;
  progress: RoadmapProgress;
  applicationStatus: string;
  rejectionReason: string;
  hasRoadmap: boolean;
  savedAt: string;
  updatedAt: string;
  state?: OpportunitySnapshotState;
};

export type FeedbackAnalysis = {
  id?: number;
  applicationId: number | null;
  category: string;
  userExplanation: string;
  area: string;
  insight: string;
  action: string;
  confidence: "High" | "Medium" | "Low";
  skillsToPrioritize: string[];
  recommendations: string[];
  disclaimer: string;
  engine: Engine;
  createdAt?: string;
};

export type NotificationType =
  | "analysis"
  | "skill_completed"
  | "resume"
  | "roadmap"
  | "selection"
  | "rejection"
  | "opportunity"
  | "system";

/** A persisted in-app notification (SQLite-backed). */
export type NotificationRecord = {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
};

export type Insight = { title: string; body: string; tone: "positive" | "watch" | "neutral" };

export type ProfileInsights = {
  insights: Insight[];
  stats: {
    opportunitiesAnalyzed: number;
    applications: number;
    feedbackNotes: number;
    roadmapItemsCompleted: number;
    roadmapItemsTotal: number;
    averageMatch: number;
    frequentlyMissingSkills: Array<{ skill: string; count: number }>;
    /** Live progress of the CURRENT learning roadmap (never hard-coded). */
    roadmapTotal: number;
    roadmapCompleted: number;
    roadmapRemaining: number;
    roadmapPercent: number;
    roadmapTargetOpportunity: string;
    currentOpportunityId: number | null;
    currentOpportunityTitle: string;
    currentOpportunityCompany: string;
    currentMatchPercentage: number;
    savedOpportunities: number;
    selectedApplications: number;
    rejectedApplications: number;
    /** Skills recurring across accumulated rejection feedback. */
    rejectionSkills: Array<{ skill: string; count: number }>;
  };
};
