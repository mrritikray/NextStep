/**
 * Deterministic, explainable matching engine.
 *
 * Every score in this file is derived from the actual job requirements and the
 * actual student profile. There is no randomness and no hard-coded skill list.
 */
import type {
  EligibilityCheck,
  JobRequirements,
  Profile,
  SkillGap,
  SkillRow,
} from "./types";

const ALIASES: Record<string, string> = {
  // Dotted / spaced product names: the punctuation pass turns "React.js" into
  // "react js", so those variants need their own keys.

  "react js": "react",
  "node js": "node",
  nodejs: "node",
  "vue js": "vue",
  "next js": "nextjs",
  nextjs: "nextjs",
  "restful api": "rest api",
  "restful apis": "rest api",
  postgres: "postgresql",
  "postgresql db": "postgresql",
  k8s: "kubernetes",
  golang: "go",
  "c ++": "c++",
  "c plus plus": "c++",
  js: "javascript",
  "java script": "javascript",
  es6: "javascript",
  ts: "typescript",
  reactjs: "react",
  "react.js": "react",
  "node.js": "node",
  expressjs: "express",
  "express.js": "express",
  html5: "html",
  css3: "css",
  "rest api": "rest api",
  restapi: "rest api",
  restful: "rest api",
  "rest apis": "rest api",
  "api integration": "rest api",
  apis: "rest api",
  api: "rest api",
  postgresql: "postgres",
  mongo: "mongodb",
  "mongo db": "mongodb",
  "tailwind css": "tailwind",
  tailwindcss: "tailwind",
  aws: "aws",
  gcp: "gcp",
  ci: "ci/cd",
  "ci cd": "ci/cd",
  "machine-learning": "machine learning",
  ml: "machine learning",
  "artificial intelligence": "ai",
  figma: "figma",
  ui: "ui design",
  ux: "ux design",
  "ui/ux": "ui design",
  "problem-solving": "problem solving",
  "problem solving": "problem solving",
  communication: "communication",
  teamwork: "teamwork",
  leadership: "leadership",
  sql: "sql",
  mysql: "sql",
  algorithms: "algorithms",
  "data structures": "data structures",
  dsa: "data structures",
  oop: "object oriented programming",
  "object-oriented programming": "object oriented programming",
  git: "git",
  github: "git",
  "git/github": "git",
};

export function normalizeSkill(raw: string): string {
  const base = (raw ?? "")
    .toLowerCase()
    .replace(/[(){}[\].,;:!"'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ALIASES[base] ?? base;
}

const STOP_TOKENS = new Set([
  "and", "or", "the", "a", "an", "with", "for", "using", "of", "to", "in", "on",
  "knowledge", "experience", "basic", "strong", "good", "must", "should", "have",
  "ability", "skills", "skill", "understanding", "familiarity", "working", "etc",
]);

function tokens(skill: string): string[] {
  return normalizeSkill(skill)
    .split(/[\s/&+-]+/)
    .map(token => token.trim())
    .filter(token => token.length > 1 && !STOP_TOKENS.has(token));
}

/** A requirement that cannot be objectively evaluated from a profile. */
export function isNotApplicable(skill: string): boolean {
  const value = normalizeSkill(skill);
  if (!value || value.length < 2) return true;
  return /^(n\/a|na|none|any|not specified|unspecified|-)$/.test(value);
}

export type Requirement = { skill: string; optional: boolean };

/**
 * Compare profile skills against job requirements.
 * Matched / Partially Matched / Missing / Not Applicable — per requirement.
 */
export function classifySkills(
  requirements: Requirement[],
  profileSkills: string[],
): SkillRow[] {
  const profile = profileSkills.map(normalizeSkill).filter(Boolean);
  const profileTokens = new Set(profile.flatMap(tokens));

  const rows: SkillRow[] = [];
  const seen = new Set<string>();

  for (const requirement of requirements) {
    const normalized = normalizeSkill(requirement.skill);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    if (isNotApplicable(requirement.skill)) {
      rows.push({
        skill: requirement.skill,
        status: "Gap",
        classification: "Not Applicable",
        note: "This requirement cannot be evaluated from your profile.",
      });
      continue;
    }

    const exact = profile.includes(normalized);
    if (exact) {
      rows.push({
        skill: requirement.skill,
        status: "Matched",
        classification: "Matched",
        note: requirement.optional
          ? "You already have this skill."
          : "Required skill found in your profile.",
      });
      continue;
    }

    const reqTokens = tokens(requirement.skill);
    const overlap = reqTokens.filter(token => profileTokens.has(token));

    if (overlap.length > 0) {
      rows.push({
        skill: requirement.skill,
        status: "Partial",
        classification: "Partially Matched",
        note: `Adjacent to skills you already have (${overlap.join(", ")}).`,
      });
      continue;
    }

    const related = profile.find(item => item.includes(normalized) || normalized.includes(item));
    if (related) {
      rows.push({
        skill: requirement.skill,
        status: "Partial",
        classification: "Partially Matched",
        note: `Related to "${related}" in your profile.`,
      });
      continue;
    }

    rows.push({
      skill: requirement.skill,
      status: "Gap",
      classification: "Missing",
      note: requirement.optional
        ? "Preferred skill — a good differentiator to build."
        : "Required skill not found in your profile.",
    });
  }

  return rows;
}

function skillComponent(rows: SkillRow[]): { score: number; matched: number; partial: number; evaluable: number } {
  const evaluableRows = rows.filter(row => row.classification !== "Not Applicable");
  const matched = evaluableRows.filter(row => row.classification === "Matched").length;
  const partial = evaluableRows.filter(row => row.classification === "Partially Matched").length;
  const evaluable = evaluableRows.length;
  const score = evaluable === 0 ? 0 : Math.round(((matched + partial * 0.5) / evaluable) * 100);
  return { score, matched, partial, evaluable };
}

function yearsOfExperience(text: string): number | null {
  const match = /\b(\d+(?:\.\d+)?)\s*\+?\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(?:years?|yrs?)\b/i.exec(text);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

function buildEducationCheck(job: JobRequirements & { description?: string }, profile: Profile): EligibilityCheck {
  const requirement = `${job.educationRequirement} ${job.eligibility}`.toLowerCase();
  const profileEdu = `${profile.degree} ${profile.branch}`.toLowerCase();

  if (!requirement.trim()) {
    return {
      label: "Education requirement",
      status: "unknown",
      detail: "The posting does not state an education requirement.",
    };
  }

  const liberal = /(any|no specific|not specified|pursuing|final year|current student|fresher)/.test(requirement);
  const wantsDegree = /(b\.?tech|be\b|b\.?e\.|bachelor|b\.?sc|bca|mca|m\.?tech|degree|graduate)/.test(requirement);
  const wantsDiploma = /diploma/.test(requirement);
  const wantsHighSchool = /(high school|12th|10th|intermediate)/.test(requirement);
  const wantsCs = /(computer science|cse|it\b|information technology|software|engineering)/.test(requirement);

  const hasDegree = /(b\.?tech|bachelor|b\.?e\.|b\.?sc|bca|degree|mca|m\.?tech)/.test(profileEdu);
  const isCs = /(computer science|cse|information technology|software|engineering|it\b)/.test(profileEdu);

  if (!hasDegree && (wantsDegree || wantsCs)) {
    return {
      label: "Education requirement",
      status: "gap",
      detail: `The role asks for "${job.educationRequirement}". Your profile lists "${profile.degree}".`,
    };
  }

  if (wantsCs && hasDegree && !isCs) {
    return {
      label: "Education requirement",
      status: "gap",
      detail: "The role targets a computing branch; your branch reads differently.",
    };
  }

  if (liberal || wantsDegree || wantsDiploma || wantsHighSchool) {
    return {
      label: "Education requirement",
      status: "met",
      detail: profile.degree
        ? `Your degree (${profile.degree}) satisfies "${job.educationRequirement}".`
        : "Your listed education matches the stated requirement.",
    };
  }

  return {
    label: "Education requirement",
    status: "unknown",
    detail: `Stated as "${job.educationRequirement}". Confirm with the recruiter.`,
  };
}

function experienceCheck(job: JobRequirements & { description?: string }, profile: Profile): EligibilityCheck {
  const text = `${job.experienceRequirement} ${job.eligibility} ${job.description ?? ""}`;
  const required = yearsOfExperience(text);
  const entryLevel = /(intern|fresher|entry level|graduate|trainee|0\s*-\s*1)/i.test(text);
  const profileYears = profile.experience.length;
  const label = "Experience requirement";

  if (required === null) {
    if (entryLevel) {
      return {
        label,
        status: "met",
        detail: "This is an entry-level or internship role, which matches your profile stage.",
      };
    }
    return {
      label,
      status: "unknown",
      detail: "The posting does not state a clear experience requirement.",
    };
  }

  if (required <= 1 && (entryLevel || profileYears >= 0)) {
    return {
      label,
      status: "met",
      detail: `The role expects ${required} year(s) of experience, which is open to students and freshers.`,
    };
  }

  if (profileYears >= required) {
    return {
      label,
      status: "met",
      detail: `You have ${profileYears} experience entr${profileYears === 1 ? "y" : "ies"} against a ${required}-year requirement.`,
    };
  }

  return {
    label,
    status: "gap",
    detail: `The role asks for ${required}+ year(s) of experience. Your profile currently lists ${profileYears}.`,
  };
}

function locationCheck(job: JobRequirements & { description?: string }, profile: Profile): EligibilityCheck {
  const label = "Location / work setup";
  const jobLocation = (job.location || "").toLowerCase();
  const pref = (profile.preferredWorkLocation || "").toLowerCase();
  const profileLocation = (profile.location || "").toLowerCase();

  if (!jobLocation) {
    return { label, status: "unknown", detail: "The posting does not state a location." };
  }

  if (/remote/.test(jobLocation)) {
    return { label, status: "met", detail: "Remote role — compatible with your preference." };
  }

  if (pref && jobLocation.split(/[\s,/]+/).some(part => part.length > 2 && pref.includes(part))) {
    return { label, status: "met", detail: `Matches your preferred work location (${profile.preferredWorkLocation}).` };
  }

  if (profileLocation && jobLocation.split(/[\s,/]+/).some(part => part.length > 2 && profileLocation.includes(part))) {
    return { label, status: "met", detail: `The role is in ${job.location}, where your profile is based.` };
  }

  if (/hybrid/.test(jobLocation)) {
    return { label, status: "met", detail: `Hybrid setup in ${job.location}.` };
  }

  return {
    label,
    status: "unknown",
    detail: `Role is in ${job.location}. Your preference is ${profile.preferredWorkLocation || "not set"}.`,
  };
}

function employmentCheck(job: JobRequirements & { description?: string }, profile: Profile): EligibilityCheck {
  const label = "Employment type";
  const type = (job.employmentType || "").toLowerCase();
  const prefs = profile.preferences as { employmentType?: string; internship?: boolean };
  const preferred = (prefs?.employmentType ?? "").toLowerCase();

  if (!type) {
    return { label, status: "unknown", detail: "The posting does not state an employment type." };
  }
  if (!preferred) {
    return { label, status: "met", detail: `Listed as ${job.employmentType}.` };
  }
  if (type.includes(preferred) || preferred.includes(type)) {
    return { label, status: "met", detail: `${job.employmentType} matches your stated preference.` };
  }
  return {
    label,
    status: "unknown",
    detail: `Listed as ${job.employmentType}; your preference is ${prefs.employmentType}.`,
  };
}

export type MatchResult = {
  matchScore: number;
  skillRows: SkillRow[];
  matchedSkills: string[];
  partialSkills: string[];
  missingSkills: string[];
  notApplicableSkills: string[];
  eligibility: EligibilityCheck[];
  factors: Array<{ label: string; value: string; score: number }>;
  explanation: string;
};

export function calculateSkillMatch(
  job: JobRequirements & { description?: string },
  profile: Profile,
): MatchResult {
  const requirements: Requirement[] = [
    ...job.requiredSkills.map(skill => ({ skill, optional: false })),
    ...job.preferredSkills.map(skill => ({ skill, optional: true })),
  ];

  const skillRows = classifySkills(requirements, profile.skills);
  const skills = skillComponent(skillRows);

  const education = buildEducationCheck(job, profile);
  const experience = experienceCheck(job, profile);
  const location = locationCheck(job, profile);
  const employmentType = employmentCheck(job, profile);

  const statusScore = (status: EligibilityCheck["status"]) =>
    status === "met" ? 100 : status === "unknown" ? 65 : 25;

  const educationScore = statusScore(education.status);
  const experienceScore = statusScore(experience.status);
  const locationScore = statusScore(location.status);
  const employmentScore = statusScore(employmentType.status);

  const matchScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        skills.score * 0.6 +
          educationScore * 0.15 +
          experienceScore * 0.12 +
          locationScore * 0.08 +
          employmentScore * 0.05,
      ),
    ),
  );

  const matched = skillRows.filter(row => row.classification === "Matched").map(row => row.skill);
  const partial = skillRows.filter(row => row.classification === "Partially Matched").map(row => row.skill);
  const missing = skillRows.filter(row => row.classification === "Missing").map(row => row.skill);
  const notApplicable = skillRows.filter(row => row.classification === "Not Applicable").map(row => row.skill);

  const factors = [
    { label: "Skill fit", value: `${skills.score}%`, score: skills.score },
    { label: "Education", value: `${educationScore}%`, score: educationScore },
    { label: "Experience", value: `${experienceScore}%`, score: experienceScore },
    { label: "Work setup", value: `${locationScore}%`, score: locationScore },
    { label: "Employment type", value: `${employmentScore}%`, score: employmentScore },
  ];

  const explanation =
    skills.evaluable === 0
      ? "The posting did not state evaluable skills, so the match is based on eligibility only."
      : `${matched.length} of ${skills.evaluable} evaluable requirements are fully matched` +
        (partial.length ? `, ${partial.length} partially matched` : "") +
        (missing.length ? `, and ${missing.length} missing` : "") +
        `. Skill fit is ${skills.score}% and is weighted at 60% of the overall score.`;

  return {
    matchScore,
    skillRows,
    matchedSkills: matched,
    partialSkills: partial,
    missingSkills: missing,
    notApplicableSkills: notApplicable,
    eligibility: [education, experience, location, employmentType],
    factors,
    explanation,
  };
}

/** Derive skill gaps from the missing / partially matched requirements. */
export function generateSkillGap(
  match: MatchResult,
  job: JobRequirements,
  frequency: Record<string, number> = {},
): SkillGap[] {
  const requiredSet = new Set(job.requiredSkills.map(normalizeSkill));

  return match.skillRows
    .filter(row => row.classification === "Missing" || row.classification === "Partially Matched")
    .map(row => {
      const normalized = normalizeSkill(row.skill);
      const isRequired = requiredSet.has(normalized);
      const seen = frequency[normalized] ?? 0;

      const importance: SkillGap["importance"] = isRequired
        ? seen >= 2
          ? "High"
          : "High"
        : seen >= 2
          ? "Medium"
          : "Low";

      const gapSeverity: SkillGap["gapSeverity"] =
        row.classification === "Partially Matched"
          ? "Minor"
          : isRequired
            ? "Significant"
            : "Moderate";

      const currentLevel =
        row.classification === "Partially Matched" ? "Beginner" : "Not started";

      const requiredLevel = isRequired ? "Intermediate" : "Basic";

      const gap =
        row.classification === "Partially Matched"
          ? "Deepen this with one focused project or course."
          : isRequired
            ? "Build a demonstrable project before applying."
            : "Nice-to-have — worth basic familiarity.";

      return {
        skill: row.skill,
        currentLevel,
        requiredLevel,
        gap,
        gapSeverity,
        importance,
      } satisfies SkillGap;
    })
    .sort((a, b) => {
      const rank = { High: 0, Medium: 1, Low: 2 } as const;
      const severity = { Significant: 0, Moderate: 1, Minor: 2 } as const;
      return (
        rank[a.importance] - rank[b.importance] ||
        severity[a.gapSeverity] - severity[b.gapSeverity] ||
        a.skill.localeCompare(b.skill)
      );
    });
}

/**
 * Real trust / scam-signal review. Never guarantees that an opportunity is
 * legitimate — it only reports observable signals in the supplied text.
 */
export function verifyOpportunity(
  job: JobRequirements & { description?: string },
): { status: "Review recommended" | "No major warning signs detected" | "Not enough information to verify this opportunity."; indicators: Array<{ label: string; status: "good" | "watch" | "unknown"; detail: string }> } {
  const description = `${job.description ?? ""} ${job.eligibility ?? ""} ${job.applicationInfo ?? ""}`;
  const hires = job.insufficientInformation === true || description.trim().length < 40;

  const hasCompany = Boolean(job.company && job.company !== "Not found");
  const hasCompensation = Boolean(job.compensation && job.compensation !== "Not found");
  const hasContact = /(hr@|careers@|contact|@[a-z0-9.-]+\.[a-z]{2,})/i.test(description);
  const hasApplicationMethod = /(apply|application|portal|form|link|send your resume|email)/i.test(description + " " + job.applicationInfo);
  const paymentRequest = /(pay|payment|fee|deposit|registration charge|security deposit|refundable|processing charge|₹\s?\d+\s*(registration|fee))/i.test(description);
  const suspicious = /(instant offer|no interview|guaranteed job|100% placement|work from home and earn|urgent hiring.{0,20}no)/i.test(description);
  const unusualRequirement = /(aadhaar|pan card|bank details|otp|passport copy|upi)/i.test(description);
  const links = description.match(/https?:\/\/[^\s)]+/gi) ?? [];
  const externalLink = links.find(link => /bit\.ly|tinyurl|t\.me|wa\.me|forms\.gle/i.test(link));
  const vagueComp = /(salary|stipend)[^.]{0,40}(negotiable|as per|discussed|competitive)/i.test(description);
  const hasSkills = job.requiredSkills.length > 0;
  const complete = Boolean(job.jobTitle && job.company && job.location !== "");

  const indicators = [
    {
      label: "Company information",
      status: hasCompany ? ("good" as const) : ("unknown" as const),
      detail: hasCompany ? `${job.company} is named in the posting.` : "No company name could be identified.",
    },
    {
      label: "Job description completeness",
      status: complete && hasSkills ? ("good" as const) : hasSkills ? ("watch" as const) : ("unknown" as const),
      detail:
        complete && hasSkills
          ? "Role, company, location, and requirements are present."
          : "Some core fields (company, location, or skills) are missing.",
    },
    {
      label: "Contact information",
      status: hasContact ? ("good" as const) : ("unknown" as const),
      detail: hasContact ? "A contact address is present in the posting." : "No verifiable contact was found in the supplied text.",
    },
    {
      label: "Salary / stipend transparency",
      status: hasCompensation ? ("good" as const) : ("unknown" as const),
      detail: hasCompensation
        ? `Compensation is stated: ${job.compensation}.`
        : vagueComp
          ? "Compensation is described vaguely, without a figure."
          : "Compensation was not stated.",
    },
    {
      label: "Application method",
      status: hasApplicationMethod ? ("good" as const) : ("unknown" as const),
      detail: hasApplicationMethod ? "A clear application route is described." : "The application method is unclear.",
    },
    {
      label: "Payment requests",
      status: paymentRequest ? ("watch" as const) : ("good" as const),
      detail: paymentRequest
        ? "The text mentions a fee or payment. Genuine employers do not charge candidates to apply."
        : "No payment request was found in the supplied text.",
    },
    {
      label: "Suspicious wording",
      status: suspicious ? ("watch" as const) : ("good" as const),
      detail: suspicious
        ? "Phrases typical of unrealistic offers were detected."
        : "No common scam phrasing was detected.",
    },
    {
      label: "Unusual requirements",
      status: unusualRequirement ? ("watch" as const) : ("good" as const),
      detail: unusualRequirement
        ? "Sensitive personal documents are requested before hiring steps."
        : "No sensitive-document requests were detected.",
    },
    {
      label: "External links",
      status: externalLink ? ("watch" as const) : links.length ? ("good" as const) : ("unknown" as const),
      detail: externalLink
        ? `A shortened third-party link was found (${externalLink}). Verify the destination before clicking.`
        : links.length
          ? `${links.length} link(s) found. Open them in a fresh tab to inspect the domain.`
          : "No links were supplied for inspection.",
    },
  ];

  const watchCount = indicators.filter(indicator => indicator.status === "watch").length;
  const knownCount = indicators.filter(indicator => indicator.status !== "unknown").length;

  const status = hires
    ? ("Not enough information to verify this opportunity." as const)
    : watchCount > 0
      ? ("Review recommended" as const)
      : knownCount < 3
        ? ("Not enough information to verify this opportunity." as const)
        : ("No major warning signs detected" as const);

  return { status, indicators };
}
