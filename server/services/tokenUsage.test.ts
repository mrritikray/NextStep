/**
 * Token-usage regression tests for the Gemini single-request optimisation.
 *
 * A counting HTTP stub stands in for the Gemini endpoint via GEMINI_BASE_URL,
 * so the REAL client code path (retries, schema, JSON parsing, sanitising) runs
 * end to end. Every request body is recorded, which lets us assert:
 *
 *   - one resume analysis = ONE Gemini request, and the resume text travels
 *     exactly once (the old two-call flow sent it twice);
 *   - job extraction + trust check = ONE request;
 *   - a resume rewrite + its change list = ONE request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

/** Unique string that appears exactly once in the resume. */
const RESUME_MARKER = "Campus Events Portal";

const captured: Array<Record<string, unknown>> = [];
let responsePayload: unknown = {};
/** When set, the stub answers with this status instead of a success payload. */
let failureMode: { status: number; retryAfter?: string } | null = null;
let server: http.Server;

type Part = { text?: string };
type Body = { contents?: Array<{ parts?: Part[] }> };

function promptText(body: Body): string {
  return (body?.contents?.[0]?.parts ?? []).map(part => part.text ?? "").join("");
}

/** How many times a marker string appears across a whole request body. */
function countInBody(body: unknown, marker: string): number {
  return JSON.stringify(body).split(marker).length - 1;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        captured.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        captured.push({ raw });
      }
      if (failureMode) {
        res.writeHead(failureMode.status, {
          "Content-Type": "application/json",
          ...(failureMode.retryAfter ? { "Retry-After": failureMode.retryAfter } : {}),
        });
        res.end(JSON.stringify({ error: { code: 429, message: "Resource has been exhausted." } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(responsePayload) }] }, finishReason: "STOP" },
          ],
          // Real usage metadata, so the logger exercises the "api" token path.
          usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 350, totalTokenCount: 1550 },
        }),
      );
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
  // The request-count guards (RPM/RPD) would throttle a suite that makes many
  // calls within one minute — raise them here; a dedicated test below covers
  // the 429 path itself.
  process.env.GEMINI_MAX_RPM = "1000";
  process.env.GEMINI_MAX_RPD = "1000";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_MAX_RPM;
  delete process.env.GEMINI_MAX_RPD;
});

beforeEach(() => {
  captured.length = 0;
  responsePayload = {};
  process.env.GEMINI_API_KEY = "test-key";
});

describe("Gemini token usage — one request per user action", () => {
  it("analyses ONE resume with exactly ONE request, sending the resume text once", async () => {
    responsePayload = {
      analysis: {
        score: 78,
        breakdown: [
          { label: "Skills", score: 80 },
          { label: "Projects", score: 70 },
          { label: "Experience", score: 60 },
          { label: "Education", score: 85 },
          { label: "Formatting", score: 75 },
          { label: "Job relevance", score: 72 },
        ],
        strengths: ["Clear skills section"],
        weaknesses: ["No measurable project outcomes"],
        improvements: [{ category: "Projects", detail: "Quantify the impact of the events portal." }],
        skillObservations: ["Relevant frontend stack"],
        projectObservations: ["One project listed"],
        experienceObservations: ["One internship"],
        educationObservations: ["Degree and CGPA present"],
        formattingObservations: ["Consistent structure"],
        summaryObservation: "Summary is generic",
        jobRelevance: "Matches frontend internships",
        improvedSummary: "Final-year CS student building React applications.",
      },
      profile: {
        name: "ASHA VERMA",
        email: "asha.verma@example.com",
        phone: "+91 98765 43210",
        location: "Pune, India",
        education: "B.Tech Computer Science, Pune Institute of Technology",
        degree: "B.Tech",
        branch: "Computer Science",
        graduationYear: "2027",
        cgpa: "8.6/10",
        careerObjective: "Frontend engineer",
        skills: ["JavaScript", "React", "Node.js", "Git", "SQL", "Communication"],
        projects: [{ title: "Campus Events Portal", description: "React + Node.js", technologies: ["React"], link: "" }],
        experience: [
          { company: "BrightLabs", role: "Web Development Intern", duration: "Jun 2025 - Aug 2025", description: "Built components" },
        ],
        certifications: [{ name: "Meta Front-End Developer Certificate", issuer: "Coursera", year: "2025" }],
      },
    };

    const { analyzeResumeFull } = await import("./aiService");
    const result = await analyzeResumeFull(RESUME, "Frontend Intern");

    // THE TARGET BEHAVIOUR: one button press -> one Gemini request.
    expect(captured).toHaveLength(1);

    const body = captured[0] as Body;
    // The complete resume is present, exactly once.
    expect(promptText(body)).toContain(RESUME_MARKER);
    expect(countInBody(captured[0], RESUME_MARKER)).toBe(1);

    // Both halves of the single response are used.
    expect(result.engine).toBe("gemini");
    expect(result.analysis.score).toBe(78);
    expect(result.analysis.breakdown).toHaveLength(6);
    expect(result.profile.email).toBe("asha.verma@example.com");
    expect(result.profile.skills).toContain("React");
    // Top-level convenience fields come from the SAME response.
    expect(result.strengths).toEqual(["Clear skills section"]);
    expect(result.weaknesses).toEqual(["No measurable project outcomes"]);
    expect(result.education.graduationYear).toBe("2027");
    expect(result.experience[0]?.company).toBe("BrightLabs");
    expect(result.projects[0]?.title).toBe("Campus Events Portal");
    expect(result.certifications[0]?.issuer).toBe("Coursera");
  });

  it("documents the previous behaviour: analysis + profile extraction cost TWO requests", async () => {
    responsePayload = {
      score: 70,
      breakdown: [{ label: "Skills", score: 70 }],
      strengths: ["a"],
      improvements: [{ category: "Skills", detail: "add depth" }],
      name: "ASHA VERMA",
      skills: ["React"],
      projects: [],
      experience: [],
      certifications: [],
    };

    const { analyzeResume, extractProfileFromResume } = await import("./aiService");
    await Promise.all([analyzeResume(RESUME), extractProfileFromResume(RESUME)]);

    // Both legacy operations still work (they stay exported for compatibility)…
    expect(captured).toHaveLength(2);
    // …and each one posted the whole resume, which is exactly the duplication
    // the router no longer performs.
    for (const body of captured) {
      expect(countInBody(body, RESUME_MARKER)).toBe(1);
    }
  });

  it("extracts posting requirements AND trust indicators in ONE request", async () => {
    responsePayload = {
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
        status: "No major warning signs detected",
        indicators: [
          { label: "Company information", status: "good", detail: "Company named in the posting." },
          { label: "Payment requests", status: "good", detail: "No payment requested." },
        ],
      },
    };

    const { extractJobRequirements } = await import("./aiService");
    const { job, trust, engine } = await extractJobRequirements({
      description: `Frontend Intern at BrightLabs, Pune. Required: React, JavaScript. Preferred: TypeScript. ${RESUME}`,
    });

    expect(captured).toHaveLength(1);
    expect(engine).toBe("gemini");
    expect(job.requiredSkills).toContain("React");
    expect(trust.indicators).toHaveLength(2);
    expect(trust.status).toBe("No major warning signs detected");
  });

  it("rewrites a resume and returns the change list in ONE request", async () => {
    responsePayload = {
      improvedResume: `${RESUME}\n\nSUMMARY\nFrontend-focused final-year CS student.`,
      changes: [{ area: "Summary", change: "Rewrote the professional summary for the target role." }],
    };

    const { improveResume } = await import("./aiService");
    const result = await improveResume(RESUME, null, []);

    expect(captured).toHaveLength(1);
    expect(result.improvedResume).toContain("Frontend-focused final-year CS student.");
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].area).toBe("Summary");
    expect(result.engine).toBe("gemini");
  });

  it("builds the roadmap AND the gap notes in ONE request", async () => {
    responsePayload = {
      estimatedDuration: "12 days",
      items: [
        {
          skill: "React",
          title: "React Fundamentals",
          description: "Learn the core model.",
          duration: "5 days",
          learningObjective: "Build components",
          practicalTask: "Ship a small component library.",
          resources: ["https://react.dev/learn"],
        },
        {
          skill: "REST API",
          title: "REST API Integration",
          description: "Connect real data.",
          duration: "7 days",
          practicalTask: "Integrate a public API.",
        },
      ],
      gapNotes: [
        { skill: "React", note: "Build a small component library with props and state.", gapSeverity: "Moderate" },
        // A note for a skill that is NOT a real gap must be dropped.
        { skill: "Not A Real Gap", note: "Should be dropped.", gapSeverity: "Minor" },
      ],
    };

    const { generateRoadmapWithGapNotes } = await import("./aiService");
    const result = await generateRoadmapWithGapNotes({
      targetOpportunity: "Frontend Intern at BrightLabs",
      targetSkills: ["React", "REST API"],
      gaps: [
        { skill: "React", currentLevel: "Not started", requiredLevel: "Intermediate", gap: "Build demonstrable evidence.", gapSeverity: "Moderate", importance: "High" },
        { skill: "REST API", currentLevel: "Not started", requiredLevel: "Intermediate", gap: "Learn to integrate APIs.", gapSeverity: "Moderate", importance: "High" },
      ],
      profile: null,
    });

    // THE TARGET BEHAVIOUR: the whole plan costs ONE request.
    expect(captured).toHaveLength(1);
    expect(result.engine).toBe("gemini");
    expect(result.estimatedDuration).toBe("12 days");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].resources).toEqual(["https://react.dev/learn"]);
    expect(result.gapNotes).toHaveLength(1);
    expect(result.gapNotes[0].skill).toBe("React");
    expect(result.gapNotes[0].gapSeverity).toBe("Moderate");
  });

  it("handles a 429 safely: honours Retry-After, retries at most once, then fails with a friendly message", async () => {
    failureMode = { status: 429, retryAfter: "1" };
    const started = Date.now();
    let failureMessage = "";
    try {
      const { generateRoadmap } = await import("./aiService");
      await generateRoadmap({
        targetOpportunity: "Frontend Intern at BrightLabs",
        targetSkills: ["React"],
        gaps: [
          { skill: "React", currentLevel: "Not started", requiredLevel: "Intermediate", gap: "Build demonstrable evidence.", gapSeverity: "Moderate", importance: "High" },
        ],
        profile: null,
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    } finally {
      failureMode = null;
    }

    // The user-facing message is friendly — no raw API details, no new
    // requests fired after the retry.
    expect(failureMessage).toMatch(/temporarily/i);
    // Exactly TWO requests (initial + the single allowed retry), the retry
    // made only after the 1s Retry-After window — not a retry storm.
    expect(captured).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 20_000);
});
