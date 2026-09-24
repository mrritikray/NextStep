import { describe, expect, it } from "vitest";
import {
  calculateSkillMatch,
  classifySkills,
  generateSkillGap,
  normalizeSkill,
  verifyOpportunity,
} from "./matching";
import { extractJobFromText, extractProfileFromText, analyseResumeText } from "./demoFallback";
import type { Profile } from "./types";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    name: "Test Student",
    email: "test@example.com",
    phone: "",
    location: "Pune",
    preferredWorkLocation: "Remote",
    college: "Test Institute",
    degree: "B.Tech",
    branch: "Computer Science",
    graduationYear: "2028",
    cgpa: "8.4 / 10",
    careerObjective: "",
    skills: ["JavaScript", "Git", "Communication"],
    projects: [],
    experience: [],
    certifications: [],
    preferences: {},
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("matching engine", () => {
  it("classifies matched / partially matched / missing / not applicable", () => {
    const rows = classifySkills(
      [
        { skill: "JavaScript", optional: false },
        { skill: "React", optional: false },
        { skill: "Git", optional: false },
        { skill: "REST API", optional: false },
        { skill: "Communication", optional: false },
      ],
      ["JavaScript", "Git", "Communication"],
    );

    expect(rows.find(row => row.skill === "JavaScript")?.classification).toBe("Matched");
    expect(rows.find(row => row.skill === "Git")?.classification).toBe("Matched");
    expect(rows.find(row => row.skill === "Communication")?.classification).toBe("Matched");
    expect(rows.find(row => row.skill === "REST API")?.classification).toBe("Missing");
    // React has no overlap with the profile tokens here -> Missing (never random).
    expect(["Missing", "Partially Matched"]).toContain(
      rows.find(row => row.skill === "React")?.classification,
    );
  });

  it("produces an explainable, deterministic score (no randomness)", () => {
    const job = {
      company: "Example Technologies",
      jobTitle: "Frontend Intern",
      description: "remote frontend internship",
      location: "Remote",
      employmentType: "Internship",
      compensation: "Not found",
      eligibility: "B.Tech students",
      requiredSkills: ["JavaScript", "React", "Git", "REST API", "Communication"],
      preferredSkills: [],
      responsibilities: [],
      responsibilitiesRaw: "",
      experienceRequirement: "Fresher",
      educationRequirement: "B.Tech",
      applicationInfo: "Not found",
    };

    const first = calculateSkillMatch(job, makeProfile());
    const second = calculateSkillMatch(job, makeProfile());

    expect(first.matchScore).toBe(second.matchScore);
    expect(first.matchScore).toBeGreaterThan(0);
    expect(first.matchScore).toBeLessThanOrEqual(100);
    // 3 of 5 clear matches -> skill fit 60%
    expect(first.factors[0].value).toBe("60%");
    expect(first.explanation).toContain("3 of 5");
    expect(first.skillRows).toHaveLength(5);
  });

  it("derives skill gaps from the real missing skills", () => {
    const job = {
      company: "X",
      jobTitle: "Intern",
      description: "internship",
      location: "Remote",
      employmentType: "Internship",
      compensation: "",
      eligibility: "",
      requiredSkills: ["React", "REST API"],
      preferredSkills: ["Figma"],
      responsibilities: [],
      responsibilitiesRaw: "",
      experienceRequirement: "",
      educationRequirement: "",
      applicationInfo: "",
    };
    const match = calculateSkillMatch(job, makeProfile());
    const gaps = generateSkillGap(match, job);

    expect(gaps.map(gap => gap.skill).sort()).toEqual(["Figma", "REST API", "React"].sort());
    expect(gaps.every(gap => ["Minor", "Moderate", "Significant"].includes(gap.gapSeverity))).toBe(true);
    const react = gaps.find(gap => gap.skill === "React");
    expect(react?.currentLevel).toBe("Not started");
    expect(react?.requiredLevel).toBe("Intermediate");
  });

  it("never guarantees legitimacy in the trust check", () => {
    const clean = verifyOpportunity({
      company: "Northstar Labs",
      jobTitle: "Intern",
      description: "Internship at Northstar Labs. Apply at careers@northstar.example.com. Stipend ₹15,000.",
      requiredSkills: ["JavaScript"],
      preferredSkills: [],
      responsibilities: [],
      responsibilitiesRaw: "",
      location: "Remote",
      employmentType: "Internship",
      compensation: "₹15,000",
      eligibility: "",
      experienceRequirement: "",
      educationRequirement: "",
      applicationInfo: "email",
    });
    expect(["No major warning signs detected", "Review recommended", "Not enough information to verify this opportunity."]).toContain(clean.status);
    expect(clean.status).not.toMatch(/verified|safe|legitimate/i);

    const risky = verifyOpportunity({
      company: "Quick Hire",
      jobTitle: "Intern",
      description:
        "Instant offer, no interview. Work from home and earn. Pay a refundable registration fee of 999 and share your bank details and OTP. Apply: https://bit.ly/x",
      requiredSkills: ["Data Entry"],
      preferredSkills: [],
      responsibilities: [],
      responsibilitiesRaw: "",
      location: "Remote",
      employmentType: "Internship",
      compensation: "Not found",
      eligibility: "",
      experienceRequirement: "",
      educationRequirement: "",
      applicationInfo: "link",
    });
    expect(risky.status).toBe("Review recommended");
    expect(risky.indicators.some(ind => ind.label === "Payment requests" && ind.status === "watch")).toBe(true);
  });

  it("normalises skill aliases", () => {
    expect(normalizeSkill("React.js")).toBe("react");
    expect(normalizeSkill("REST APIs")).toBe("rest api");
    expect(normalizeSkill("NodeJS")).toBe("node");
  });
});

describe("demo fallback derivation (no hard-coded skill list)", () => {
  it("extracts only skills that actually appear in the job description", () => {
    const kubernetesJob = extractJobFromText(
      "Job Title: Platform Intern\nWe need Docker, Kubernetes and Go experience. Company: Orbit Systems. Location: Remote.",
    );
    expect(kubernetesJob.requiredSkills.join(" ").toLowerCase()).toContain("kubernetes");
    expect(kubernetesJob.requiredSkills.join(" ").toLowerCase()).toContain("docker");
    // The old hard-coded list must never appear.
    expect(kubernetesJob.requiredSkills).not.toContain("HTML/CSS");
    expect(kubernetesJob.requiredSkills.join(" ")).not.toContain("React");

    const designJob = extractJobFromText(
      "Job Title: UI Design Intern\nRequirements: Figma, prototyping and user research. Company: Mosaic. Location: Pune.",
    );
    expect(designJob.requiredSkills.join(" ").toLowerCase()).toContain("figma");
    expect(designJob.requiredSkills.join(" ")).not.toContain("Kubernetes");

    // Different jobs must produce different requirements.
    expect(kubernetesJob.requiredSkills).not.toEqual(designJob.requiredSkills);
  });

  it("returns Not found instead of inventing resume data", () => {
    const extracted = extractProfileFromText(
      "This text has no contact details and no sections at all.",
    );
    expect(extracted.email).toBe("Not found");
    expect(extracted.phone).toBe("Not found");
  });

  it("scores a real resume lower when projects are absent", () => {
    const rich = analyseResumeText(
      "Ritik Ray\nritik@example.com +91 98765 43210\n\nSkills\nJavaScript, React, Git, SQL\n\nProjects\n- Built a dashboard used by 200 users with React and REST API\n\nEducation\nB.Tech Computer Science, 2028, CGPA 8.4/10\n",
    );
    const thin = analyseResumeText("Some text about a person with no structure.");
    expect(rich.score).toBeGreaterThan(thin.score);
    expect(rich.breakdown.find(item => item.label === "Projects")!.score).toBeGreaterThan(
      thin.breakdown.find(item => item.label === "Projects")!.score,
    );
  });
});
