/**
 * Token-usage verification harness.
 *
 * Boots a counting stub for the Gemini endpoint (GEMINI_BASE_URL) and runs the
 * REAL service code for:
 *
 *   1. the OLD resume flow  — analyzeResume() + extractProfileFromResume()
 *   2. the NEW resume flow  — analyzeResumeFull()
 *   3. one opportunity pass — extractJobRequirements() + analyzeOpportunity()
 *   4. one resume rewrite   — improveResume()
 *
 * It prints, per action: Gemini calls, prompt characters, how many times the
 * full resume text was transmitted, and the estimated input tokens. Exits
 * non-zero if the new resume flow is not exactly ONE call carrying the resume
 * exactly once.
 *
 * Run: npx tsx scripts/verify-token-usage.ts
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const RESUME = [
  "ASHA VERMA",
  "asha.verma@example.com | +91 98765 43210 | Pune, India",
  "B.Tech Computer Science, Pune Institute of Technology, 2027, CGPA 8.6/10",
  "",
  "SUMMARY",
  "Final-year Computer Science student focused on frontend engineering.",
  "",
  "SKILLS",
  "JavaScript, React, Node.js, Git, SQL, Communication",
  "",
  "PROJECTS",
  "Campus Events Portal — built with React and Node.js; REST API used for the backend.",
  "",
  "EXPERIENCE",
  "Web Development Intern, BrightLabs (Jun 2025 - Aug 2025) — built reusable React components.",
  "",
  "CERTIFICATIONS",
  "Meta Front-End Developer Certificate, Coursera, 2025",
].join("\n");

const MARKER = "Campus Events Portal";

const calls: Array<{ body: string }> = [];
let payload: unknown = {};

function stubResponse(): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 320, totalTokenCount: 1520 },
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
    });
    req.on("end", () => {
      calls.push({ body: raw });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(stubResponse());
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  process.env.GEMINI_API_KEY = "verification-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`;

  const ai = await import("../server/services/aiService");

  const rows: Array<Record<string, string | number>> = [];

  const measure = async (label: string, run: () => Promise<unknown>) => {
    calls.length = 0;
    const started = Date.now();
    await run();
    const promptChars = calls.reduce((sum, call) => sum + call.body.length, 0);
    const resumeTransmissions = calls.reduce(
      (sum, call) => sum + call.body.split(MARKER).length - 1,
      0,
    );
    rows.push({
      action: label,
      geminiCalls: calls.length,
      resumeCopiesSent: resumeTransmissions,
      payloadChars: promptChars,
      inputTokensEstimate: Math.ceil(promptChars / 4),
      durationMs: Date.now() - started,
    });
  };

  /* 1. OLD resume flow (the duplication this work removes) ----------------- */
  payload = {
    score: 74,
    breakdown: [{ label: "Skills", score: 74 }],
    strengths: ["Clear skills list"],
    improvements: [{ category: "Projects", detail: "Quantify outcomes." }],
    name: "ASHA VERMA",
    email: "asha.verma@example.com",
    phone: "+91 98765 43210",
    skills: ["JavaScript", "React"],
    projects: [],
    experience: [],
    certifications: [],
  };
  await measure("resume analysis — OLD flow (analyzeResume + extractProfile)", async () => {
    await Promise.all([ai.analyzeResume(RESUME), ai.extractProfileFromResume(RESUME)]);
  });

  /* 2. NEW resume flow (single request) ----------------------------------- */
  payload = {
    analysis: {
      score: 74,
      breakdown: [
        { label: "Skills", score: 78 },
        { label: "Projects", score: 70 },
        { label: "Experience", score: 65 },
        { label: "Education", score: 85 },
        { label: "Formatting", score: 72 },
        { label: "Job relevance", score: 70 },
      ],
      strengths: ["Clear skills list"],
      weaknesses: ["No quantified outcomes"],
      improvements: [{ category: "Projects", detail: "Quantify outcomes." }],
      skillObservations: ["Frontend stack present"],
      projectObservations: ["One project"],
      experienceObservations: ["One internship"],
      educationObservations: ["Degree present"],
      formattingObservations: ["Consistent"],
      summaryObservation: "Generic summary",
      jobRelevance: "Frontend roles",
      improvedSummary: "Final-year CS student building React apps.",
    },
    profile: {
      name: "ASHA VERMA",
      email: "asha.verma@example.com",
      phone: "+91 98765 43210",
      location: "Pune, India",
      education: "B.Tech CS, PIT",
      degree: "B.Tech",
      branch: "Computer Science",
      graduationYear: "2027",
      cgpa: "8.6/10",
      careerObjective: "Frontend engineer",
      skills: ["JavaScript", "React"],
      projects: [{ title: "Campus Events Portal", description: "React + Node.js", technologies: ["React"], link: "" }],
      experience: [],
      certifications: [],
    },
  };
  await measure("resume analysis — NEW flow (analyzeResumeFull)", async () => {
    await ai.analyzeResumeFull(RESUME, "Frontend Intern");
  });

  /* 3. Opportunity pass: extraction + trust, then match enrichment -------- */
  payload = {
    company: "BrightLabs",
    jobTitle: "Frontend Intern",
    location: "Pune",
    employmentType: "Internship",
    compensation: "Not found",
    requiredSkills: ["React", "JavaScript"],
    preferredSkills: ["TypeScript"],
    responsibilities: ["Build UI components"],
    insufficientInformation: false,
    trust: {
      status: "No major warnings detected",
      indicators: [{ label: "Company information", status: "good", detail: "Company named." }],
    },
  };
  const extraction = await ai.extractJobRequirements({ description: `Frontend Intern at BrightLabs. Required: React, JavaScript. ${RESUME}` });
  payload = {
    notes: [{ skill: "React", note: "Build a component library.", gapSeverity: "Moderate" }],
  };
  await measure("opportunity pass — OLD/new flow (extract+trust, match enrichment)", async () => {
    const profile = {
      id: 1,
      name: "ASHA VERMA",
      email: "asha.verma@example.com",
      phone: "",
      location: "Pune",
      preferredWorkLocation: "Pune",
      college: "PIT",
      degree: "B.Tech",
      branch: "Computer Science",
      graduationYear: "2027",
      cgpa: "8.6/10",
      careerObjective: "",
      skills: ["JavaScript", "Git", "Communication"],
      projects: [],
      experience: [],
      certifications: [],
      preferences: {},
      createdAt: "",
      updatedAt: "",
    };
    await ai.analyzeOpportunity({
      job: { ...extraction.job, description: "Frontend Intern at BrightLabs." },
      profile,
      skillFrequency: {},
      verification: extraction.trust,
    });
  });

  /* 4. Resume rewrite ---------------------------------------------------- */
  payload = { improvedResume: `${RESUME}\nSummary rewritten.`, changes: [{ area: "Summary", change: "Rewrote summary." }] };
  await measure("resume improvement (rewrite + change list)", async () => {
    await ai.improveResume(RESUME, null, []);
  });

  await new Promise<void>(resolve => server.close(() => resolve()));

  const newResumeRow = rows.find(row => String(row.action).includes("NEW flow"));
  console.log("\n=== Gemini usage verification ===");
  console.table(rows);

  const problems: string[] = [];
  if (Number(newResumeRow?.geminiCalls) !== 1) {
    problems.push(`NEW resume flow made ${newResumeRow?.geminiCalls} Gemini calls (expected 1).`);
  }
  if (Number(newResumeRow?.resumeCopiesSent) !== 1) {
    problems.push(
      `NEW resume flow sent the resume ${newResumeRow?.resumeCopiesSent} times (expected 1).`,
    );
  }
  const oldRow = rows.find(row => String(row.action).includes("OLD flow (analyzeResume"));
  if (Number(oldRow?.geminiCalls) !== 2) {
    problems.push(`OLD resume flow baseline was ${oldRow?.geminiCalls} calls (expected 2).`);
  }

  if (problems.length) {
    console.error("\nFAILED:");
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }

  const before = Number(oldRow?.inputTokensEstimate ?? 0);
  const after = Number(newResumeRow?.inputTokensEstimate ?? 0);
  console.log(
    `\nResume analysis: ${oldRow?.geminiCalls} calls / ~${before} input tokens ` +
      `-> ${newResumeRow?.geminiCalls} call / ~${after} input tokens ` +
      `(saved ~${Math.max(0, before - after)} tokens, ${Math.round((1 - after / Math.max(1, before)) * 100)}% less).`,
  );
  console.log("PASS: one resume analysis = one Gemini request, resume text sent once.\n");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
