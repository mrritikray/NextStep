/**
 * Demo-mode fallbacks.
 *
 * These run ONLY when GEMINI_API_KEY is missing or the configured model cannot
 * be used. They are deterministic and — importantly — derived from the actual
 * uploaded/entered content, never from a hard-coded fake result.
 */
import { NOT_FOUND } from "./prompts";
import type {
  ExtractedProfile,
  FeedbackAnalysis,
  JobRequirements,
  ResumeAnalysis,
} from "./types";

/* ------------------------------------------------------------------ */
/* Resume text parsing                                                 */
/* ------------------------------------------------------------------ */

const SECTION_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "summary", pattern: /^(professional\s+)?(summary|objective|profile|about\s?me)\b/i },
  { key: "skills", pattern: /^(technical\s+)?(skills|technologies|tech\s?stack|competenc)/i },
  { key: "education", pattern: /^(education|academics|academic\s+background|qualification)/i },
  { key: "projects", pattern: /^(projects?|personal\s+projects|academic\s+projects)\b/i },
  { key: "experience", pattern: /^(work\s+)?(experience|employment|internships?)\b/i },
  { key: "certifications", pattern: /^(certifications?|licenses?|courses?|achievements?)\b/i },
];

/** Split resume text into sections by looking at the lines themselves. */
export function splitSections(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = { header: [] };
  let current = "header";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const header = line.replace(/[:\-–—\s]+$/, "");
    const isHeading =
      header.length < 45 &&
      SECTION_PATTERNS.find(item => item.pattern.test(header)) !== undefined;

    if (isHeading) {
      const matched = SECTION_PATTERNS.find(item => item.pattern.test(header));
      if (matched) {
        current = matched.key;
        if (!sections[current]) sections[current] = [];
        continue;
      }
    }
    (sections[current] ??= []).push(line);
  }

  return sections;
}

const KNOWN_SKILLS = [
  "javascript","typescript","react","next.js","vue","angular","node","express","html","css",
  "tailwind","sass","bootstrap","python","django","flask","fastapi","java","spring","kotlin",
  "swift","c","c++","c#",".net","go","rust","php","laravel","ruby","rails","sql","mysql",
  "postgresql","mongodb","redis","sqlite","firebase","supabase","git","github","gitlab",
  "docker","kubernetes","aws","azure","gcp","linux","bash","rest api","graphql","redux",
  "figma","photoshop","canva","excel","powerpoint","pandas","numpy","tensorflow","pytorch",
  "scikit-learn","machine learning","deep learning","nlp","data analysis","data structures",
  "algorithms","object oriented programming","testing","jest","cypress","selenium","postman",
  "jira","agile","scrum","communication","teamwork","leadership","problem solving","time management",
  "adaptability","critical thinking","presentation","public speaking","salesforce","wordpress",
];

/**
 * Keyword extraction for demo mode: only returns terms that literally appear in
 * the source text. No generic list is ever returned for a job description.
 */
export function findMentionedSkills(text: string): string[] {
  const haystack = text.toLowerCase();
  const found: string[] = [];

  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundary = /^[a-z0-9]/i.test(skill) && /[a-z0-9]$/i.test(skill);
    const pattern = boundary
      ? new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i")
      : new RegExp(escaped, "i");
    if (pattern.test(haystack)) found.push(skill);
  }

  return found;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const CGPA_RE = /\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*10|\/\s*4|cgpa|gpa|%)/i;
const DEGREE_RE =
  /\b(b\.?\s?tech|b\.?\s?e\.?|bachelor[^\n,]{0,30}|b\.?\s?sc|bca|mca|m\.?\s?tech|master[^\n,]{0,30}|diploma|12th|high school)\b/i;
const BRANCH_RE =
  /\b(computer science(?: & engineering)?|cse|information technology|it|electronics(?: and communication)?|ece|mechanical|civil|electrical|data science|artificial intelligence|ai\s?&\s?ml|business administration|bca)\b/i;

export function extractProfileFromText(resumeText: string): ExtractedProfile {
  const sections = splitSections(resumeText);
  const header = sections.header ?? [];
  const headerText = header.join(" ");

  const email = EMAIL_RE.exec(resumeText)?.[0] ?? NOT_FOUND;
  const phone = PHONE_RE.exec(resumeText)?.[0]?.trim() ?? NOT_FOUND;

  // The name is usually the first short line that has no digits and is not a heading.
  const name =
    header.find(
      line =>
        line.length <= 40 &&
        !/\d/.test(line) &&
        !/resume|curriculum vitae|@/i.test(line) &&
        line.split(" ").length <= 4,
    ) ?? NOT_FOUND;

  const locationLine = header.find(line => /,/.test(line) && !/@/.test(line));
  const location = locationLine ?? NOT_FOUND;

  const educationBlock = (sections.education ?? []).join("\n");
  const degreeMatch = DEGREE_RE.exec(educationBlock || resumeText)?.[0];
  const branchMatch = BRANCH_RE.exec(educationBlock || resumeText)?.[0];
  const graduationYear =
    (educationBlock.match(/\b(20\d{2})\b/g) ?? []).sort().pop() ?? NOT_FOUND;
  const cgpa = CGPA_RE.exec(educationBlock || resumeText)?.[0]?.trim() ?? NOT_FOUND;

  const skillsBlock = (sections.skills ?? []).join(", ");
  const skillsFromSection = skillsBlock
    ? KNOWN_SKILLS.filter(skill =>
        new RegExp(`(^|[^a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(
          skillsBlock,
        ),
      )
    : [];
  const inferred = skillsFromSection.length
    ? skillsFromSection
    : findMentionedSkills(resumeText).filter(skill =>
        resumeText.toLowerCase().includes(skill.toLowerCase()),
      );

  const summary = (sections.summary ?? []).join(" ").trim();

  const projects = (sections.projects ?? [])
    .filter(line => !/^[•\-*]$/.test(line))
    .reduce<Array<{ title: string; description: string; technologies: string[] }>>((acc, line) => {
      const isBullet = /^[•\-*\u2022]/.test(line);
      const clean = line.replace(/^[•\-*\u2022\s]+/, "");
      if (!isBullet && clean.length > 2 && clean.length < 90) {
        acc.push({ title: clean, description: "", technologies: [] });
      } else if (acc.length) {
        const last = acc[acc.length - 1];
        last.description = `${last.description} ${clean}`.trim();
      }
      return acc;
    }, [])
    .map(project => ({
      ...project,
      technologies: findMentionedSkills(`${project.title} ${project.description}`),
    }));

  const experience = (sections.experience ?? []).reduce<
    Array<{ company: string; role: string; duration: string; description: string }>
  >((acc, line) => {
    const isBullet = /^[•\-*\u2022]/.test(line);
    const clean = line.replace(/^[•\-*\u2022\s]+/, "");
    const hasDate = YEAR_RE.test(clean) || /(present|month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(clean);
    if (!isBullet && hasDate && clean.length < 120) {
      const [left, right] = clean.split(/[|–—]|\bat\b/i).map(part => part?.trim());
      acc.push({
        company: right?.split(/[(,]/)[0]?.trim() || NOT_FOUND,
        role: left || clean,
        duration: (clean.match(/\(([^)]+)\)/) ?? [])[1] ?? NOT_FOUND,
        description: "",
      });
    } else if (acc.length) {
      const last = acc[acc.length - 1];
      last.description = `${last.description} ${clean}`.trim();
    } else if (clean.length > 10) {
      acc.push({ company: clean, role: NOT_FOUND, duration: NOT_FOUND, description: "" });
    }
    return acc;
  }, []);

  const certifications = (sections.certifications ?? [])
    .flatMap(line => line.split(/[;,]/))
    .map(item => item.replace(/^[•\-*\u2022\s]+/, "").trim())
    .filter(item => item.length > 2 && item.length < 120)
    .map(item => ({ name: item, issuer: NOT_FOUND, year: (YEAR_RE.exec(item) ?? [""])[0] || NOT_FOUND }));

  const notFound: string[] = [];
  const check = (label: string, value: string | unknown[]) => {
    if (!value || value === NOT_FOUND || (Array.isArray(value) && value.length === 0)) notFound.push(label);
  };
  check("Name", name);
  check("Email", email);
  check("Phone", phone);
  check("Location", location);
  check("Degree", degreeMatch ?? NOT_FOUND);
  check("Branch", branchMatch ?? NOT_FOUND);
  check("CGPA / percentage", cgpa);
  check("Projects", projects);
  check("Experience", experience);
  check("Certifications", certifications);

  return {
    name,
    email,
    phone,
    location,
    education: educationBlock || NOT_FOUND,
    degree: degreeMatch ?? NOT_FOUND,
    branch: branchMatch ?? NOT_FOUND,
    graduationYear,
    cgpa,
    careerObjective: summary || NOT_FOUND,
    skills: inferred.map(skill => skill.replace(/\b\w/g, char => char.toUpperCase())),
    projects,
    experience,
    certifications,
    notFound,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic resume analysis (demo mode)                           */
/* ------------------------------------------------------------------ */

export function analyseResumeText(resumeText: string): ResumeAnalysis {
  const sections = splitSections(resumeText);
  const words = resumeText.split(/\s+/).filter(Boolean).length;
  const bulletCount = (resumeText.match(/^[•\-*\u2022]/gm) ?? []).length;
  const hasEmail = EMAIL_RE.test(resumeText);
  const hasPhone = PHONE_RE.test(resumeText);
  const hasLinks = /https?:\/\/|linkedin|github/i.test(resumeText);
  const hasMetrics = /\b\d+(\.\d+)?\s*(%|percent|users|k\b|months?|weeks?|hours?|x\b)/i.test(resumeText);
  const actionVerbs = (resumeText.match(/\b(built|developed|designed|implemented|created|automated|improved|led|managed|deployed|optimised|optimized|reduced|increased)\b/gi) ?? []).length;
  const skills = findMentionedSkills(resumeText);
  const hasProjects = (sections.projects ?? []).length > 0;
  const hasExperience = (sections.experience ?? []).length > 0;
  const hasEducation = (sections.education ?? []).length > 0;
  const hasSummary = (sections.summary ?? []).length > 0;
  const hasCertifications = (sections.certifications ?? []).length > 0;

  const clamp = (value: number) => Math.max(5, Math.min(100, Math.round(value)));

  const skillsScore = clamp(35 + skills.length * 6 + (hasCertifications ? 5 : 0));
  const projectsScore = clamp((hasProjects ? 55 : 25) + Math.min(30, (sections.projects ?? []).length * 6) + (hasMetrics ? 10 : 0));
  const experienceScore = clamp(hasExperience ? 55 + Math.min(30, (sections.experience ?? []).length * 8) : 40);
  const educationScore = clamp(hasEducation ? 80 + (CGPA_RE.test(resumeText) ? 10 : 0) : 45);
  const formattingScore = clamp(50 + (hasEmail ? 10 : 0) + (hasPhone ? 10 : 0) + (hasLinks ? 10 : 0) + Math.min(15, bulletCount * 1.5));
  const relevanceScore = clamp(45 + skills.length * 4 + (hasSummary ? 10 : 0) + actionVerbs * 2);

  const breakdown = [
    { label: "Skills", score: skillsScore, color: "#59a894" },
    { label: "Projects", score: projectsScore, color: "#668dca" },
    { label: "Experience", score: experienceScore, color: "#d49b4f" },
    { label: "Education", score: educationScore, color: "#8a6eb4" },
    { label: "Formatting", score: formattingScore, color: "#ca725f" },
    { label: "Job relevance", score: relevanceScore, color: "#4e9a8e" },
  ];

  const score = clamp(breakdown.reduce((sum, item) => sum + item.score, 0) / breakdown.length);

  const strengths: string[] = [];
  if (hasEmail && hasPhone) strengths.push("Contact details are present and easy to find.");
  if (hasLinks) strengths.push("The resume links out to a profile or portfolio.");
  if (skills.length >= 4) strengths.push(`A clear skill set is listed (${skills.slice(0, 6).join(", ")}).`);
  if (hasProjects) strengths.push("At least one project section gives the resume evidence to discuss.");
  if (hasEducation) strengths.push("Education is documented with a recognisable institution and qualification.");
  if (!strengths.length) strengths.push("The resume text was parsed successfully and is ready for review.");

  const improvements: Array<{ category: string; detail: string }> = [];
  if (!hasProjects) improvements.push({ category: "Projects", detail: "Add at least one project with the technologies you actually used." });
  if (!hasMetrics) improvements.push({ category: "Projects", detail: "Add measurable outcomes (users, time saved, dataset size) to the work you already describe." });
  if (!hasSummary) improvements.push({ category: "Structure", detail: "Add a 2-3 line professional summary at the top, drawn only from facts already in the resume." });
  if (!hasExperience) improvements.push({ category: "Experience", detail: "No experience section found. Add internships, freelance work, or open-source contributions if you have any." });
  if (!hasLinks) improvements.push({ category: "Formatting", detail: "Add your GitHub or portfolio link so reviewers can see the work." });
  if (actionVerbs < 3) improvements.push({ category: "Clarity", detail: "Start more bullets with strong action verbs (built, implemented, automated)." });
  if (!hasCertifications) improvements.push({ category: "Education", detail: "Consider listing relevant courses or certifications you have completed." });

  return {
    score,
    breakdown,
    strengths,
    improvements: improvements.slice(0, 6),
    skillObservations: skills.length
      ? [`${skills.length} recognisable skills detected: ${skills.slice(0, 10).join(", ")}.`]
      : ["No recognisable technical skills were detected in the text."],
    projectObservations: hasProjects
      ? [`${(sections.projects ?? []).length} project line(s) detected.`, hasMetrics ? "Outcome-style metrics are present." : "No measurable project outcomes were detected."]
      : ["No project section was detected."],
    experienceObservations: hasExperience
      ? [`${(sections.experience ?? []).length} experience line(s) detected.`]
      : ["No experience or internship section was detected."],
    educationObservations: hasEducation
      ? ["Education section detected.", CGPA_RE.test(resumeText) ? "An academic score is stated." : "No CGPA or percentage was found."]
      : ["No education section was detected."],
    formattingObservations: [
      `${words} words detected.`,
      `${bulletCount} bullet line(s) detected.`,
      hasLinks ? "External links are present." : "No external links detected.",
    ],
    summaryObservation: hasSummary
      ? "A summary/objective section is present."
      : "No summary or objective section was detected.",
    jobRelevance:
      skills.length >= 4
        ? "The resume names enough concrete skills to be screened against most internship postings."
        : "Add more concrete technologies so automated and human screening can match you confidently.",
    improvedSummary: buildFactualSummary(resumeText, skills),
  };
}

function buildFactualSummary(resumeText: string, skills: string[]): string {
  const sections = splitSections(resumeText);
  const education = (sections.education ?? []).join(" ");
  const degree = DEGREE_RE.exec(education || resumeText)?.[0] ?? "";
  const branch = BRANCH_RE.exec(education || resumeText)?.[0] ?? "";
  const year = (education.match(/\b(20\d{2})\b/g) ?? []).pop() ?? "";

  const who = degree
    ? `${degree.replace(/\b\w/g, char => char.toUpperCase())}${branch ? ` (${branch})` : ""} student`
    : "Student";
  const focus = skills.slice(0, 4).join(", ");

  const sentences = [
    `${who}${year ? `, graduating in ${year}` : ""}${focus ? `, working with ${focus}` : ""}.`,
    (sections.projects ?? []).length
      ? "Has built practical projects using the technologies listed above."
      : "Building practical projects to turn the listed skills into demonstrable evidence.",
    "Focused on learning quickly and shipping work that can be reviewed and discussed.",
  ];
  return sentences.join(" ");
}

/* ------------------------------------------------------------------ */
/* Job extraction fallback (demo mode)                                 */
/* ------------------------------------------------------------------ */

export function extractJobFromText(text: string): JobRequirements {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  const company =
    (/(?:company|organisation|organization|employer)\s*[:\-]\s*(.+)/i.exec(text)?.[1] ?? "").trim() ||
    (/(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{2,40})/.exec(text)?.[1] ?? "").trim() ||
    lines[0]?.match(/^([A-Z][A-Za-z0-9&.\- ]{2,40})\b/)?.[1]?.trim() ||
    NOT_FOUND;

  const jobTitle =
    (/(?:job\s*title|position|role|designation)\s*[:\-]\s*(.+)/i.exec(text)?.[1] ?? "").trim() ||
    lines.find(line => /(intern|developer|engineer|analyst|designer|manager|associate|trainee)/i.test(line) && line.length < 90) ||
    NOT_FOUND;

  const location =
    (/(?:location|based in|work\s*from)\s*[:\-]\s*(.+)/i.exec(text)?.[1] ?? "").trim() ||
    (/\b(remote|hybrid|on-?site|work from home|wfh)\b/i.exec(text)?.[0] ?? "") ||
    lines.find(line => /(bangalore|bengaluru|pune|mumbai|delhi|hyderabad|chennai|kochi|kolkata|jaipur|noida|gurgaon|remote)/i.test(line)) ||
    NOT_FOUND;

  const employmentType =
    (/(internship|full[\s-]?time|part[\s-]?time|contract|freelance|trainee)/i.exec(text)?.[0] ?? "") ||
    NOT_FOUND;

  const compensation =
    (/(?:₹|rs\.?|inr|\$)\s?[\d,]+(?:\.\d+)?(?:\s*(?:\/|per\s*)?(?:month|mo|year|annum|hour|lpa|k))?/i.exec(text)?.[0] ?? "") ||
    (/(?:stipend|salary|compensation|ctc|pay)\s*[:\-]?\s*([^\n.]{2,60})/i.exec(text)?.[1] ?? "") ||
    NOT_FOUND;

  const educationRequirement =
    (/((?:b\.?\s?tech|b\.?\s?e\.?|bachelor|b\.?\s?sc|bca|mca|m\.?\s?tech|diploma|any\s+graduate|pursuing|final\s+year)[^\n.]{0,80})/i.exec(text)?.[1] ?? "") ||
    NOT_FOUND;

  const experienceRequirement =
    (/((?:\d+(?:\.\d+)?)\s*\+?\s*(?:-|to)?\s*(?:\d+(?:\.\d+)?)?\s*(?:years?|yrs?)[^\n.]{0,40})/i.exec(text)?.[1] ?? "") ||
    (/(fresher[s]?|entry[\s-]?level|no\s+prior\s+experience|0-1\s+years?)/i.exec(text)?.[0] ?? "") ||
    NOT_FOUND;

  const eligibility =
    (/(?:eligib(?:ility|ible)|requirements?)\s*[:\-]?\s*([^\n]{0,200})/i.exec(text)?.[1] ?? "").trim() ||
    NOT_FOUND;

  const responsibilitiesRaw =
    (/(?:responsibilit(?:y|ies)|what you(?:'|’)?ll do|role)\s*[:\-]?\s*([\s\S]{0,800})/i.exec(text)?.[1] ??
      lines.filter(line => /^[•\-*\u2022]/.test(line)).slice(0, 8).join("\n")).trim();

  const allSkills = findMentionedSkills(text);
  const preferredMarker = /(preferred|nice to have|good to have|bonus|plus|optional)/i.test(lower);
  const requiredSection = lower.split(/preferred|nice to have|good to have|bonus|optional/)[0] ?? lower;
  const requiredDetected = findMentionedSkills(requiredSection);

  const requiredSkills = (preferredMarker && requiredDetected.length ? requiredDetected : allSkills).map(titleCase);
  const preferredSkills = preferredMarker
    ? allSkills.filter(skill => !requiredSkills.includes(titleCase(skill))).map(titleCase)
    : [];

  return {
    company,
    jobTitle,
    location,
    employmentType,
    compensation,
    eligibility,
    requiredSkills,
    preferredSkills,
    responsibilities: responsibilitiesRaw
      ? responsibilitiesRaw.split("\n").map(line => line.replace(/^[•\-*\u2022\s]+/, "").trim()).filter(Boolean).slice(0, 8)
      : [],
    responsibilitiesRaw,
    experienceRequirement,
    educationRequirement,
    applicationInfo: (/(apply|application|send your resume|email)[^\n.]{0,80}/i.exec(text)?.[0] ?? NOT_FOUND).trim(),
    insufficientInformation: allSkills.length === 0 && !jobTitle.match(/intern|developer|engineer|analyst|designer/i),
  };
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map(word => (word.length <= 3 && /^(api|ui|ux|ml|ai|sql|css|html)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Roadmap + feedback fallbacks                                        */
/* ------------------------------------------------------------------ */

const RESOURCE_HINTS: Record<string, string[]> = {
  react: ["React — official tutorial (react.dev/learn)", "MDN — React getting started"],
  javascript: ["MDN — JavaScript guide", "javascript.info"],
  typescript: ["TypeScript Handbook"],
  node: ["Node.js — official docs", "MDN — Express introduction"],
  express: ["Express.js — official guide"],
  html: ["MDN — HTML basics"],
  css: ["MDN — CSS first steps"],
  tailwind: ["Tailwind CSS — official docs"],
  sql: ["SQLBolt — interactive SQL", "PostgreSQL tutorial"],
  mongodb: ["MongoDB University — basics"],
  "rest api": ["MDN — Fetch API", "Postman Learning Center"],
  git: ["Git — official book", "GitHub Skills"],
  testing: ["Jest — getting started", "Testing Library docs"],
  python: ["Python — official tutorial", "Real Python — basics"],
  docker: ["Docker — getting started"],
  communication: ["Coursera — effective communication", "Toastmasters practice guide"],
};

export function suggestResources(skill: string): string[] {
  const key = skill.toLowerCase();
  const exact = RESOURCE_HINTS[key];
  if (exact) return exact;
  const partial = Object.entries(RESOURCE_HINTS).find(([name]) => key.includes(name) || name.includes(key));
  if (partial) return partial[1];
  return [`Official documentation for ${skill}`, `Search "${skill} tutorial" on freeCodeCamp`];
}

export function fallbackRoadmap(input: {
  targetSkills: string[];
  gaps: Array<{ skill: string; importance: string; gap: string; requiredLevel: string }>;
  targetOpportunity: string;
}): { estimatedDuration: string; items: Array<{ skill: string; title: string; description: string; duration: string; learningObjective: string; practicalTask: string; resources: string[] }> } {
  const skills = input.targetSkills.length ? input.targetSkills : input.gaps.map(gap => gap.skill);
  const items: Array<{ skill: string; title: string; description: string; duration: string; learningObjective: string; practicalTask: string; resources: string[] }> = [];

  let totalDays = 0;
  const push = (item: typeof items[number]) => {
    items.push(item);
    totalDays += Number.parseInt(item.duration, 10) || 3;
  };

  for (const skill of skills.slice(0, 5)) {
    const gap = input.gaps.find(entry => entry.skill === skill);
    const days = gap?.importance === "High" ? 7 : gap?.importance === "Medium" ? 5 : 3;
    push({
      skill,
      title: `${skill}: fundamentals`,
      description: gap?.gap || `Build working knowledge of ${skill}, which this role expects.`,
      duration: `${days} days`,
      learningObjective: `Explain and use the core concepts of ${skill} without a tutorial.`,
      practicalTask: `Complete a guided exercise in ${skill} and commit it to a public repository.`,
      resources: suggestResources(skill),
    });
    if ((gap?.requiredLevel ?? "").toLowerCase() === "intermediate") {
      push({
        skill,
        title: `${skill}: applied practice`,
        description: `Move from reading about ${skill} to using it in a realistic scenario.`,
        duration: `${Math.max(3, days - 2)} days`,
        learningObjective: `Apply ${skill} inside a small but complete feature.`,
        practicalTask: `Add one feature to an existing project using ${skill}.`,
        resources: suggestResources(skill),
      });
    }
  }

  push({
    skill: skills[0] ?? "Project",
    title: "Build one proof project",
    description: "Turn the new skills into evidence a recruiter can inspect.",
    duration: "10 days",
    learningObjective: "Ship a small project with a README, screenshots and a live link.",
    practicalTask: `Build and publish a project that uses ${skills.slice(0, 3).join(", ") || "your new skills"}, with a clear README.`,
    resources: ["GitHub — writing a good README", "Vercel / Netlify free deployment"],
  });

  push({
    skill: "Resume",
    title: "Update your resume",
    description: "Capture the proof you have just earned while it is fresh.",
    duration: "1 day",
    learningObjective: "Rewrite your project bullets with outcomes and links.",
    practicalTask: "Update two resume bullets and re-run the NextStep resume review.",
    resources: ["NextStep Resume Review"],
  });

  return { estimatedDuration: `${totalDays} days`, items };
}

export function fallbackFeedback(input: {
  category: string;
  explanation: string;
  missingSkills: string[];
  profileSkills: string[];
}): FeedbackAnalysis {
  const note = input.explanation.trim();
  const mentioned = findMentionedSkills(note);
  const skills = mentioned.length ? mentioned.map(titleCase) : input.missingSkills.slice(0, 3);

  const area =
    input.category === "Unknown"
      ? note
        ? "Resume evidence and skill fit"
        : "Unclear signal"
      : input.category;

  const insight = !note
    ? `You selected "${input.category}" but did not add context, so there is not enough information to draw a conclusion.`
    : skills.length
      ? `Your note most likely points to ${skills.slice(0, 3).join(", ")} as the area to strengthen. This is an inference from what you wrote, not the company's stated reason.`
      : `Your note points to "${area}" as the area to investigate next. This is an inference from what you wrote, not the company's stated reason.`;

  const action = skills.length
    ? `Build one project that demonstrates ${skills[0]} and add it to your resume with a link and a measurable outcome.`
    : note
      ? "Rewrite the weakest section of your resume using only facts you already have, then apply to two similar roles and compare the outcome."
      : "Add a short note about what happened so the next analysis has something to work with.";

  return {
    area,
    insight,
    action,
    confidence: note.length > 40 ? "Medium" : note.length ? "Low" : "Low",
    skillsToPrioritize: skills.slice(0, 5),
    recommendations: [
      skills.length ? `Prioritise ${skills[0]} in your next roadmap.` : "Review your resume evidence for the roles you target most.",
      "Compare this rejection against your other applications for a repeating pattern.",
      "Only act on reasons you actually observed — do not assume the company's motive.",
    ],
    disclaimer:
      "This analysis is based only on the feedback you recorded. It does not claim to know the company's actual reason.",
    engine: "demo",
    applicationId: null,
    category: input.category,
    userExplanation: note,
  };
}
