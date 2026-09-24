/**
 * Gemini prompt + response-schema definitions for every AI operation.
 * All prompts enforce: never invent facts.
 */

export const NOT_FOUND = "Not found";

const FACT_RULE =
  "CRITICAL FACTUAL RULE: Use ONLY information that literally exists in the supplied text. " +
  `Never invent or guess skills, companies, internships, job titles, dates, metrics, achievements, certifications or contact details. ` +
  `For any field you cannot find, return exactly the string "${NOT_FOUND}" (or an empty array for list fields). ` +
  "Return STRICT JSON only, matching the requested schema. No markdown, no commentary.";

/** Fields we ask Gemini to pull out of a resume, one by one. */
export const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    location: { type: "string" },
    education: { type: "string" },
    degree: { type: "string" },
    branch: { type: "string" },
    graduationYear: { type: "string" },
    cgpa: { type: "string" },
    careerObjective: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          technologies: { type: "array", items: { type: "string" } },
          link: { type: "string" },
        },
        required: ["title"],
      },
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          role: { type: "string" },
          duration: { type: "string" },
          description: { type: "string" },
        },
        required: ["company", "role"],
      },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          issuer: { type: "string" },
          year: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  required: ["name", "email", "phone", "skills", "projects", "experience", "certifications"],
} as const;

export function buildProfileExtractionPrompt(resumeText: string): string {
  return [
    "You are a resume parser for a career platform.",
    "Extract the candidate's profile information from the resume text below.",
    FACT_RULE,
    "Rules for list fields:",
    "- skills: only concrete technologies, tools, languages and clearly stated soft skills. No sentences.",
    "- projects: only projects actually described, with whatever technologies the resume states.",
    "- experience: only real roles/internships listed. If there are none, return an empty array.",
    "- certifications: only certifications named in the text.",
    "- careerObjective: reuse the candidate's existing summary/objective if present; otherwise write one short objective using ONLY facts already in the resume (their branch, skills, and year). Do not add new claims.",
    "",
    "--- RESUME TEXT START ---",
    resumeText.slice(0, 20000),
    "--- RESUME TEXT END ---",
  ].join("\n");
}

export const RESUME_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    breakdown: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          score: { type: "integer" },
        },
        required: ["label", "score"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    improvements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          detail: { type: "string" },
        },
        required: ["category", "detail"],
      },
    },
    skillObservations: { type: "array", items: { type: "string" } },
    projectObservations: { type: "array", items: { type: "string" } },
    experienceObservations: { type: "array", items: { type: "string" } },
    educationObservations: { type: "array", items: { type: "string" } },
    formattingObservations: { type: "array", items: { type: "string" } },
    summaryObservation: { type: "string" },
    jobRelevance: { type: "string" },
    improvedSummary: { type: "string" },
  },
  required: ["score", "breakdown", "strengths", "improvements"],
} as const;

export function buildResumeAnalysisPrompt(resumeText: string, targetRole?: string): string {
  return [
    "You are an experienced technical recruiter reviewing a student/fresher resume.",
    "Analyse STRUCTURE, CLARITY, SKILLS, PROJECTS, EXPERIENCE, EDUCATION, SUMMARY, JOB RELEVANCE and FORMATTING/READABILITY.",
    FACT_RULE,
    "Scoring:",
    "- score = overall 0-100 quality score, derived from the actual content you can see.",
    "- breakdown = exactly these six labels with 0-100 scores: Skills, Projects, Experience, Education, Formatting, Job relevance.",
    "- improvements = max 6 concrete, specific fixes referencing the real content.",
    "- Each observation array = short, specific notes about what is actually present or missing.",
    "- improvedSummary = a rewritten professional summary using ONLY facts already present in the resume.",
    targetRole ? `The candidate is targeting: ${targetRole}. Weight job relevance accordingly.` : "",
    "Never inflate the score: a resume with no projects or no measurable outcomes must score lower on those axes.",
    "",
    "--- RESUME TEXT START ---",
    resumeText.slice(0, 20000),
    "--- RESUME TEXT END ---",
  ]
    .filter(Boolean)
    .join("\n");
}

export const JOB_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string" },
    jobTitle: { type: "string" },
    location: { type: "string" },
    employmentType: { type: "string" },
    compensation: { type: "string" },
    eligibility: { type: "string" },
    educationRequirement: { type: "string" },
    experienceRequirement: { type: "string" },
    requiredSkills: { type: "array", items: { type: "string" } },
    preferredSkills: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } },
    applicationInfo: { type: "string" },
    insufficientInformation: { type: "boolean" },
  },
  required: [
    "company",
    "jobTitle",
    "location",
    "employmentType",
    "compensation",
    "requiredSkills",
    "preferredSkills",
    "responsibilities",
  ],
} as const;

export function buildJobExtractionPrompt(source: "text" | "image"): string {
  return [
    source === "image"
      ? "You are reading a screenshot of a job posting or internship listing."
      : "You are reading a pasted job description.",
    "Extract the structured job requirements.",
    FACT_RULE,
    "Additional rules:",
    "- requiredSkills MUST be taken from the actual posting. Do NOT add generic skills such as JavaScript/HTML/CSS/React/Git/REST API unless the posting itself mentions them.",
    "- Put explicitly-mandatory skills in requiredSkills and 'preferred/nice-to-have/good to have/bonus' skills in preferredSkills.",
    `- If a field is absent, use "${NOT_FOUND}" (or an empty array).`,
    "- Set insufficientInformation to true ONLY if the image/text does not contain a recognisable job posting (for example a random photo, a blank page, or unreadable content).",
    "- responsibilities: short bullets summarising what the person will do, using the posting's own wording where possible.",
    "- Keep every string field under 200 characters.",
  ].join("\n");
}

export const ROADMAP_SCHEMA = {
  type: "object",
  properties: {
    estimatedDuration: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          duration: { type: "string" },
          learningObjective: { type: "string" },
          practicalTask: { type: "string" },
          resources: { type: "array", items: { type: "string" } },
        },
        required: ["skill", "title", "description", "duration", "practicalTask"],
      },
    },
  },
  required: ["items"],
} as const;

export function buildRoadmapPrompt(input: {
  targetOpportunity: string;
  targetSkills: string[];
  gaps: Array<{ skill: string; currentLevel: string; requiredLevel: string; gap: string; importance: string }>;
  profileSummary: string;
}): string {
  return [
    "You are a learning-path designer for students and freshers.",
    "Build a personalised, ordered learning roadmap that closes EXACTLY the listed skill gaps.",
    "Return STRICT JSON matching the schema.",
    "Ordering rule: fundamentals first, then applied concepts, then integration, then a build-a-real-project step, and finish with an 'update your resume' step.",
    "Each item:",
    "- skill: which gap it closes (must be one of the supplied gap skills).",
    "- title: short and concrete.",
    "- description: 1-2 sentences on why this matters for the target role.",
    "- duration: e.g. '5 days'.",
    "- learningObjective: what the student will be able to do afterwards.",
    "- practicalTask: a small, verifiable deliverable.",
    "- resources: 1-3 free, well-known resources (official docs preferred).",
    `Do NOT invent skills that are not in the gap list. Do not promise jobs or salaries.`,
    "",
    `TARGET OPPORTUNITY: ${input.targetOpportunity || "General career readiness"}`,
    `TARGET SKILLS TO CLOSE: ${input.targetSkills.join(", ") || "none supplied"}`,
    `STUDENT PROFILE SUMMARY: ${input.profileSummary}`,
    `SKILL GAPS: ${JSON.stringify(input.gaps)}`,
  ].join("\n");
}

/**
 * ONE combined request for the job-analysis workflow: the learning roadmap AND
 * the per-gap guidance ("what should I build to close this gap?") come back
 * together. Replaces the previous two-call flow (a standalone gap-note pass +
 * a separate roadmap request) so one job analysis costs ONE extraction request
 * plus this ONE plan request.
 */
export const ROADMAP_WITH_GAPS_SCHEMA = {
  type: "object",
  properties: {
    estimatedDuration: { type: "string" },
    items: ROADMAP_SCHEMA.properties.items,
    gapNotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          note: { type: "string" },
          gapSeverity: { type: "string" },
        },
        required: ["skill", "note"],
      },
    },
  },
  required: ["items", "gapNotes"],
} as const;

export function buildRoadmapWithGapsPrompt(input: {
  targetOpportunity: string;
  targetSkills: string[];
  gaps: Array<{ skill: string; currentLevel: string; requiredLevel: string; gap: string; importance: string }>;
  profileSummary: string;
}): string {
  return [
    buildRoadmapPrompt(input),
    "",
    "IN THE SAME RESPONSE also fill `gapNotes` — for EACH supplied skill gap:",
    "- skill: copy the gap skill exactly as supplied.",
    "- note: ONE short, specific sentence on what the student should build to close it (max 240 characters).",
    '- gapSeverity: "Minor" | "Moderate" | "Significant".',
    "Never claim the student has skills they do not have. Use only the supplied information.",
  ].join("\n");
}

export const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    area: { type: "string" },
    insight: { type: "string" },
    action: { type: "string" },
    confidence: { type: "string" },
    skillsToPrioritize: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["area", "insight", "action", "confidence", "skillsToPrioritize", "recommendations"],
} as const;

export function buildRejectionPrompt(input: {
  category: string;
  explanation: string;
  profileSkills: string[];
  missingSkills: string[];
  company?: string;
  position?: string;
}): string {
  return [
    "You help a student learn from a job rejection.",
    "Return STRICT JSON matching the schema.",
    "Hard rules:",
    "- You do NOT know the company's actual reason. Never claim to know it.",
    "- Base your analysis ONLY on the category the student selected and the explanation they wrote (plus their stored skill gaps for context).",
    "- If the explanation is empty, say the signal is weak and set confidence to 'Low'.",
    "- area: the improvement area, phrased neutrally.",
    "- insight: what the captured signal most likely points to, hedged appropriately.",
    "- action: ONE concrete next step the student can take, grounded in what they told you.",
    "- skillsToPrioritize: skills named in the explanation, or their stored missing skills when relevant. Empty array if none.",
    "- recommendations: 2-4 short supporting recommendations.",
    `- Add no invented facts about the company.`,
    "",
    `CATEGORY SELECTED BY STUDENT: ${input.category}`,
    `STUDENT'S OWN EXPLANATION: ${input.explanation || "(none provided)"}`,
    input.company ? `ROLE: ${input.position} at ${input.company}` : "",
    `STUDENT SKILLS: ${input.profileSkills.join(", ") || "(none)"}`,
    `SKILLS MISSING FROM THIS ROLE: ${input.missingSkills.join(", ") || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const TRUST_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string" },
    indicators: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          status: { type: "string" },
          detail: { type: "string" },
        },
        required: ["label", "status", "detail"],
      },
    },
  },
  required: ["status", "indicators"],
} as const;

export function buildTrustPrompt(input: {
  description: string;
  company: string;
  applicationInfo: string;
}): string {
  return [
    "You review job postings for warning signs. You never guarantee that a posting is legitimate.",
    "Evaluate: company information, job description completeness, contact information, salary/stipend transparency, application method, payment requests, suspicious wording, unusual requirements, and external links.",
    'Return STRICT JSON: {"status":"Review recommended"|"No major warning signs detected"|"Not enough information to verify this opportunity.","indicators":[{"label":"...","status":"good"|"watch"|"unknown","detail":"..."}]}',
    "Include these indicator labels exactly: Company information, Job description completeness, Contact information, Salary / stipend transparency, Application method, Payment requests, Suspicious wording, Unusual requirements, External links.",
    `If the text is too short to judge, use status "Not enough information to verify this opportunity." with unknown indicators.`,
    "Never state that a job is safe or verified — only report observable signals.",
    "",
    `COMPANY: ${input.company}`,
    `APPLICATION INFO: ${input.applicationInfo}`,
    "--- POSTING TEXT START ---",
    input.description.slice(0, 12000),
    "--- POSTING TEXT END ---",
  ].join("\n");
}

export function buildTailoredResumePrompt(input: {
  resumeText: string;
  jobTitle: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  responsibilitiesRaw?: string;
}): string {
  return [
    "You tailor an EXISTING resume for one specific job.",
    "Return the complete tailored resume as plain text (no JSON, no markdown fences, no commentary).",
    "ABSOLUTE LIMITS — you may only:",
    "- reorder skills so job-relevant ones appear first,",
    "- reorder or re-emphasise the most relevant project and experience entries,",
    "- rewrite the professional summary for this role,",
    "- improve wording, grammar, structure and clarity.",
    "You must NOT invent, add or exaggerate skills, internships, companies, achievements, certifications, metrics, dates, job titles or experience of any kind.",
    "If the original resume has no experience section, keep it that way. Do not create one.",
    "Only use skills that already appear in the original resume.",
    "",
    `TARGET ROLE: ${input.jobTitle || "unspecified"} at ${input.company || "unspecified"}`,
    `JOB REQUIRED SKILLS: ${input.requiredSkills.join(", ") || "(none)"}`,
    `JOB PREFERRED SKILLS: ${input.preferredSkills.join(", ") || "(none)"}`,
    `SKILLS ALREADY IN THE RESUME THAT MATCH: ${input.matchedSkills.join(", ") || "(none)"}`,
    `SKILLS THE RESUME DOES NOT HAVE (mention nowhere): ${input.missingSkills.join(", ") || "(none)"}`,
    input.responsibilitiesRaw ? `WHAT THE ROLE INVOLVES: ${input.responsibilitiesRaw.slice(0, 800)}` : "",
    "",
    "--- ORIGINAL RESUME (the only source of facts) ---",
    input.resumeText.slice(0, 20000),
    "--- END ORIGINAL RESUME ---",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChangeSummaryPrompt(input: {
  original: string;
  tailored: string;
}): string {
  return [
    "List what changed between an original resume and its job-tailored version.",
    'Return STRICT JSON: {"changes":[{"area":"...","change":"..."}],"improvedSummary":"..."}',
    "Allowed change types only: reordering, prioritising, wording, grammar, structure, clarity, relevance emphasis, summary rewrite.",
    "If nothing was reordered or removed, say so explicitly.",
    "Do NOT describe any added skill, experience, metric or achievement — because none may be added.",
    "",
    "--- ORIGINAL ---",
    input.original.slice(0, 8000),
    "--- TAILORED ---",
    input.tailored.slice(0, 8000),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Learning resources for a roadmap task                               */
/* ------------------------------------------------------------------ */

export const RESOURCE_SCHEMA = {
  type: "object",
  properties: {
    resources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          source: { type: "string" },
          language: { type: "string" },
        },
        required: ["kind", "title", "url"],
      },
    },
  },
  required: ["resources"],
} as const;

/**
 * Prompt for real learning resources. URL honesty is the hard requirement here:
 * the model must only return URLs it is confident exist, and every URL is
 * checked server-side afterwards.
 */
export function buildLearningResourcePrompt(input: {
  skill: string;
  itemTitle: string;
  taskDescription: string;
  targetOpportunity: string;
  language: string;
  rejectionSkills: string[];
}): string {
  return [
    "You find free learning resources for one specific skill a student must learn.",
    "Return STRICT JSON matching this shape:",
    '{"resources":[{"kind":"youtube_video"|"youtube_playlist"|"course"|"website","title":"...","url":"https://...","source":"...","language":"..."}]}',
    "",
    "URL RULES — these are absolute:",
    "- Only return URLs you are confident are REAL and currently reachable.",
    "- NEVER invent or guess a YouTube video ID, playlist ID, or a deep link that may not exist.",
    "- If you are not certain of a specific video or playlist URL, return the real channel URL " +
      "(for example https://www.youtube.com/@channelname) or a YouTube search URL of the form " +
      '"https://www.youtube.com/results?search_query=..." built from the skill and the language.',
    "- Official documentation, well-known free course platforms (freeCodeCamp, NPTEL, SWAYAM, " +
      "Microsoft Learn, Kaggle Learn, The Odin Project, Great Learning Academy, Coursera free courses) " +
      "and official YouTube channels are preferred.",
    "- Deep links must be real documentation pages, not guessed paths.",
    "",
    "CONTENT RULES:",
    `- The recommendations must match THIS skill/task exactly: ${input.skill}${input.itemTitle ? ` (task: ${input.itemTitle})` : ""}.`,
    input.taskDescription ? `- The learner's practical task is: ${input.taskDescription}` : "",
    `- Preferred learning language: ${input.language}. Prefer channels/courses that teach in that language; if good ` +
      `${input.language} material is genuinely limited for this skill, include the best language-neutral or English options as well.`,
    "- Return 5 to 9 items and cover ALL FOUR kinds: at least one youtube_video, one youtube_playlist, one free course, and one useful website.",
    "- 'title' must be short and describe the resource truthfully (no clickbait).",
    "- 'source' is the platform or channel name.",
    input.targetOpportunity ? `- The roadmap targets this role: ${input.targetOpportunity}` : "",
    input.rejectionSkills.length
      ? `- Rejection feedback the student has recorded points at these skills: ${input.rejectionSkills.join(", ")}. ` +
        "Use them only to prioritise depth, never to invent progress."
      : "",
    "- If the skill name is vague or generic, still focus the recommendations on it.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* TOKEN-OPTIMISED COMBINED OPERATIONS                                 */
/*                                                                     */
/* Each of the builders below turns two former Gemini round-trips into */
/* ONE request, with the large input (resume / job description) sent   */
/* exactly once. Response shapes stay strict JSON.                     */
/* ------------------------------------------------------------------ */

/**
 * ONE request for the whole resume pass: quality analysis AND structured
 * profile extraction. Replaces the previous two-call flow
 * (`analyzeResume` + `extractProfileFromResume`) that sent the same resume
 * text to Gemini twice.
 */
export const RESUME_FULL_SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "object",
      properties: {
        score: { type: "integer" },
        breakdown: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, score: { type: "integer" } },
            required: ["label", "score"],
          },
        },
        strengths: { type: "array", items: { type: "string" } },
        weaknesses: { type: "array", items: { type: "string" } },
        improvements: {
          type: "array",
          items: {
            type: "object",
            properties: { category: { type: "string" }, detail: { type: "string" } },
            required: ["category", "detail"],
          },
        },
        skillObservations: { type: "array", items: { type: "string" } },
        projectObservations: { type: "array", items: { type: "string" } },
        experienceObservations: { type: "array", items: { type: "string" } },
        educationObservations: { type: "array", items: { type: "string" } },
        formattingObservations: { type: "array", items: { type: "string" } },
        summaryObservation: { type: "string" },
        jobRelevance: { type: "string" },
        improvedSummary: { type: "string" },
      },
      required: ["score", "breakdown", "strengths", "weaknesses", "improvements"],
    },
    profile: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        location: { type: "string" },
        education: { type: "string" },
        degree: { type: "string" },
        branch: { type: "string" },
        graduationYear: { type: "string" },
        cgpa: { type: "string" },
        careerObjective: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        projects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              technologies: { type: "array", items: { type: "string" } },
              link: { type: "string" },
            },
            required: ["title"],
          },
        },
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              role: { type: "string" },
              duration: { type: "string" },
              description: { type: "string" },
            },
            required: ["company", "role"],
          },
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              issuer: { type: "string" },
              year: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["name", "email", "phone", "skills", "projects", "experience", "certifications"],
    },
  },
  required: ["analysis", "profile"],
} as const;

/**
 * The resume text is embedded ONCE. The model returns the review and the
 * extraction together, so no second call ever needs to re-send the resume.
 */
export function buildUnifiedResumePrompt(resumeText: string, targetRole?: string): string {
  return [
    "You are an experienced technical recruiter AND a precise resume parser.",
    "From the SINGLE resume text below, produce BOTH:",
    "(1) a structured resume quality review, and",
    "(2) a structured profile extraction.",
    FACT_RULE,
    "",
    "ANALYSIS RULES:",
    "- Analyse STRUCTURE, CLARITY, SKILLS, PROJECTS, EXPERIENCE, EDUCATION, SUMMARY, JOB RELEVANCE and FORMATTING/READABILITY.",
    "- score = overall 0-100 quality score, derived from the actual content you can see.",
    "- breakdown = exactly these six labels with 0-100 scores: Skills, Projects, Experience, Education, Formatting, Job relevance.",
    "- strengths = max 6 short, specific strengths grounded in the real content.",
    "- weaknesses = max 6 short, specific weaknesses grounded in the real content (the flip side of improvements).",
    "- improvements = max 6 concrete fixes referencing the real content.",
    "- Each observation array = short, specific notes about what is actually present or missing.",
    "- improvedSummary = a rewritten professional summary using ONLY facts already present in the resume.",
    "- Never inflate the score: a resume with no projects or no measurable outcomes must score lower on those axes.",
    targetRole ? `- The candidate is targeting: ${targetRole}. Weight job relevance accordingly.` : "",
    "",
    "EXTRACTION RULES (fill the `profile` object):",
    "- skills: only concrete technologies, tools, languages and clearly stated soft skills. No sentences.",
    "- projects: only projects actually described, with whatever technologies the resume states.",
    "- experience: only real roles/internships listed. If there are none, return an empty array.",
    "- certifications: only certifications named in the text.",
    "- careerObjective: reuse the candidate's existing summary/objective if present; otherwise write one short objective using ONLY facts already in the resume (branch, skills, year).",
    "",
    'Return STRICT JSON of the shape {"analysis":{...},"profile":{...}}.',
    "",
    "--- RESUME TEXT START ---",
    resumeText.slice(0, 20000),
    "--- RESUME TEXT END ---",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * ONE request for a resume rewrite (general improvement OR job tailoring) that
 * also returns the change list. Replaces the previous two-call flow where the
 * rewritten resume was sent BACK to Gemini for a change summary.
 */
export const RESUME_REWRITE_SCHEMA = {
  type: "object",
  properties: {
    improvedResume: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: { area: { type: "string" }, change: { type: "string" } },
        required: ["area", "change"],
      },
    },
  },
  required: ["improvedResume", "changes"],
} as const;

export function buildResumeRewritePrompt(
  input: {
    resumeText: string;
    jobTitle: string;
    company: string;
    requiredSkills: string[];
    preferredSkills: string[];
    matchedSkills: string[];
    missingSkills: string[];
    responsibilitiesRaw?: string;
  },
  extraInstructions = "",
): string {
  return [
    "You rewrite an EXISTING resume and report what you changed — in ONE response.",
    "Return STRICT JSON with exactly these two fields:",
    '{"improvedResume":"<the complete rewritten resume as plain text>","changes":[{"area":"...","change":"..."}]}',
    "`changes` = max 8 entries describing what you actually changed. Allowed change types only: reordering, prioritising, wording, grammar, structure, clarity, relevance emphasis, summary rewrite. If nothing was reordered or removed, say so explicitly.",
    "ABSOLUTE LIMITS — inside improvedResume you may only:",
    "- reorder skills so job-relevant ones appear first,",
    "- reorder or re-emphasise the most relevant project and experience entries,",
    "- rewrite the professional summary for this role,",
    "- improve wording, grammar, structure and clarity.",
    "You must NOT invent, add or exaggerate skills, internships, companies, achievements, certifications, metrics, dates, job titles or experience of any kind.",
    "If the original resume has no experience section, keep it that way. Do not create one.",
    "Only use skills that already appear in the original resume.",
    "Never describe a change you did not actually make in improvedResume.",
    "",
    `TARGET ROLE: ${input.jobTitle || "unspecified"} at ${input.company || "unspecified"}`,
    `JOB REQUIRED SKILLS: ${input.requiredSkills.join(", ") || "(none)"}`,
    `JOB PREFERRED SKILLS: ${input.preferredSkills.join(", ") || "(none)"}`,
    `SKILLS ALREADY IN THE RESUME THAT MATCH: ${input.matchedSkills.join(", ") || "(none)"}`,
    `SKILLS THE RESUME DOES NOT HAVE (mention nowhere): ${input.missingSkills.join(", ") || "(none)"}`,
    input.responsibilitiesRaw ? `WHAT THE ROLE INVOLVES: ${input.responsibilitiesRaw.slice(0, 800)}` : "",
    extraInstructions,
    "",
    "--- ORIGINAL RESUME (the only source of facts) ---",
    input.resumeText.slice(0, 20000),
    "--- END ORIGINAL RESUME ---",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * ONE request for a pasted / screenshot job posting: structured requirements
 * AND the trust-check indicators. Both read the same posting text, so the
 * posting is sent to Gemini only once.
 */
export const JOB_WITH_TRUST_SCHEMA = {
  type: "object",
  properties: {
    ...JOB_SCHEMA.properties,
    trust: {
      type: "object",
      properties: {
        status: { type: "string" },
        indicators: TRUST_SCHEMA.properties.indicators,
      },
      required: ["status", "indicators"],
    },
  },
  required: [...JOB_SCHEMA.required, "trust"],
} as const;

export function buildJobExtractionWithTrustPrompt(source: "text" | "image"): string {
  return [
    buildJobExtractionPrompt(source),
    "",
    "IN THE SAME RESPONSE also fill the `trust` object (posting safety review):",
    "Evaluate: company information, job description completeness, contact information, salary/stipend transparency, application method, payment requests, suspicious wording, unusual requirements, external links.",
    'trust.status must be exactly one of: "Review recommended" | "No major warning signs detected" | "Not enough information to verify this opportunity."',
    "trust.indicators must use exactly these labels: Company information, Job description completeness, Contact information, Salary / stipend transparency, Application method, Payment requests, Suspicious wording, Unusual requirements, External links — each with status \"good\" | \"watch\" | \"unknown\" and a short detail.",
    "If the text is too short to judge, use the \"Not enough information to verify this opportunity.\" status with unknown indicators.",
    'Never state that a job is safe or verified — only report observable signals. Keep each detail under 200 characters.',
  ].join("\n");
}
